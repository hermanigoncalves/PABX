import os
import json
import threading
import time
import logging
import base64
import queue
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from pyVoIP.VoIP import VoIPPhone, CallState, InvalidStateError, PhoneStatus
import websocket
import requests

# Configuração de Logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

# Configurações
PORT = int(os.getenv('PORT', 3000))
SIP_PORT = int(os.getenv('SIP_PORT', 5060))
ELEVENLABS_AGENT_ID = os.getenv('ELEVENLABS_AGENT_ID')
ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY')
FACILPABX_HOST = os.getenv('FACILPABX_HOST')
FACILPABX_USER = os.getenv('FACILPABX_USER')
FACILPABX_PASSWORD = os.getenv('FACILPABX_PASSWORD')

# Validar configurações críticas
if not all([ELEVENLABS_AGENT_ID, ELEVENLABS_API_KEY, FACILPABX_HOST, FACILPABX_USER, FACILPABX_PASSWORD]):
    logger.error("❌ Configurações de ambiente incompletas!")

# Cliente SIP Global
sip_client = None

def get_public_ip():
    try:
        return requests.get('https://api.ipify.org', timeout=5).text
    except:
        return "0.0.0.0"

def incoming_call_handler(call):
    logger.info("📞 Chamada recebida (não implementado atendimento automático ainda)")
    try:
        call.hangup()
    except:
        pass

def start_sip_client():
    global sip_client
    try:
        public_ip = get_public_ip()
        logger.info(f"🌍 IP Público detectado: {public_ip}")
        
        logger.info(f"🔄 Iniciando cliente SIP ({FACILPABX_USER}@{FACILPABX_HOST})...")
        
        # TRUQUE NAT: Bind no 0.0.0.0 (interno) mas anunciar IP Público nos headers
        sip_client = VoIPPhone(
            server=FACILPABX_HOST,
            port=SIP_PORT,
            username=FACILPABX_USER,
            password=FACILPABX_PASSWORD,
            myIP="0.0.0.0", # Bind local (evita erro 99)
            sipPort=SIP_PORT,
            callCallback=incoming_call_handler
        )
        
        # Substituir IP para os headers SIP (Contact/Via)
        sip_client.myIP = public_ip 
        
        sip_client.start()
        logger.info(f"✅ Cliente SIP iniciado. IP Local: 0.0.0.0, IP Anunciado: {public_ip}")
    except Exception as e:
        logger.error(f"❌ Erro ao iniciar cliente SIP: {e}")

# Thread de Bridge de Áudio (Um por chamada)
class AudioBridge(threading.Thread):
    def __init__(self, call, signed_url, lead_name, call_id="unknown"):
        threading.Thread.__init__(self)
        self.call = call
        self.signed_url = signed_url
        self.lead_name = lead_name
        self.call_id = call_id
        self.ws = None
        self.running = True
        self.audio_queue = queue.Queue()

    def run(self):
        logger.info(f"🚀 Iniciando Bridge de Áudio para chamada {self.call_id}")
        
        # Conectar ao ElevenLabs
        try:
            self.ws = websocket.WebSocketApp(
                self.signed_url,
                on_open=self.on_open,
                on_message=self.on_message,
                on_error=self.on_error,
                on_close=self.on_close
            )
            
            # Rodar WS em loop bloqueante (mas dentro desta thread)
            self.ws.run_forever()
        except Exception as e:
            logger.error(f"❌ Erro fatal no Bridge: {e}")
        finally:
            self.stop()

    def stop(self):
        self.running = False
        if self.ws:
            self.ws.close()
        try:
            self.call.hangup()
        except:
            pass
        logger.info("🛑 Bridge finalizado.")

    def on_open(self, ws):
        logger.info("🔗 WebSocket ElevenLabs Conectado")
        
        # Enviar configuração inicial
        init_data = {
            "type": "conversation_initiation_client_data",
            "conversation_config_override": {
                "agent": {
                    "prompt": {
                        "prompt": f"O nome do lead é {self.lead_name}. Aja naturalmente."
                    }
                }
            }
        }
        ws.send(json.dumps(init_data))
        
        # Iniciar thread de leitura do SIP -> ElevenLabs
        threading.Thread(target=self.sip_to_elevenlabs_loop, daemon=True).start()

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            if data['type'] == 'audio':
                # Recebeu áudio do ElevenLabs (Base64)
                # Decodificar e enviar para o SIP (RTP)
                chunk = base64.b64decode(data['audio_event']['audio_base_64'])
                # pyVoIP espera PCM linear ou PCMA/PCMU dependendo da negociação.
                # Assumindo que ElevenLabs manda PCM e pyVoIP converte, ou precisamos converter.
                # Simplificação: Enviar raw bytes para o call.write_audio
                self.call.write_audio(chunk)
            elif data['type'] == 'agent_response':
                logger.info(f"🤖 Agente: {data['agent_response'].get('text', '...')}")
            elif data['type'] == 'interruption':
                self.call.stop_audio() # Parar áudio atual se houver interrupção
        except Exception as e:
            logger.error(f"⚠️ Erro processando mensagem WS: {e}")

    def on_error(self, ws, error):
        logger.error(f"❌ Erro WS: {error}")

    def on_close(self, ws, close_status_code, close_msg):
        logger.info("🔌 WebSocket fechado")
        self.stop()

    def sip_to_elevenlabs_loop(self):
        logger.info("🎤 Iniciando captura de áudio SIP -> ElevenLabs")
        while self.running and self.call.state == CallState.ANSWERED:
            try:
                # Ler áudio do SIP (bloqueante ou com timeout)
                # pyVoIP: call.read_audio(length)
                # Precisamos verificar a API exata do pyVoIP para leitura de stream
                # Assumindo leitura de 160 bytes (20ms de G.711)
                audio_frame = self.call.read_audio(160) 
                
                if audio_frame:
                    # Enviar para ElevenLabs
                    payload = {
                        "type": "audio",
                        "audio_event": {
                            "audio_base_64": base64.b64encode(audio_frame).decode('utf-8'),
                            "eventId": int(time.time() * 1000)
                        }
                    }
                    self.ws.send(json.dumps(payload))
            except Exception as e:
                # logger.error(f"Erro leitura SIP: {e}")
                time.sleep(0.01)

@app.route('/health', methods=['GET'])
def health():
    status_str = "unknown"
    if sip_client:
        try:
            # Acessar _status diretamente pois get_status pode não existir ou falhar
            status_enum = getattr(sip_client, '_status', 'status_not_found')
            status_str = str(status_enum)
        except Exception as e:
            status_str = f"error: {str(e)}"

    return jsonify({
        "status": "ok",
        "version": "2.3-PYTHON-RESTORED",
        "sip_status": status_str
    })

@app.route('/make-call', methods=['POST'])
def make_call():
    data = request.json
    phone_number = data.get('phoneNumber')
    lead_name = data.get('leadName', 'Cliente')

    if not phone_number:
        return jsonify({"error": "phoneNumber required"}), 400

    try:
        # 1. Obter URL assinada
        url = f"https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id={ELEVENLABS_AGENT_ID}"
        headers = {"xi-api-key": ELEVENLABS_API_KEY}
        resp = requests.get(url, headers=headers)
        resp.raise_for_status()
        signed_url = resp.json()['signed_url']

        # 2. Iniciar Chamada SIP
        logger.info(f"📞 Discando para {phone_number}...")
        
        try:
            # Tentar forçar codec PCMA (comum no Brasil) se a lib permitir, 
            # ou apenas confiar que a negociação vai funcionar melhor com try/except.
            # pyVoIP usa PCMU/PCMA por padrão.
            
            call = sip_client.call(phone_number)
            
            # Tentar pegar ID de várias formas (o log mostrou que é call_id)
            call_id = getattr(call, 'call_id', None) or getattr(call, 'callID', None) or getattr(call, 'id', None) or str(int(time.time()))
            
            # Iniciar Bridge em background
            bridge = AudioBridge(call, signed_url, lead_name, call_id)
            bridge.start()

            # Monitorar estado da chamada por 5 segundos para debug
            def monitor_call(c, cid):
                for _ in range(10):
                    time.sleep(0.5)
                    try:
                        logger.info(f"👀 Estado da chamada {cid}: {c.state}")
                        if c.state == CallState.ANSWERED:
                            break
                        if c.state == CallState.ENDED:
                            logger.warning(f"⚠️ Chamada {cid} encerrou prematuramente.")
                            break
                    except:
                        pass
            
            threading.Thread(target=monitor_call, args=(call, call_id), daemon=True).start()

            return jsonify({
                "success": True,
                "message": "Chamada iniciada",
                "callId": call_id
            })
            
        except Exception as dial_error:
            logger.error(f"❌ Erro crítico ao discar: {dial_error}")
            return jsonify({"error": f"Falha na discagem: {str(dial_error)}"}), 500

    except Exception as e:
        logger.error(f"❌ Erro make-call: {e}")
        return jsonify({"error": str(e)}), 500

# Iniciar SIP ao arrancar (em thread separada para não bloquear o Flask)
threading.Thread(target=start_sip_client, daemon=True).start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)
