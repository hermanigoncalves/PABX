import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { WebSocket } from 'ws';
import cors from 'cors';
import axios from 'axios';
import { UserAgent, Inviter } from 'sip.js';
import { createRequire } from 'module';

// Tentar importar wrtc opcionalmente
let wrtc;
try {
  const require = createRequire(import.meta.url);
  wrtc = require('@roamhq/wrtc');
  console.log('✅ @roamhq/wrtc (WebRTC) carregado com sucesso');
} catch (error) {
  console.error('⚠️ Falha ao carregar wrtc:', error.message);
  console.error('O suporte a áudio SIP NÃO funcionará.');
}

console.log('🚀 Iniciando servidor...');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const SIP_PORT = process.env.SIP_PORT || 5060;

// Configurações
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_1201kbgrr40de7gv00cr3g48ejvf';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const FACILPABX_HOST = process.env.FACILPABX_HOST || 'revier.fpabx.com.br';
const FACILPABX_USER = process.env.FACILPABX_USER || '701';
const FACILPABX_PASSWORD = process.env.FACILPABX_PASSWORD || '123456';

// Armazenar chamadas ativas
const activeCalls = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.3-ESM',
    timestamp: new Date().toISOString(),
    activeCalls: activeCalls.size,
    config: {
      agentId: ELEVENLABS_AGENT_ID ? '✓ Configurado' : '✗ Não configurado',
      apiKey: ELEVENLABS_API_KEY ? '✓ Configurado' : '✗ Não configurado',
      pabx: FACILPABX_HOST ? '✓ Configurado' : '✗ Não configurado'
    }
  });
});

// Endpoint para iniciar chamada
app.post('/make-call', async (req, res) => {
  const { phoneNumber, leadName } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: 'phoneNumber é obrigatório' });
  }

  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    return res.status(500).json({ success: false, error: 'ElevenLabs não configurado.' });
  }

  console.log(`📞 Iniciando chamada para: ${phoneNumber} (${leadName || 'Lead'})`);

  try {
    // 1. Obter URL assinada do ElevenLabs
    const response = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${ELEVENLABS_AGENT_ID}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    const signedUrl = response.data.signed_url;
    console.log('✅ URL assinada obtida do ElevenLabs');

    // 2. Conectar ao WebSocket do ElevenLabs
    const ws = new WebSocket(signedUrl);
    const callId = Date.now().toString();

    ws.on('open', async () => {
      console.log(`🔗 WebSocket conectado para chamada ${callId}`);

      // Enviar dados iniciais
      ws.send(JSON.stringify({
        type: 'conversation_initiation_client_data',
        conversation_config_override: {
          agent: {
            prompt: {
              prompt: `O nome do lead é ${leadName || 'o cliente'}. Use este nome de forma natural.`
            }
          }
        }
      }));

      // 3. Iniciar chamada SIP
      try {
        console.log('✅ Configurando UserAgent SIP (v0.21.x)...');

        // Hack para SIP.js encontrar o WebRTC no Node
        if (wrtc) {
          // Polyfill para addEventListener (que falta no wrtc mas o SIP.js exige)
          if (!wrtc.RTCPeerConnection.prototype.addEventListener) {
            wrtc.RTCPeerConnection.prototype.addEventListener = function (type, fn) {
              if (type === 'icecandidate') this.onicecandidate = fn;
              if (type === 'track') this.ontrack = fn;
              if (type === 'iceconnectionstatechange') this.oniceconnectionstatechange = fn;
              if (type === 'connectionstatechange') this.onconnectionstatechange = fn;
              if (type === 'signalingstatechange') this.onsignalingstatechange = fn;
              if (type === 'negotiationneeded') this.onnegotiationneeded = fn;
            };
            wrtc.RTCPeerConnection.prototype.removeEventListener = function () { }; // No-op
          }

          global.RTCPeerConnection = wrtc.RTCPeerConnection;
          global.RTCSessionDescription = wrtc.RTCSessionDescription;
          global.RTCIceCandidate = wrtc.RTCIceCandidate;
          global.navigator = { userAgent: 'node' };
          global.window = global;
          global.WebSocket = WebSocket; // Injetar WebSocket globalmente para o SIP.js
          console.log('✅ WebRTC (wrtc) e WebSocket injetados no ambiente global para SIP.js');
        }

        const userAgent = new UserAgent({
          uri: UserAgent.makeURI(`sip:${FACILPABX_USER}@${FACILPABX_HOST}`),
          transportOptions: {
            server: `wss://${FACILPABX_HOST}:${SIP_PORT}`,
            traceSip: true
          },
          authorizationUsername: FACILPABX_USER,
          authorizationPassword: FACILPABX_PASSWORD,
        });

        console.log('🔄 Conectando ao PABX...');
        await userAgent.start();
        console.log('✅ Conectado ao PABX! Registrando...');

        await userAgent.register();
        console.log('✅ Registrado! Iniciando discagem...');

        const target = UserAgent.makeURI(`sip:${phoneNumber}@${FACILPABX_HOST}`);
        if (!target) {
          throw new Error('URI de destino inválida');
        }

        const inviter = new Inviter(userAgent, target);

        // Configurar eventos da sessão
        inviter.stateChange.addListener((newState) => {
          console.log(`📞 Estado da chamada SIP: ${newState}`);
          if (newState === 'Established') {
            console.log('✅ Chamada ATENDIDA!');
          }
        });

        await inviter.invite();
        console.log(`🚀 Convite SIP enviado para ${phoneNumber}`);

        activeCalls.set(callId, {
          phoneNumber,
          leadName,
          ws,
          userAgent,
          inviter,
          startTime: new Date()
        });

        res.json({
          success: true,
          message: 'Chamada SIP iniciada e discando...',
          callId: callId
        });

      } catch (sipError) {
        console.error('❌ Erro SIP:', sipError.message);
        // Não fechar o WS imediatamente para podermos ver o erro no log, mas idealmente fecharia
        // ws.close();
        throw sipError;
      }
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'agent_response') {
        console.log(`🤖 Agente: ${message.agent_response?.text}`);
      }
      if (message.type === 'audio') {
        // Aqui o áudio base64 do ElevenLabs seria enviado para o stream SIP
      }
    });

    ws.on('close', () => {
      console.log(`🔌 WebSocket fechado: ${callId}`);
      activeCalls.delete(callId);
    });

    ws.on('error', (error) => {
      console.error(`❌ Erro no WebSocket: ${error.message}`);
    });

  } catch (error) {
    console.error('❌ Erro:', error.message);
    if (error.response) {
      console.error('Detalhes da resposta:', JSON.stringify(error.response.data));
    }
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response ? error.response.data : null
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor v1.3-ESM rodando na porta ${PORT}`);
});
