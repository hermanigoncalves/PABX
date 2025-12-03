FROM node:18

# Instalar dependências de compilação robustas
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Definir variável de ambiente para o Python 3
ENV PYTHON=/usr/bin/python3

# Limpar cache e instalar dependências
RUN npm cache clean --force && npm install

COPY . .

EXPOSE 3000
EXPOSE 5060/udp

CMD ["node", "server.js"]
