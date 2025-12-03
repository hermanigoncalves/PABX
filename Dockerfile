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

# Configurar npm para usar python3 (caso algum script use npm internamente)
RUN npm config set python python3

# Usar Yarn para instalar dependências (mais robusto para binários nativos)
RUN yarn install

COPY . .

EXPOSE 3000
EXPOSE 5060/udp

CMD ["node", "server.js"]
