function log(msg, type = 'info') {
    const consoleEl = document.getElementById('logConsole');
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    line.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

async function checkHealth() {
    try {
        const res = await fetch('/health');
        const data = await res.json();

        const sipEl = document.getElementById('sip-status');
        const aiEl = document.getElementById('ai-status');

        // SIP Status
        const sipStatus = data.sip_status || 'unknown';
        document.querySelector('#sip-status .val').textContent = sipStatus;
        sipEl.className = `status-item ${sipStatus.includes('REGISTERED') ? 'online' : 'warning'}`;

        // AI Config Status
        const aiConfig = data.config && data.config.agent_id_configured && data.config.api_key_configured;
        document.querySelector('#ai-status .val').textContent = aiConfig ? 'Configurado' : 'Erro Config';
        aiEl.className = `status-item ${aiConfig ? 'online' : 'offline'}`;

        log(`Health Check: SIP=${sipStatus}, Version=${data.version}`);
    } catch (e) {
        log('Erro ao verificar status do servidor', 'error');
        document.querySelector('#sip-status .val').textContent = 'Offline';
        document.getElementById('sip-status').className = 'status-item offline';
    }
}

async function makeCall() {
    const btn = document.getElementById('btnCall');
    const phone = document.getElementById('phoneNumber').value;
    const name = document.getElementById('leadName').value;

    if (!phone) return log('Digite um número de telefone!', 'error');

    btn.disabled = true;
    btn.innerHTML = '⏳ Discando...';
    log(`Iniciando chamada para ${phone} (${name})...`);

    try {
        const res = await fetch('/make-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: phone, leadName: name })
        });

        let data;
        const text = await res.text();
        try {
            data = JSON.parse(text);
        } catch (e) {
            // Se não for JSON, provavelmente é erro HTML (500/504)
            log(`❌ Erro Crítico do Servidor: ${res.status} ${res.statusText}`, 'error');
            console.error('Resposta não-JSON:', text);
            if (text.includes('Gateway Time-out')) {
                log('⚠️ O servidor demorou muito para responder (Timeout). O PABX pode estar inacessível.', 'warning');
            }
            return;
        }

        if (res.ok) {
            log(`✅ Chamada Iniciada! ID: ${data.callId}`, 'success');
        } else {
            log(`❌ Erro na chamada: ${data.error}`, 'error');
        }
    } catch (e) {
        log(`❌ Erro de rede: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '📞 Ligar Agora';
    }
}

async function runDiagnostics() {
    log('Iniciando diagnóstico ElevenLabs...', 'info');
    try {
        const res = await fetch('/test-elevenlabs');
        const data = await res.json();

        if (data.success) {
            log('✅ Conexão ElevenLabs OK!', 'success');
        } else {
            log('❌ Falha ElevenLabs', 'error');
            if (data.logs) data.logs.forEach(l => log(`   ${l}`, 'warning'));
        }
    } catch (e) {
        log(`❌ Erro diagnóstico: ${e.message}`, 'error');
    }
}

// Iniciar verificação ao carregar
window.onload = () => {
    checkHealth();
    // Verificar a cada 30s
    setInterval(checkHealth, 30000);
};
