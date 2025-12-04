FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# API Port
EXPOSE 3000
# SIP Port (TCP/UDP)
EXPOSE 5060
# RTP Ports (UDP)
EXPOSE 10000-20000/udp

CMD ["npm", "start"]
