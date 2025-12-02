require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Configurações
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'GnDrTQvdzZ7wqAKfLzVQ';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const FACILPABX_HOST = process.env.FACILPABX_HOST || 'revier.fpabx.com.br';

// Armazenar chamadas ativas
const activeCalls = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeCalls: activeCalls.size,
    config: {
      agentId: ELEVENLABS_AGENT_ID ? '✓ Configurado' : '✗ Não configurado',
      apiKey: ELEVENLABS_API_KEY ? '✓ Configurado' : '✗ Não configurado'
    }
  });
});

// Endpoint para iniciar chamada com ElevenLabs
app.post('/make-call', async (req, res) => {
  const { phoneNumber, leadName } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'phoneNumber é obrigatório'
    });
  }

  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'ElevenLabs não configurado. Verifique variáveis de ambiente.'
    });
  }

  console.log(`📞 Iniciando chamada para: ${phoneNumber} (${leadName || 'Lead'})`);

  try {
    // Fazer chamada via ElevenLabs API
    const response = await axios.post(
      'https://api.elevenlabs.io/v1/convai/conversation/get_signed_url',
      {
        agent_id: ELEVENLABS_AGENT_ID
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const signedUrl = response.data.signed_url;
    console.log('✅ URL assinada obtida do ElevenLabs');

    // Conectar ao WebSocket do ElevenLabs
    const ws = new WebSocket(signedUrl);
    const callId = Date.now().toString();

    ws.on('open', () => {
      console.log(`🔗 WebSocket conectado para chamada ${callId}`);

      // Enviar dados iniciais da conversa
      ws.send(JSON.stringify({
        type: 'conversation_initiation_client_data',
        conversation_config_override: {
          agent: {
            prompt: {
              prompt: `O nome do lead é ${leadName || 'o cliente'}. Use este nome de forma natural durante a conversa.`
            }
          }
        }
      }));

      activeCalls.set(callId, {
        phoneNumber,
        leadName,
        ws,
        startTime: new Date()
      });
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'agent_response') {
          console.log(`🤖 Agente: ${message.agent_response?.text || 'resposta de áudio'}`);
        }

        if (message.type === 'conversation_ended') {
          console.log(`✅ Conversa encerrada: ${callId}`);
          activeCalls.delete(callId);
          ws.close();
        }
      } catch (error) {
        console.error('Erro ao processar mensagem:', error);
      }
    });

    ws.on('error', (error) => {
      console.error(`❌ Erro WebSocket: ${error.message}`);
      activeCalls.delete(callId);
    });

    ws.on('close', () => {
      console.log(`🔌 WebSocket fechado: ${callId}`);
      activeCalls.delete(callId);
    });

    // Aqui você integraria com o PABX para fazer a ligação real
    // Por enquanto, retornamos sucesso indicando que o agente está pronto

    res.json({
      success: true,
      message: 'Agente ElevenLabs iniciado com sucesso',
      callId: callId,
      signedUrl: signedUrl
    });

  } catch (error) {
    console.error('❌ Erro ao iniciar chamada:', error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        error: error.response.data || error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para listar chamadas ativas
app.get('/calls', (req, res) => {
  const calls = Array.from(activeCalls.entries()).map(([id, call]) => ({
    callId: id,
    phoneNumber: call.phoneNumber,
    leadName: call.leadName,
    startTime: call.startTime,
    duration: Math.floor((Date.now() - call.startTime.getTime()) / 1000) + 's'
  }));

  res.json({
    success: true,
    count: calls.length,
    calls
  });
});

// Endpoint para encerrar chamada
app.post('/end-call/:callId', (req, res) => {
  const { callId } = req.params;
  const call = activeCalls.get(callId);

  if (!call) {
    return res.status(404).json({
      success: false,
      error: 'Chamada não encontrada'
    });
  }

  call.ws.close();
  activeCalls.delete(callId);

  res.json({
    success: true,
    message: 'Chamada encerrada'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════╗
║   🚀 Servidor SIP Bridge Iniciado    ║
╠═══════════════════════════════════════╣
║  Porta HTTP: ${PORT.toString().padEnd(23)}║
║  Host: 0.0.0.0                        ║
║  ElevenLabs: ${(ELEVENLABS_AGENT_ID ? '✓ Configurado' : '✗ Não configurado').padEnd(22)}║
╚═══════════════════════════════════════╝

📍 Endpoints disponíveis:
   GET  /health         - Status do servidor
   GET  /calls          - Chamadas ativas
   POST /make-call      - Iniciar chamada
   POST /end-call/:id   - Encerrar chamada

🔗 Acesse: http://localhost:${PORT}/health
  `);
});
