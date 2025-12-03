import sip from 'sip';
import dgram from 'dgram';
import crypto from 'crypto';
import express from 'express';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const SIP_PORT = 5060; // Local SIP port
const RTP_PORT = 10000; // Local RTP port

const PABX_HOST = process.env.FACILPABX_HOST;
const PABX_USER = process.env.FACILPABX_USER;
const PABX_PASS = process.env.FACILPABX_PASSWORD;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Simple RTP Socket
const rtpSocket = dgram.createSocket('udp4');
rtpSocket.bind(RTP_PORT);

rtpSocket.on('message', (msg, rinfo) => {
    // Received RTP. TODO: Send to ElevenLabs
});

// SIP Stack
const sipStack = sip.create({
    port: SIP_PORT,
    udp: false,
    tcp: true
}, (req) => {
    console.log(`SIP REQUEST: ${req.method} ${req.uri}`);
    // Handle incoming requests (BYE, etc)
    if (req.method === 'BYE') {
        sipStack.send(sip.makeResponse(req, 200, 'OK'));
    }
});

function getAuthResponse(realm, method, uri, nonce, username, password) {
    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
    const response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
    return response;
}

function makeSdp(ip, port) {
    return `v=0
o=- ${Date.now()} ${Date.now()} IN IP4 ${ip}
s=-
c=IN IP4 ${ip}
t=0 0
m=audio ${port} RTP/AVP 0 8 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv`;
}

// Register
function register() {
    const uri = `sip:${PABX_USER}@${PABX_HOST}`;
    const request = {
        method: 'REGISTER',
        uri: uri,
        headers: {
            to: { uri: uri },
            from: { uri: uri, params: { tag: crypto.randomBytes(4).toString('hex') } },
            'call-id': crypto.randomBytes(8).toString('hex'),
            cseq: { method: 'REGISTER', seq: 1 },
            contact: [{ uri: `sip:${PABX_USER}@${getLocalIp()}:${SIP_PORT}` }],
            expires: 3600,
            'max-forwards': 70,
            'user-agent': 'NodeJS SIP Client'
        }
    };

    console.log(`Attempting to register with ${uri} using local IP ${getLocalIp()}`);
    sipStack.send(request, (res) => {
        console.log(`REGISTER Response: ${res.status} ${res.reason}`);
        if (res.status === 401 || res.status === 407) {
            const auth = res.headers['www-authenticate'] || res.headers['proxy-authenticate'];
            const realm = auth.realm;
            const nonce = auth.nonce;
            const response = getAuthResponse(realm, 'REGISTER', uri, nonce, PABX_USER, PABX_PASS);

            request.headers.cseq.seq++;
            request.headers.authorization = {
                username: PABX_USER,
                realm: realm,
                nonce: nonce,
                uri: uri,
                response: response,
                algorithm: 'MD5'
            };

            sipStack.send(request, (res2) => {
                console.log(`REGISTER Auth Response: ${res2.status} ${res2.reason}`);
            });
        }
    });
}

import os from 'os';

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

// API
app.post('/make-call', async (req, res) => {
    const { phoneNumber, leadName } = req.body;

    // 1. Get ElevenLabs Signed URL
    try {
        const elRes = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${ELEVENLABS_AGENT_ID}`,
            { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
        );
        const signedUrl = elRes.data.signed_url;

        // 2. Connect to ElevenLabs WS (TODO: Implement bridging)
        const ws = new WebSocket(signedUrl);
        ws.on('open', () => {
            ws.send(JSON.stringify({
                type: 'conversation_initiation_client_data',
                conversation_config_override: {
                    agent: { prompt: { prompt: `Lead: ${leadName}` } }
                }
            }));
        });

        // 3. SIP Invite
        const target = `sip:${phoneNumber}@${PABX_HOST}`;
        const invite = {
            method: 'INVITE',
            uri: target,
            headers: {
                to: { uri: target },
                from: { uri: `sip:${PABX_USER}@${PABX_HOST}`, params: { tag: crypto.randomBytes(4).toString('hex') } },
                'call-id': crypto.randomBytes(8).toString('hex'),
                cseq: { method: 'INVITE', seq: 1 },
                contact: [{ uri: `sip:${PABX_USER}@${getLocalIp()}:${SIP_PORT}` }],
                'content-type': 'application/sdp',
                'max-forwards': 70,
                'user-agent': 'NodeJS SIP Client'
            },
            content: makeSdp(getLocalIp(), RTP_PORT)
        };

        console.log(`Sending INVITE to ${target}`);
        sipStack.send(invite, (res) => {
            console.log(`INVITE Response: ${res.status} ${res.reason}`);
            if (res.status === 401 || res.status === 407) {
                // Handle Auth (Similar to Register)
                const auth = res.headers['www-authenticate'] || res.headers['proxy-authenticate'];
                const realm = auth.realm;
                const nonce = auth.nonce;
                const response = getAuthResponse(realm, 'INVITE', target, nonce, PABX_USER, PABX_PASS);

                invite.headers.cseq.seq++;
                invite.headers.authorization = {
                    username: PABX_USER,
                    realm: realm,
                    nonce: nonce,
                    uri: target,
                    response: response,
                    algorithm: 'MD5'
                };
                sipStack.send(invite, (res2) => {
                    console.log(`INVITE Auth Response: ${res2.status} ${res2.reason}`);
                    if (res2.status === 200) {
                        sipStack.send({
                            method: 'ACK',
                            uri: res2.headers.contact[0].uri,
                            headers: {
                                to: res2.headers.to,
                                from: res2.headers.from,
                                'call-id': res2.headers['call-id'],
                                cseq: { method: 'ACK', seq: invite.headers.cseq.seq },
                                'max-forwards': 70,
                                via: res2.headers.via
                            }
                        });
                    }
                });
            }
            if (res.status === 200) {
                sipStack.send({
                    method: 'ACK',
                    uri: res.headers.contact[0].uri,
                    headers: {
                        to: res.headers.to,
                        from: res.headers.from,
                        'call-id': res.headers['call-id'],
                        cseq: { method: 'ACK', seq: invite.headers.cseq.seq },
                        'max-forwards': 70,
                        via: res.headers.via
                    }
                });
            }
        });

        res.json({ success: true, message: 'Calling...' });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`UDP SIP Server running on port ${PORT}`);
    register();
    setInterval(register, 1800000); // Re-register every 30m
});
