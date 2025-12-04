import os
import logging
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import requests

# Configuração de Logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

# Configurações
PORT = int(os.getenv('PORT', 3000))
ELEVENLABS_AGENT_ID = os.getenv('ELEVENLABS_AGENT_ID')
ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY')

# Validar configurações críticas
if not all([ELEVENLABS_AGENT_ID, ELEVENLABS_API_KEY]):
    logger.error("❌ Configurações de ambiente incompletas!")

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "version": "3.0-ELEVENLABS-DIRECT",
        "agent_configured": bool(ELEVENLABS_AGENT_ID),
        "api_key_configured": bool(ELEVENLABS_API_KEY)
    })

@app.route('/make-call', methods=['POST'])
def make_call():
    """
    Faz chamada usando a API do ElevenLabs diretamente.
    O ElevenLabs conecta ao SIP trunk e gerencia todo o áudio.
    """
    data = request.json
    phone_number = data.get('phoneNumber')
    lead_name = data.get('leadName', 'Cliente')

    if not phone_number:
        return jsonify({"error": "phoneNumber required"}), 400

    try:
        logger.info("=" * 80)
        logger.info(f"📞 Iniciando chamada ElevenLabs para {phone_number}")
        logger.info(f"👤 Lead: {lead_name}")
        logger.info("=" * 80)

        # Endpoint da API do ElevenLabs para fazer chamadas
        url = f"https://api.elevenlabs.io/v1/convai/conversation"
        
        headers = {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json"
        }
        
        # Payload para iniciar chamada
        payload = {
            "agent_id": ELEVENLABS_AGENT_ID,
            "mode": "call",
            "call_config": {
                "to": phone_number,
                "from": "701"  # Ramal do PABX
            },
            "conversation_config_override": {
                "agent": {
                    "prompt": {
                        "prompt": f"Você está ligando para {lead_name}. Seja cordial e profissional. Fale em português do Brasil."
                    },
                    "first_message": f"Olá {lead_name}, tudo bem? Estou ligando para confirmar algumas informações."
                }
            }
        }

        logger.info(f"📡 Enviando requisição para ElevenLabs...")
        logger.info(f"   Agent ID: {ELEVENLABS_AGENT_ID}")
        logger.info(f"   Número: {phone_number}")
        
        response = requests.post(url, json=payload, headers=headers)
        
        logger.info(f"📥 Status Code: {response.status_code}")
        
        if response.status_code == 200 or response.status_code == 201:
            result = response.json()
            logger.info("✅ Chamada iniciada com sucesso!")
            logger.info(f"   Conversation ID: {result.get('conversation_id', 'N/A')}")
            
            return jsonify({
                "success": True,
                "message": "Chamada iniciada via ElevenLabs",
                "conversation_id": result.get('conversation_id'),
                "phoneNumber": phone_number,
                "leadName": lead_name
            })
        else:
            logger.error(f"❌ Erro na API ElevenLabs: {response.status_code}")
            logger.error(f"   Response: {response.text}")
            
            return jsonify({
                "success": False,
                "error": f"ElevenLabs API error: {response.status_code}",
                "details": response.text
            }), response.status_code

    except Exception as e:
        logger.error(f"❌ Erro ao fazer chamada: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

if __name__ == '__main__':
    logger.info("🚀 Servidor ElevenLabs Direct iniciando...")
    logger.info(f"   Porta: {PORT}")
    logger.info(f"   Agent ID: {ELEVENLABS_AGENT_ID}")
    app.run(host='0.0.0.0', port=PORT)

