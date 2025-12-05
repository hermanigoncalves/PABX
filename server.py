import os
import json
import threading
import uuid
import time
import logging
import base64
import queue
import struct
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from pyVoIP.VoIP import VoIPPhone, CallState, InvalidStateError, PhoneStatus
import websocket
import requests

# Configuração de Logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

# Handler global de exceções para evitar crashes
@app.errorhandler(Exception)
def handle_exception(e):
    logger.error(f"❌ Exceção não tratada: {e}")
    import traceback
    logger.error(traceback.format_exc())
    return jsonify({"error": "Internal server error", "message": str(e)}), 500

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

# Dicionário para rastrear status das chamadas (request_id -> status dict)
call_statuses = {}

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
        logger.info("=" * 80)
        logger.info("🚀 Iniciando cliente SIP...")
        logger.info("=" * 80)
        
        public_ip = get_public_ip()
        logger.info(f"🌍 IP Público detectado: {public_ip}")
        
        logger.info(f"🔄 Configurando cliente SIP ({FACILPABX_USER}@{FACILPABX_HOST})...")
        logger.info(f"   Host: {FACILPABX_HOST}")
        logger.info(f"   Port: {SIP_PORT}")
        logger.info(f"   User: {FACILPABX_USER}")
        logger.info(f"   Password: {'*' * len(FACILPABX_PASSWORD) if FACILPABX_PASSWORD else 'NÃO CONFIGURADO'}")
        
        # TRUQUE NAT: Bind no 0.0.0.0 (interno) mas anunciar IP Público nos headers
        sip_client = VoIPPhone(
            server=FACILPABX_HOST,
            port=SIP_PORT,
            username=FACILPABX_USER,
            password=FACILPABX_PASSWORD,
            myIP="0.0.0.0", # Bind local (evita erro 99)
            sipPort=SIP_PORT,
            rtpPortLow=10000, # Porta RTP Mínima (Exposta no Docker)
            rtpPortHigh=20000, # Porta RTP Máxima (Exposta no Docker)
            callCallback=incoming_call_handler
        )
        
        # Substituir IP para os headers SIP (Contact/Via)
        sip_client.myIP = public_ip 
        
        logger.info("🔄 Iniciando cliente SIP...")
        sip_client.start()
        logger.info("=" * 80)
        logger.info(f"✅ Cliente SIP iniciado com SUCESSO!")
        logger.info(f"   IP Local: 0.0.0.0")
        logger.info(f"   IP Anunciado: {public_ip}")
        logger.info(f"   RTP: 10000-20000")
        logger.info("=" * 80)
    except Exception as e:
        logger.error("=" * 80)
        logger.error(f"❌ Erro ao iniciar cliente SIP: {e}")
        import traceback
        logger.error("Traceback completo:")
        logger.error(traceback.format_exc())
        logger.error("=" * 80)
        # Não crashar o servidor se o SIP falhar - apenas logar o erro
        sip_client = None

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
        
        # Aguardar a chamada ser atendida (timeout de 30 segundos)
        logger.info("⏳ Aguardando chamada ser atendida...")
        timeout = 30
        waited = 0
        while waited < timeout and self.call.state != CallState.ANSWERED:
            time.sleep(0.5)
            waited += 0.5
            if waited % 2 == 0:
                logger.info(f"⏳ Aguardando... Estado atual: {self.call.state} ({waited}s/{timeout}s)")
            
            # Se a chamada já foi encerrada, abortar
            if self.call.state == CallState.ENDED:
                logger.error("❌ Chamada encerrada antes de ser atendida")
                return
        
        if self.call.state != CallState.ANSWERED:
            logger.error(f"❌ Timeout aguardando chamada ser atendida (estado final: {self.call.state})")
            return
        
        logger.info("=" * 80)
        logger.info("✅ Chamada ATENDIDA! Iniciando bridge de áudio com ElevenLabs...")
        logger.info("=" * 80)
        
        # Conectar ao ElevenLabs
        try:
            logger.info(f"🔗 Conectando ao WebSocket ElevenLabs...")
            logger.info(f"   URL: {self.signed_url[:80]}...")
            
            self.ws = websocket.WebSocketApp(
                self.signed_url,
                on_open=self.on_open,
                on_message=self.on_message,
                on_error=self.on_error,
                on_close=self.on_close
            )
            
            logger.info("🚀 Iniciando loop do WebSocket...")
            # Rodar WS em loop bloqueante (mas dentro desta thread)
            self.ws.run_forever()
            logger.info("🛑 Loop do WebSocket encerrado")
        except Exception as e:
            logger.error(f"❌ Erro fatal no Bridge: {e}")
            import traceback
            logger.error(traceback.format_exc())
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
        logger.info("=" * 80)
        logger.info("🔗 WebSocket ElevenLabs CONECTADO COM SUCESSO!")
        logger.info("=" * 80)
        
        # Enviar configuração inicial
        init_data = {
            "type": "conversation_initiation_client_data",
            "conversation_config_override": {
                "agent": {
                    "prompt": {
                        "prompt": f"O nome do lead é {self.lead_name}. Aja naturalmente e fale em português do Brasil."
                    },
                    "first_message": f"Olá {self.lead_name}, tudo bem? Estou te ligando para confirmar algumas informações.",
                },
                "tts": {
                    "output_format": "pcm_16000" # Solicitar PCM 16kHz (vamos converter para 8kHz)
                }
            }
        }
        logger.info(f"📤 Enviando configuração inicial do agente:")
        logger.info(f"   - Lead: {self.lead_name}")
        logger.info(f"   - First message: {init_data['conversation_config_override']['agent']['first_message']}")
        logger.info(f"   - Output format: pcm_16000")
        
        try:
            ws.send(json.dumps(init_data))
            logger.info("✅ Configuração enviada com sucesso!")
            logger.info("⏳ Aguardando resposta do ElevenLabs...")
        except Exception as e:
            logger.error(f"❌ Erro ao enviar configuração: {e}")
        
        # Iniciar thread de leitura do SIP -> ElevenLabs
        threading.Thread(target=self.sip_to_elevenlabs_loop, daemon=True).start()

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            msg_type = data.get('type', 'unknown')
            
            if msg_type == 'audio':
                # Verificar se a chamada está ativa
                if self.call.state != CallState.ANSWERED:
                    logger.warning(f"⚠️ Chamada não está atendida (estado: {self.call.state}). Ignorando áudio.")
                    return
                
                # Recebeu áudio do ElevenLabs (Base64) - PCM 16kHz 16-bit
                logger.info(f"🔊 Recebido chunk de áudio do ElevenLabs")
                chunk_16k = base64.b64decode(data['audio_event']['audio_base_64'])
                logger.info(f"📊 Tamanho do áudio: {len(chunk_16k)} bytes")
                
                # Converter 16kHz -> 8kHz (pyVoIP usa G.711 8kHz)
                # Manual downsampling usando struct (seguro contra falta de libs)
                # Desempacotar bytes em short integers (16-bit little endian)
                count = len(chunk_16k) // 2
                samples = struct.unpack(f"<{count}h", chunk_16k)
                
                # Pegar cada segunda amostra (Downsample 2x)
                samples_8k = samples[::2]
                
                # Empacotar de volta para bytes
                chunk_8k = struct.pack(f"<{len(samples_8k)}h", *samples_8k)
                
                # logger.info(f"✅ Áudio convertido: {len(chunk_8k)} bytes, enviando para chamada SIP...")
                try:
                    self.call.write_audio(chunk_8k)
                    # logger.info("✅ Áudio enviado para SIP!")
                except Exception as audio_err:
                    logger.error(f"❌ Erro ao enviar áudio para SIP: {audio_err}")
                    logger.error(f"Tipo do objeto call: {type(self.call)}")
                    logger.error(f"Métodos de áudio: {[m for m in dir(self.call) if 'audio' in m.lower() or 'write' in m.lower()]}")
                
            elif msg_type == 'agent_response':
                logger.info(f"🤖 Agente: {data['agent_response'].get('text', '...')}")
            elif msg_type == 'interruption':
                logger.info("🛑 Interrupção detectada pelo ElevenLabs")
                try:
                    self.call.stop_audio()
                except:
                    pass
            else:
                logger.info(f"📩 Mensagem ElevenLabs tipo: {msg_type}")
                # Log da mensagem completa (exceto áudio grande)
                try:
                    if len(message) < 500:
                        logger.info(f"   Conteúdo: {message}")
                    else:
                        logger.info(f"   Conteúdo: (mensagem grande, {len(message)} bytes)")
                except:
                    pass
        except Exception as e:
            logger.error(f"⚠️ Erro processando mensagem WS: {e}")
            try:
                logger.error(f"Mensagem raw: {message[:200]}")
            except:
                logger.error("Não foi possível mostrar mensagem raw")

    def on_error(self, ws, error):
        logger.error(f"❌ Erro WS: {error}")

    def on_close(self, ws, close_status_code, close_msg):
        logger.info("🔌 WebSocket fechado")
        self.stop()

    def sip_to_elevenlabs_loop(self):
        logger.info("🎤 Iniciando captura de áudio SIP -> ElevenLabs")
        frames_read = 0
        while self.running and self.call.state == CallState.ANSWERED:
            try:
                # Ler áudio do SIP (bloqueante ou com timeout)
                # pyVoIP: call.read_audio(length)
                # Precisamos verificar a API exata do pyVoIP para leitura de stream
                # Assumindo leitura de 160 bytes (20ms de G.711)
                audio_frame = self.call.read_audio(160) 
                
                if audio_frame:
                    frames_read += 1
                    if frames_read % 100 == 0:
                        logger.info(f"🎤 Lendo áudio SIP... (Frames: {frames_read})")

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
        "version": "2.5-DIAGNOSTICS",
        "sip_status": status_str,
        "pyvoip_version": getattr(__import__('pyVoIP'), '__version__', 'unknown'),
        "config": {
            "agent_id_configured": bool(ELEVENLABS_AGENT_ID),
            "api_key_configured": bool(ELEVENLABS_API_KEY),
            "pabx_host_configured": bool(FACILPABX_HOST)
        }
    })

# Endpoint para testar se write_audio funciona
@app.route('/test-audio', methods=['GET'])
def test_audio():
    """Testa se o método write_audio existe e pode ser chamado"""
    try:
        # Verificar métodos disponíveis em uma chamada hipotética
        info = {
            "pyVoIP_imported": True,
            "VoIPPhone_exists": hasattr(__import__('pyVoIP.VoIP', fromlist=['VoIPPhone']), 'VoIPPhone'),
            "CallState_exists": hasattr(__import__('pyVoIP.VoIP', fromlist=['CallState']), 'CallState'),
        }
        
        # Se houver sip_client, mostrar mais detalhes
        if sip_client:
            info["sip_client_type"] = str(type(sip_client))
            info["sip_client_methods"] = [m for m in dir(sip_client) if not m.startswith('_')]
        
        return jsonify(info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/call-status/<request_id>', methods=['GET'])
def get_call_status(request_id):
    status = call_statuses.get(request_id)
    if not status:
        return jsonify({"error": "Request ID not found"}), 404
    return jsonify(status)

@app.route('/test-sip-call', methods=['POST'])
def test_sip_call():
    """Endpoint de teste para diagnosticar problemas de chamada SIP"""
    data = request.json or {}
    test_number = data.get('phoneNumber', '32998489879')
    
    if not sip_client:
        return jsonify({"error": "SIP client not initialized"}), 500
    
    # Adicionar prefixo 0 se não tiver (padrão Brasil)
    if len(test_number) >= 10 and not test_number.startswith('0'):
        test_number = f"0{test_number}"
    
    try:
        sip_status = getattr(sip_client, '_status', None)
        
        # Tentar fazer uma chamada de teste
        logger.info(f"🧪 TESTE: Tentando chamar {test_number}")
        call = sip_client.call(test_number)
        
        # Verificar estado imediatamente
        immediate_state = call.state
        time.sleep(0.5)
        state_after_500ms = call.state
        
        return jsonify({
            "success": True,
            "test_number": test_number,
            "sip_status_before_call": str(sip_status),
            "call_immediate_state": str(immediate_state),
            "call_state_after_500ms": str(state_after_500ms),
            "call_id": getattr(call, 'call_id', 'unknown'),
            "diagnosis": "Call created successfully" if immediate_state != CallState.ENDED else "Call ended immediately - check PABX configuration"
        })
    except Exception as e:
        import traceback
        logger.error(f"❌ Erro no teste: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500

@app.route('/make-call', methods=['POST'])

def make_call():
    data = request.json
    phone_number = data.get('phoneNumber')
    lead_name = data.get('leadName', 'Cliente')

    if not phone_number:
        return jsonify({"error": "phoneNumber required"}), 400
    
    # Gerar ID da requisição
    request_id = str(uuid.uuid4())
    
    # Inicializar status
    call_statuses[request_id] = {
        "status": "queued",
        "message": "Iniciando processo...",
        "logs": []
    }

    # Formatar número
    phone_number = phone_number.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
    if phone_number.startswith('55') and len(phone_number) > 11:
        phone_number = phone_number[2:]
    
    if len(phone_number) >= 10 and not phone_number.startswith('0'):
        phone_number = f"0{phone_number}"

    def call_worker(req_id, p_number, l_name):
        def update_status(status, msg, error=None):
            call_statuses[req_id]["status"] = status
            call_statuses[req_id]["message"] = msg
            call_statuses[req_id]["logs"].append(f"[{status}] {msg}")
            if error:
                call_statuses[req_id]["error"] = str(error)
        
        try:
            update_status("processing", "Obtendo URL assinada do ElevenLabs...")
            
            # 1. Obter URL assinada (Agora dentro da thread)
            url = f"https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id={ELEVENLABS_AGENT_ID}"
            headers = {"xi-api-key": ELEVENLABS_API_KEY}
            
            resp = requests.get(url, headers=headers, timeout=10)
            resp.raise_for_status()
            signed_url = resp.json()['signed_url']
            
            update_status("dialing", f"Discando para {p_number}...")
            
            # 2. Iniciar Chamada SIP
            if not sip_client:
                raise Exception("Cliente SIP não inicializado")

            call = sip_client.call(p_number)
            
            # ID da chamada
            call_id = getattr(call, 'call_id', None) or getattr(call, 'callID', None) or getattr(call, 'id', None) or str(int(time.time()))
            call_statuses[req_id]["call_id"] = call_id
            
            # Verificar estado imediato
            time.sleep(0.5)
            if call.state == CallState.ENDED:
                update_status("failed", "Chamada rejeitada pelo PABX (Ocupado ou Inválido)")
                return

            update_status("ringing", "Chamada iniciada, aguardando atendimento...")
            
            # Iniciar Bridge
            bridge = AudioBridge(call, signed_url, l_name, call_id)
            bridge.start()
            
            update_status("success", "Bridge de áudio iniciado!")

        except Exception as e:
            logger.error(f"❌ Erro na thread de chamada: {e}")
            update_status("error", f"Erro fatal: {str(e)}", e)

    # Iniciar a thread
    threading.Thread(target=call_worker, args=(request_id, phone_number, lead_name), daemon=True).start()

    return jsonify({
        "success": True,
        "request_id": request_id,
        "message": "Processo iniciado em background"
    }), 202


@app.route('/test-elevenlabs', methods=['GET'])
def test_elevenlabs():
    """Testa conexão com ElevenLabs sem SIP"""
    logs = []
    def log(msg):
        logger.info(f"🧪 TEST: {msg}")
        logs.append(msg)

    try:
        log("Iniciando teste de conexão ElevenLabs...")
        
        if not ELEVENLABS_AGENT_ID or not ELEVENLABS_API_KEY:
            log("❌ Credenciais ausentes!")
            return jsonify({"success": False, "logs": logs}), 500

        # 1. Get Signed URL
        url = f"https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id={ELEVENLABS_AGENT_ID}"
        headers = {"xi-api-key": ELEVENLABS_API_KEY}
        log(f"Requesting signed URL from: {url}")
        
        resp = requests.get(url, headers=headers)
        if resp.status_code != 200:
            log(f"❌ Erro ao obter URL assinada: {resp.status_code} - {resp.text}")
            return jsonify({"success": False, "logs": logs}), 500
            
        signed_url = resp.json()['signed_url']
        log("✅ URL assinada obtida com sucesso")

        # 2. Test WebSocket Connection
        import websocket
        ws_connected = False
        ws_error = None
        
        def on_open(ws):
            nonlocal ws_connected
            ws_connected = True
            log("✅ WebSocket conectado!")
            ws.close() # Fechar logo após conectar para o teste

        def on_error(ws, error):
            nonlocal ws_error
            ws_error = str(error)
            log(f"❌ Erro no WebSocket: {error}")

        log(f"Tentando conectar ao WebSocket: {signed_url[:50]}...")
        ws = websocket.WebSocketApp(signed_url, on_open=on_open, on_error=on_error)
        ws.run_forever()

        if ws_connected:
            log("✅ Teste concluído com SUCESSO!")
            return jsonify({"success": True, "logs": logs})
        else:
            log(f"❌ Falha na conexão WebSocket. Erro: {ws_error}")
            return jsonify({"success": False, "logs": logs}), 500

    except Exception as e:
        log(f"❌ Exceção não tratada: {str(e)}")
        import traceback
        log(traceback.format_exc())
        return jsonify({"success": False, "logs": logs, "error": str(e)}), 500

# Iniciar SIP ao arrancar (em thread separada para não bloquear o Flask)
# Aguardar um pouco antes de iniciar o SIP para garantir que o Flask está pronto
def delayed_sip_start():
    time.sleep(2)  # Aguardar 2 segundos para o Flask iniciar
    try:
        logger.info("🚀 Iniciando cliente SIP em background...")
        start_sip_client()
    except Exception as e:
        logger.error(f"❌ Erro ao iniciar SIP client em background: {e}")
        import traceback
        logger.error(traceback.format_exc())

@app.route('/start-sip', methods=['POST'])
def manual_start_sip():
    threading.Thread(target=start_sip_client, daemon=True).start()
    return jsonify({"message": "SIP Client startup triggered in background"})

# threading.Thread(target=delayed_sip_start, daemon=True).start()

if __name__ == '__main__':
    logger.info(f"🚀 Iniciando servidor Flask na porta {PORT}...")
    app.run(host='0.0.0.0', port=PORT)
