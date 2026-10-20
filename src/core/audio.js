import { clamp } from '../utils.js';

export class AudioSystem {
  constructor(app) {
    this.app = app;
    this.ctx = null;
    this.buffer = null;
    this.name = '';
    this.fileName = '';
    this.fileBuffer = null;
    this.mime = '';
    this.start = 0;
    this.volume = 0.85;
    this.peaks = [];
    this.source = null;
    this.gain = null;
  }

  get hasAudio() {
    return !!this.buffer;
  }

  get duration() {
    return this.buffer?.duration || 0;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Tu navegador no soporta Web Audio.');
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  async loadFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    return this.loadArrayBuffer(arrayBuffer, {
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      mime: file.type,
    });
  }

  async loadArrayBuffer(arrayBuffer, meta = {}) {
    const ctx = this.ensureContext();
    const copy = arrayBuffer.slice(0);
    const buffer = await new Promise((resolve, reject) => {
      const promise = ctx.decodeAudioData(copy, resolve, reject);
      if (promise?.then) promise.then(resolve).catch(reject);
    });
    this.stop();
    this.buffer = buffer;
    this.name = meta.name || 'Audio';
    this.fileName = meta.fileName || '';
    this.mime = meta.mime || '';
    this.fileBuffer = arrayBuffer.slice(0);
    this.start = 0;
    this.peaks = this.computePeaks(buffer, 2400);
    return buffer;
  }

  computePeaks(buffer, buckets) {
    const channel = buffer.getChannelData(0);
    const count = Math.max(1, Math.floor(buckets));
    const block = Math.max(1, Math.floor(channel.length / count));
    const peaks = new Float32Array(count);
    let max = 0;
    for (let i = 0; i < count; i += 1) {
      let peak = 0;
      const start = i * block;
      const end = Math.min(channel.length, start + block);
      for (let j = start; j < end; j += 1) {
        const v = Math.abs(channel[j]);
        if (v > peak) peak = v;
      }
      peaks[i] = peak;
      if (peak > max) max = peak;
    }
    if (max > 0) {
      for (let i = 0; i < peaks.length; i += 1) peaks[i] /= max;
    }
    return Array.from(peaks);
  }

  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.gain) this.gain.gain.value = this.volume;
  }

  setStart(value) {
    this.start = Math.max(0, Number(value) || 0);
  }

  play(fromTime = 0) {
    if (!this.buffer) return;
    this.stop();
    const ctx = this.ensureContext();
    const delay = Math.max(0, this.start - fromTime);
    const offset = Math.max(0, fromTime - this.start);
    if (offset >= this.buffer.duration) return;

    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    source.connect(gain).connect(ctx.destination);
    try {
      source.start(ctx.currentTime + delay, Math.min(offset, Math.max(0, this.buffer.duration - 0.001)));
    } catch {
      return;
    }
    this.source = source;
    this.gain = gain;
    source.onended = () => {
      if (this.source === source) {
        this.source = null;
        this.gain = null;
      }
    };
  }

  stop() {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect?.();
      this.source = null;
    }
    if (this.gain) {
      this.gain.disconnect?.();
      this.gain = null;
    }
  }

  clear() {
    this.stop();
    this.buffer = null;
    this.name = '';
    this.fileName = '';
    this.fileBuffer = null;
    this.mime = '';
    this.start = 0;
    this.peaks = [];
  }

  createExportSource() {
    if (!this.buffer) return null;
    const ctx = this.ensureContext();
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    const destination = ctx.createMediaStreamDestination();
    source.connect(gain).connect(destination);
    return { source, gain, destination, ctx };
  }
}
