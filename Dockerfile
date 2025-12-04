FROM python:3.9-slim

WORKDIR /app

# Copiar dependências
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Usar o server.py original que funciona com WebSocket
COPY server.py .
COPY .env* ./
COPY templates ./templates
COPY static ./static

# Porta da API HTTP
EXPOSE 3000
# Porta SIP (Sinalização) - CRÍTICO para receber chamadas/respostas
EXPOSE 5060/udp
EXPOSE 5060/tcp
# Portas RTP (Áudio) - CRÍTICO para ouvir/falar
EXPOSE 10000-20000/udp

CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:3000", "server:app"]
