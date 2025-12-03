FROM node:18-bullseye

WORKDIR /app

COPY package*.json ./

# Instalar dependências (confiando nos binários pré-compilados do @roamhq/wrtc)
RUN npm install

COPY . .

EXPOSE 3000
EXPOSE 5060/udp

CMD ["node", "server.js"]
