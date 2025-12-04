FROM python:3.9-slim

WORKDIR /app

# Copiar apenas as dependências essenciais
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY .env* ./

# Porta da API HTTP (ElevenLabs faz a conexão SIP diretamente)
EXPOSE 3000

CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:3000", "server:app"]
