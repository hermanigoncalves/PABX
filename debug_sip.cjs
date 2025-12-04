const https = require('https');

const data = JSON.stringify({
  phoneNumber: '32998489879'
});

const options = {
  hostname: 'automacao-pabx.d2vyhi.easypanel.host',
  port: 443,
  path: '/test-sip-call',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(body);
      console.log("SIP Status:", json.sip_status_before_call);
      console.log("Immediate State:", json.call_immediate_state);
      console.log("State after 500ms:", json.call_state_after_500ms);
      console.log("Diagnosis:", json.diagnosis);
      console.log("Error:", json.error);
    } catch (e) {
      console.log(body);
    }
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.write(data);
req.end();
