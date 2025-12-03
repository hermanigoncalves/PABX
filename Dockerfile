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

# Criar link simbólico para que 'python' aponte para 'python3'
RUN ln -s /usr/bin/python3 /usr/bin/python

# Instalar dependências
RUN npm install

COPY . .

EXPOSE 3000
EXPOSE 5060/udp

CMD ["node", "server.js"]
