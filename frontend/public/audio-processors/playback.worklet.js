/**
 * Audio Worklet: play float32 PCM from main thread (24kHz from context).
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioQueue = [];
    this.port.onmessage = (e) => {
      if (e.data === "interrupt") {
        this.audioQueue = [];
      } else if (e.data instanceof Float32Array) {
        this.audioQueue.push(e.data);
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output.length === 0) return true;
    const channel = output[0];
    let outIdx = 0;
    while (outIdx < channel.length && this.audioQueue.length > 0) {
      const buf = this.audioQueue[0];
      if (!buf || buf.length === 0) {
        this.audioQueue.shift();
        continue;
      }
      const toCopy = Math.min(channel.length - outIdx, buf.length);
      channel.set(buf.subarray(0, toCopy), outIdx);
      outIdx += toCopy;
      if (toCopy >= buf.length) this.audioQueue.shift();
      else this.audioQueue[0] = buf.subarray(toCopy);
    }
    for (let i = outIdx; i < channel.length; i++) channel[i] = 0;
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
