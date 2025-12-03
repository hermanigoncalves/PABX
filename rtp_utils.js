// G.711 u-law to PCM lookup table
const mu2linear = new Int16Array(256);
const linear2mu = new Uint8Array(16384);

function initG711() {
    for (let i = 0; i < 256; i++) {
        let mu = i;
        let sign = (mu & 0x80) >> 7;
        let exponent = (mu & 0x70) >> 4;
        let mantissa = mu & 0x0f;
        let sample = ((mantissa << 3) + 0x84) << exponent;
        sample -= 0x84;
        if (sign === 0) sample = -sample;
        mu2linear[i] = sample;
    }

    // Linear to Mu-law (Simplified)
    // Using a simple algorithm or lookup would be better, but for now let's use a basic approx
    // Actually, let's use the standard algorithm
    for (let i = -32768; i < 32768; i++) {
        // ... implementation omitted for brevity, will use a simpler function below
    }
}

initG711();

export function ulawToLinear(ulawBuffer) {
    const pcmBuffer = new Int16Array(ulawBuffer.length);
    for (let i = 0; i < ulawBuffer.length; i++) {
        pcmBuffer[i] = mu2linear[ulawBuffer[i]];
    }
    return Buffer.from(pcmBuffer.buffer);
}

export function linearToUlaw(pcmBuffer) {
    const ulawBuffer = new Uint8Array(pcmBuffer.length / 2);
    const pcmData = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);

    for (let i = 0; i < pcmData.length; i++) {
        let sample = pcmData[i];
        let sign = (sample >> 8) & 0x80;
        if (sample < 0) sample = -sample;
        sample = sample + 132;
        if (sample > 32767) sample = 32767;

        let exponent = 7;
        for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) { }
        let mantissa = (sample >> (exponent + 3)) & 0x0F;
        ulawBuffer[i] = ~(sign | (exponent << 4) | mantissa);
    }
    return Buffer.from(ulawBuffer);
}

export class RTPHeader {
    constructor() {
        this.version = 2;
        this.padding = 0;
        this.extension = 0;
        this.csrcCount = 0;
        this.marker = 0;
        this.payloadType = 0; // PCMU
        this.sequenceNumber = 0;
        this.timestamp = 0;
        this.ssrc = 0;
    }

    toBuffer() {
        const buffer = Buffer.alloc(12);
        buffer[0] = (this.version << 6) | (this.padding << 5) | (this.extension << 4) | this.csrcCount;
        buffer[1] = (this.marker << 7) | (this.payloadType & 0x7F);
        buffer.writeUInt16BE(this.sequenceNumber, 2);
        buffer.writeUInt32BE(this.timestamp, 4);
        buffer.writeUInt32BE(this.ssrc, 8);
        return buffer;
    }
}
