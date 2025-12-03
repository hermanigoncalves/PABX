import net from 'net';
import crypto from 'crypto';
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import os from 'os';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const PABX_HOST = process.env.FACILPABX_HOST;
const PABX_PORT = 5060;
const PABX_USER = process.env.FACILPABX_USER;
const PABX_PASS = process.env.FACILPABX_PASSWORD;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

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

class SIPClient {
    constructor() {
        this.client = new net.Socket();
        this.connected = false;
        this.cseq = 1;
        this.callId = crypto.randomBytes(8).toString('hex');
        this.tag = crypto.randomBytes(4).toString('hex');

        this.client.on('data', (data) => this.onData(data));
        this.client.on('close', () => {
            console.log('SIP Connection closed');
            this.connected = false;
        });
        this.client.on('error', (err) => console.error('SIP Error:', err));
    }

    connect() {
        return new Promise((resolve) => {
            this.client.connect(PABX_PORT, PABX_HOST, () => {
                console.log('Connected to PABX via TCP');
                this.connected = true;
                setInterval(() => {
                    if (this.connected) this.client.write('\r\n\r\n');
                }, 30000);
                resolve();
            });
        });
    }

    send(msg) {
        console.log('>>> SENDING:\n' + msg);
        this.client.write(msg);
    }

    onData(data) {
        const msg = data.toString();
        console.log('<<< RECEIVED:\n' + msg);

        const lines = msg.split('\r\n');
        const firstLine = lines[0];

        if (firstLine.includes('401') || firstLine.includes('407')) {
            this.handleAuth(msg);
        } else if (firstLine.includes('200 OK')) {
            if (msg.includes('REGISTER')) {
                console.log('✅ REGISTERED SUCCESSFULLY!');
            } else if (msg.includes('INVITE')) {
                console.log('✅ CALL ANSWERED!');
            }
        }
    }

    handleAuth(msg) {
        const authHeader = msg.match(/(WWW|Proxy)-Authenticate: Digest (.*)/i);
        if (!authHeader) return;

        const params = {};
        authHeader[2].split(',').forEach(p => {
            const [key, val] = p.trim().split('=');
            if (key && val) params[key] = val.replace(/"/g, '');
        });

        const realm = params.realm;
        const nonce = params.nonce;
        const method = msg.includes('REGISTER') ? 'REGISTER' : 'INVITE';
        const uri = `sip:${PABX_HOST}`;

        const ha1 = crypto.createHash('md5').update(`${PABX_USER}:${realm}:${PABX_PASS}`).digest('hex');
        const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
        const response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');

        const authLine = `Digest username="${PABX_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=MD5`;

        if (method === 'REGISTER') {
            this.register(authLine);
        } else if (method === 'INVITE') {
            const ack = `ACK ${uri} SIP/2.0\r
Via: SIP/2.0/TCP ${LOCAL_IP}:${PORT};branch=z9hG4bK${crypto.randomBytes(4).toString('hex')}\r
Max-Forwards: 70\r
To: <sip:${PABX_USER}@${PABX_HOST}>;tag=${params.tag || ''}\r
From: <sip:${PABX_USER}@${PABX_HOST}>;tag=${this.tag}\r
Call-ID: ${this.callId}\r
CSeq: ${this.cseq - 1} ACK\r
Content-Length: 0\r
\r
`;
            this.send(ack);

            if (this.lastTarget) {
                this.invite(this.lastTarget, authLine);
            }
        }
    }

    register(authHeader = null) {
        const branch = crypto.randomBytes(4).toString('hex');
        let msg = `REGISTER sip:${PABX_HOST} SIP/2.0\r
Via: SIP/2.0/TCP ${LOCAL_IP}:${PORT};branch=z9hG4bK${branch}\r
Max-Forwards: 70\r
To: <sip:${PABX_USER}@${PABX_HOST}>\r
From: <sip:${PABX_USER}@${PABX_HOST}>;tag=${this.tag}\r
Call-ID: ${this.callId}\r
CSeq: ${this.cseq++} REGISTER\r
Contact: <sip:${PABX_USER}@${LOCAL_IP}:${PORT};transport=tcp>\r
Expires: 3600\r
Content-Length: 0\r
`;
        if (authHeader) {
            msg += `Authorization: ${authHeader}\r\n`;
        }
        msg += '\r\n';
        this.send(msg);
    }

    invite(phoneNumber, authHeader = null) {
        this.lastTarget = phoneNumber;
        const branch = crypto.randomBytes(4).toString('hex');
        const target = `sip:${phoneNumber}@${PABX_HOST}`;

        const sdp = `v=0
o=- ${Date.now()} ${Date.now()} IN IP4 ${LOCAL_IP}
s=-
c=IN IP4 ${LOCAL_IP}
t=0 0
m=audio 10000 RTP/AVP 0 8 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`;

        let msg = `INVITE ${target} SIP/2.0\r
Via: SIP/2.0/TCP ${LOCAL_IP}:${PORT};branch=z9hG4bK${branch}\r
Max-Forwards: 70\r
To: <sip:${phoneNumber}@${PABX_HOST}>\r
From: <sip:${PABX_USER}@${PABX_HOST}>;tag=${this.tag}\r
Call-ID: ${this.callId}\r
CSeq: ${this.cseq++} INVITE\r
Contact: <sip:${PABX_USER}@${LOCAL_IP}:${PORT};transport=tcp>\r
Content-Type: application/sdp\r
Content-Length: ${sdp.length}\r
`;
        if (authHeader) {
            msg += `Authorization: ${authHeader}\r\n`;
        }
        msg += '\r\n' + sdp;
        this.send(msg);
    }
}

const sipClient = new SIPClient();

app.post('/make-call', async (req, res) => {
    const { phoneNumber, leadName } = req.body;
    try {
        if (!sipClient.connected) {
            await sipClient.connect();
            sipClient.register();
        }

        const elRes = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${ELEVENLABS_AGENT_ID}`,
            { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
        );
        console.log('ElevenLabs URL obtained');

        sipClient.invite(phoneNumber);
        res.json({ success: true, message: 'Calling...' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, async () => {
    console.log(`TCP SIP Server running on port ${PORT}`);
    try {
        await sipClient.connect();
        sipClient.register();
    } catch (e) {
        console.error('Startup Error:', e);
    }
});
