FROM node:18-bullseye

# Instalar dependências de compilação (necessário para @roamhq/wrtc)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Configurar npm para usar python3
RUN npm config set python python3

# Instalar dependências (agora com ferramentas para compilar se necessário)
RUN npm install

COPY . .

EXPOSE 3000
EXPOSE 5060/udp

CMD ["node", "server.js"]
