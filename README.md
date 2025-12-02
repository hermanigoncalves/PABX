# ElevenLabs SIP Bridge

Servidor ponte entre Fácil PABX e ElevenLabs Conversational AI.

## 🚀 Instalação Local

```bash
# Instalar dependências
npm install

# Copiar arquivo de configuração
cp .env.example .env

# Editar .env com suas credenciais
# (Use seu editor favorito)

# Iniciar servidor
npm start
```

## ⚙️ Configuração

Edite o arquivo `.env`:

```env
PORT=3000
ELEVENLABS_AGENT_ID=seu_agent_id_aqui
ELEVENLABS_API_KEY=sua_api_key_aqui
FACILPABX_HOST=revier.fpabx.com.br
```

## 📡 Endpoints

### GET /health
Status do servidor

```bash
curl http://localhost:3000/health
```

### POST /make-call
Iniciar chamada com agente IA

```bash
curl -X POST http://localhost:3000/make-call \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "5511999999999",
    "leadName": "João Silva"
  }'
```

### GET /calls
Ver chamadas ativas

```bash
curl http://localhost:3000/calls
```

## 🚢 Deploy no Easypanel

1. **Criar repositório Git**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/seu-usuario/sip-bridge.git
   git push -u origin main
   ```

2. **No Easypanel:**
   - Create Project → Nome: `sip-bridge`
   - Create Service → Git Repository
   - Cole URL do repositório
   - Configure variáveis de ambiente
   - Deploy!

3. **Obter URL:**
   - Easypanel gerará: `https://sip-bridge-xxx.easypanel.host`

## 🔗 Integrar com n8n

No workflow, substitua o nó "Fácil PABX":

```json
{
  "method": "POST",
  "url": "https://sua-url-easypanel.com/make-call",
  "body": {
    "phoneNumber": "={{ $('Edit Fields2').item.json.Telefone }}",
    "leadName": "={{ $('Edit Fields2').item.json.Nome }}"
  }
}
```

## 📋 Checklist

- [ ] Criar agente no ElevenLabs
- [ ] Obter Agent ID e API Key
- [ ] Configurar .env
- [ ] Testar localmente
- [ ] Fazer deploy no Easypanel
- [ ] Atualizar workflow n8n

## 🆘 Troubleshooting

**Erro: ELEVENLABS_AGENT_ID não configurado**
- Verifique se o .env está configurado corretamente

**Erro: Cannot connect to ElevenLabs**
- Confirme sua API Key
- Verifique se o Agent ID está correto

## 📞 Suporte

- ElevenLabs Docs: https://elevenlabs.io/docs
- Fácil PABX: https://info.facilpabx.com.br
