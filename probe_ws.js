import WebSocket from 'ws';

const host = 'revier.fpabx.com.br';
const port = 8089;
const paths = ['/', '/ws', '/sip', '/phone', '/asterisk/ws'];

async function testPath(path) {
    const url = `ws://${host}:${port}${path}`;
    console.log(`Testing ${url}...`);
    return new Promise((resolve) => {
        const ws = new WebSocket(url, 'sip');
        const timeout = setTimeout(() => {
            console.log(`❌ ${path} timed out`);
            ws.terminate();
            resolve(false);
        }, 5000);

        ws.on('open', () => {
            console.log(`✅ ${path} OPEN!`);
            clearTimeout(timeout);
            ws.close();
            resolve(true);
        });

        ws.on('error', (err) => {
            console.log(`❌ ${path} error: ${err.message}`);
            clearTimeout(timeout);
            resolve(false);
        });
        
        ws.on('unexpected-response', (req, res) => {
             console.log(`❌ ${path} unexpected response: ${res.statusCode} ${res.statusMessage}`);
             clearTimeout(timeout);
             resolve(false);
        });
    });
}

async function run() {
    for (const path of paths) {
        if (await testPath(path)) {
            console.log(`\n🎉 Found valid path: ${path}`);
            process.exit(0);
        }
    }
    console.log('\n❌ No valid paths found');
    process.exit(1);
}

run();
