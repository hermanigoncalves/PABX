FROM python:3.9-slim

WORKDIR /app

# Copiar apenas as dependências essenciais
COPY requirements_simple.txt requirements.txt

RUN pip install --no-cache-dir -r requirements.txt

# Usar a versão NOVA que faz chamadas diretas via ElevenLabs API
COPY server_elevenlabs_direct.py server.py
COPY .env* ./

# Porta da API HTTP (ElevenLabs faz a conexão SIP diretamente)
EXPOSE 3000

CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:3000", "server:app"]
