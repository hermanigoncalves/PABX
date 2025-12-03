import net from 'net';
import crypto from 'crypto';
import os from 'os';

class SIPClient {
    constructor() {
        this.client = new net.Socket();
        this.connected = false;
        this.cseq = 1;
    }
    connect() {
        console.log('Connect called');
    }
}

const sipClient = new SIPClient();
console.log('sipClient:', sipClient);
console.log('sipClient.connect:', sipClient.connect);
sipClient.connect();
