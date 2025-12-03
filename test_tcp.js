import net from 'net';
import os from 'os';

const HOST = 'revier.fpabx.com.br';
const PORT = 5060;
const USER = '701';

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const LOCAL_IP = getLocalIp();
const TAG = Math.floor(Math.random() * 1000000);
const CALL_ID = Math.floor(Math.random() * 1000000);
const BRANCH = Math.floor(Math.random() * 1000000);

const packet = `REGISTER sip:${HOST} SIP/2.0\r
Via: SIP/2.0/TCP ${LOCAL_IP}:5060;branch=z9hG4bK${BRANCH}\r
Max-Forwards: 70\r
To: <sip:${USER}@${HOST}>\r
From: <sip:${USER}@${HOST}>;tag=${TAG}\r
Call-ID: ${CALL_ID}\r
CSeq: 1 REGISTER\r
Contact: <sip:${USER}@${LOCAL_IP}:5060;transport=tcp>\r
Content-Length: 0\r
\r
`;

console.log('Sending packet:\n' + packet);

const client = new net.Socket();
client.connect(PORT, HOST, () => {
    console.log('Connected to PABX via TCP');
    client.write(packet);
});

client.on('data', (data) => {
    console.log('Received: ' + data);
    client.destroy();
});

client.on('close', () => {
    console.log('Connection closed');
});

client.on('error', (err) => {
    console.error('Error: ' + err.message);
});
