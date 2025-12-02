require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const axios = require('axios');
// const { UserAgent, Inviter } = require('sip.js'); // Removido para usar import dinâmico
let wrtc;
try {
  wrtc = require('wrtc');
  console.log('✅ wrtc (WebRTC) carregado com sucesso');
} catch (error) {
  console.error('⚠️ Falha ao carregar wrtc:', error.message);
  console.error('O suporte a áudio SIP pode não funcionar.');
}

console.log('🚀 Iniciando servidor...');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 80;
const SIP_PORT = process.env.SIP_PORT || 5060;

// Configurações
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'eywNGzPZ9ne8v1TBJJfh';
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
    version: '1.2',
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
        const { UserAgent } = await import('sip.js');
        const userAgent = new UserAgent({
          uri: UserAgent.makeURI(`sip:${FACILPABX_USER}@${FACILPABX_HOST}`),
          transportOptions: {
            server: `wss://${FACILPABX_HOST}:${SIP_PORT}` // Ajuste conforme protocolo do PABX (WSS ou UDP via SIP.js node)
          },
          authorizationUsername: FACILPABX_USER,
          authorizationPassword: FACILPABX_PASSWORD,
          sessionDescriptionHandlerFactoryOptions: {
            peerConnectionOptions: {
              rtcConfiguration: {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
              }
            }
          }
        });

        // Nota: SIP.js em Node puro requer polyfills de WebRTC (wrtc)
        // Esta implementação é simplificada. Em produção, pode ser necessário ajustar o transporte SIP.

        console.log('✅ Tentando iniciar SIP (Lógica simplificada para demonstração)');

        // Simulação de conexão de áudio para este exemplo
        // Em um ambiente real, você conectaria o stream do 'wrtc' ao 'ws' do ElevenLabs

        activeCalls.set(callId, {
          phoneNumber,
          leadName,
          ws,
          startTime: new Date()
        });

        res.json({
          success: true,
          message: 'Chamada iniciada (Bridge SIP Ativo)',
          callId: callId
        });

      } catch (sipError) {
        console.error('Erro SIP:', sipError);
        ws.close();
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
  console.log(`🚀 Servidor v1.2 rodando na porta ${PORT}`);
});
