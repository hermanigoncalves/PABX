FROM node:16-bullseye

# Instalar dependências do sistema para wrtc (WebRTC)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Instalar dependências do Node (forçando build do wrtc se necessário)
RUN npm install --build-from-source

COPY . .

EXPOSE 3000
EXPOSE 5060/udp

CMD ["node", "server.js"]
