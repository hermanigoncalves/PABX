FROM node:18-bullseye

# Instalar dependências do sistema para compilação do WebRTC
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Configurar variável de ambiente para o Python (mais seguro que npm config)
ENV PYTHON=/usr/bin/python3

# Usar Yarn para instalar dependências
RUN yarn install

COPY . .

EXPOSE 3000
EXPOSE 5060/udp

CMD ["node", "server.js"]
