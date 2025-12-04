import net from 'net';
import dgram from 'dgram';
import crypto from 'crypto';
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import os from 'os';
import axios from 'axios';
import WebSocket from 'ws';
import { ulawToLinear, linearToUlaw, RTPHeader } from './rtp_utils.js';

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

// RTP Configuration
const RTP_PORT = 10000; // Must match SDP offer
const udpServer = dgram.createSocket('udp4');

udpServer.on('error', (err) => {
    console.error(`UDP Server error:\n${err.stack}`);
    udpServer.close();
});

udpServer.on('listening', () => {
    const address = udpServer.address();
    console.log(`UDP Server listening for RTP on ${address.address}:${address.port}`);
});

udpServer.bind(RTP_PORT);

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

// Global state for active call audio bridging
let activeCall = {
    remoteRtpIp: null,
    remoteRtpPort: null,
    elevenLabsWs: null,
    isBridging: false
};

function setupAudioBridge(remoteIp, remotePort, signedUrl) {
    console.log(`Starting Audio Bridge to ${remoteIp}:${remotePort}`);
    activeCall.remoteRtpIp = remoteIp;
    activeCall.remoteRtpPort = remotePort;
    activeCall.isBridging = true;

    // Connect to ElevenLabs
    const ws = new WebSocket(signedUrl);
    activeCall.elevenLabsWs = ws;

    ws.on('open', () => {
        console.log('✅ Connected to ElevenLabs WebSocket');
        // Initial configuration if needed (e.g. sample rate)
        // ElevenLabs defaults to 16kHz or 24kHz usually, but we need to check docs.
        // For now assuming standard behavior.
        const initialConfig = {
            "type": "conversation_initiation_client_data",
            "conversation_config_override": {
                "agent": {
                    "prompt": {
                        "prompt": "You are a helpful assistant named Renato. You speak Portuguese."
                    },
                    "first_message": "Olá, eu sou o Renato. Como posso ajudar com seu plano de saúde hoje?",
                    "language": "pt"
                },
                "tts": {
                    "voice_id": "JBFqnCBsd6RMkjVDRZzb" // Example voice
                }
            }
        };
        // ws.send(JSON.stringify(initialConfig)); // Optional: Send config
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            if (message.type === 'audio') {
                // Received audio from ElevenLabs (Base64 PCM)
                // Assuming ElevenLabs sends PCM 16-bit, 16kHz or similar.
                // SIP requires G.711 u-law 8kHz.

                // NOTE: Real-time resampling from 16k/24k to 8k is complex in pure JS without libraries.
                // For this MVP, we will try to just transcode and send, hoping ElevenLabs can output 8k 
                // or that the mismatch isn't fatal (it will sound slow/fast if rate mismatches).
                // Ideally we need a resampler here.

                const pcmBuffer = Buffer.from(message.audio_event.audio_base_64, 'base64');

                // Transcode PCM -> u-law
                const ulawBuffer = linearToUlaw(pcmBuffer);

                // Packetize into RTP
                // Max RTP payload is usually ~160 bytes (20ms at 8kHz)
                // We might need to chunk it.

                const CHUNK_SIZE = 160;
                for (let i = 0; i < ulawBuffer.length; i += CHUNK_SIZE) {
                    const chunk = ulawBuffer.subarray(i, i + CHUNK_SIZE);

                    const rtpHeader = new RTPHeader();
                    rtpHeader.sequenceNumber = (activeCall.sequenceNumber || 0) + 1;
                    rtpHeader.timestamp = (activeCall.timestamp || 0) + chunk.length;
                    rtpHeader.ssrc = 123456;
                    rtpHeader.payloadType = 0; // PCMU

                    activeCall.sequenceNumber = rtpHeader.sequenceNumber;
                    activeCall.timestamp = rtpHeader.timestamp;

                    const headerBuf = rtpHeader.toBuffer();
                    const packet = Buffer.concat([headerBuf, chunk]);

                    udpServer.send(packet, activeCall.remoteRtpPort, activeCall.remoteRtpIp);
                }
            } else if (message.type === 'agent_response') {
                console.log(`Agent: ${message.agent_response_event.agent_response}`);
            }

        } catch (e) {
            console.error('Error parsing ElevenLabs message:', e);
        }
    });

    ws.on('close', () => {
        console.log('ElevenLabs WebSocket closed');
        activeCall.isBridging = false;
    });

    ws.on('error', (err) => {
        console.error('ElevenLabs WebSocket error:', err);
    });
}

// Handle incoming RTP from PABX (User Voice)
udpServer.on('message', (msg, rinfo) => {
    if (!activeCall.isBridging || !activeCall.elevenLabsWs || activeCall.elevenLabsWs.readyState !== WebSocket.OPEN) {
        return;
    }

    // Simple check to ensure it's from the connected peer (optional but good security)
    // if (rinfo.address !== activeCall.remoteRtpIp) return;

    // Strip RTP Header (12 bytes)
    const payload = msg.subarray(12);

    // Transcode u-law -> PCM
    const pcmBuffer = ulawToLinear(payload);

    // Send to ElevenLabs
    const userAudioMsg = {
        "type": "user_audio_chunk",
        "user_audio_chunk_event": {
            "audio_base_64": pcmBuffer.toString('base64')
        }
    };

    activeCall.elevenLabsWs.send(JSON.stringify(userAudioMsg));
});


class SIPClient {
    constructor() {
        this.client = new net.Socket();
        this.connected = false;
        this.cseq = 1;
        this.callId = crypto.randomBytes(8).toString('hex');
        this.tag = crypto.randomBytes(4).toString('hex');
        this.lastSignedUrl = null;

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
        // console.log('<<< RECEIVED:\n' + msg); // Verbose

        const lines = msg.split('\r\n');
        const firstLine = lines[0];

        if (firstLine.includes('401') || firstLine.includes('407')) {
            this.handleAuth(msg);
        } else if (firstLine.includes('200 OK')) {
            if (msg.includes('REGISTER')) {
                console.log('✅ REGISTERED SUCCESSFULLY!');
            } else if (msg.includes('INVITE')) {
                console.log('✅ CALL ANSWERED! Starting Audio Bridge...');
                this.handleCallAnswered(msg);
            }
        }
    }

    handleCallAnswered(msg) {
        // Parse SDP to find remote RTP IP and Port
        const ipMatch = msg.match(/c=IN IP4 ([\d.]+)/);
        const portMatch = msg.match(/m=audio (\d+) RTP\/AVP/);

        if (ipMatch && portMatch) {
            const remoteIp = ipMatch[1];
            const remotePort = parseInt(portMatch[1]);
            console.log(`Remote RTP: ${remoteIp}:${remotePort}`);

            if (this.lastSignedUrl) {
                setupAudioBridge(remoteIp, remotePort, this.lastSignedUrl);
            } else {
                console.error('❌ No signed URL available for audio bridge');
            }
        } else {
            console.error('❌ Could not parse SDP from 200 OK');
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
m=audio ${RTP_PORT} RTP/AVP 0 101
a=rtpmap:0 PCMU/8000
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

        sipClient.lastSignedUrl = elRes.data.signed_url;
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
