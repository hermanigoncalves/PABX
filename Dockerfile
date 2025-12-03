FROM python:3.9-slim

WORKDIR /app

# Instalar dependências do sistema (necessário para algumas libs de áudio se precisarmos)
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Porta da API HTTP
EXPOSE 3000
# Porta SIP (UDP)
EXPOSE 5060/udp
# Porta RTP (UDP) - Intervalo comum, ajustável no código
EXPOSE 10000-20000/udp

CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:3000", "server:app"]
