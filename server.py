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

# ... (imports)

@app.route('/health', methods=['GET'])
def health():
    status_str = "unknown"
    if sip_client:
        try:
            # pyVoIP define status como um enum
            status_enum = sip_client.get_status() # Tentar get_status se existir, ou acessar atributo
        except:
            try:
                status_enum = sip_client._status
            except:
                status_enum = "error_reading_status"
        
        status_str = str(status_enum)

    return jsonify({
        "status": "ok",
        "version": "2.1-PYTHON-FIX",
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
        
        call = sip_client.call(phone_number)
        
        # DEBUG: Ver o que tem dentro do objeto call
        try:
            logger.info(f"🔍 Atributos do Call: {dir(call)}")
        except:
            pass
            
        # Tentar pegar ID de várias formas ou gerar um
        call_id = getattr(call, 'callID', None) or getattr(call, 'id', None) or str(int(time.time()))
        
        # Iniciar Bridge em background
        bridge = AudioBridge(call, signed_url, lead_name, call_id)
        bridge.start()

        return jsonify({
            "success": True,
            "message": "Chamada iniciada",
            "callId": call_id
        })

    except Exception as e:
        logger.error(f"❌ Erro make-call: {e}")
        return jsonify({"error": str(e)}), 500

# Iniciar SIP ao arrancar (em thread separada para não bloquear o Flask)
threading.Thread(target=start_sip_client, daemon=True).start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)
