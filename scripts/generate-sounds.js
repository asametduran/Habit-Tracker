// One-off script: synthesizes the app's reward sounds so no external audio (or licensing) is needed.
// Usage: node scripts/generate-sounds.js  →  writes assets/sounds/chime.wav + celebration.wav
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;

function tone(freq, seconds, volume = 0.5) {
  const n = Math.floor(SAMPLE_RATE * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.01);
    const decay = Math.exp(-t * 6);
    // Fundamental plus a soft octave for a bell-like timbre.
    const wave = Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2 * t);
    out[i] = wave * attack * decay * volume;
  }
  return out;
}

function sequence(notes) {
  const parts = notes.map(([freq, seconds, offset]) => ({ data: tone(freq, seconds), offset }));
  const total = Math.max(...parts.map((p) => Math.floor(p.offset * SAMPLE_RATE) + p.data.length));
  const mix = new Float32Array(total);
  for (const { data, offset } of parts) {
    const start = Math.floor(offset * SAMPLE_RATE);
    for (let i = 0; i < data.length; i++) mix[start + i] += data[i];
  }
  return mix;
}

function toWav(samples) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

const outDir = path.join(__dirname, '..', 'assets', 'sounds');
fs.mkdirSync(outDir, { recursive: true });

// Two-note chime: E5 → A5
fs.writeFileSync(
  path.join(outDir, 'chime.wav'),
  toWav(
    sequence([
      [659.25, 0.5, 0],
      [880.0, 0.6, 0.12],
    ]),
  ),
);

// Ascending triad: C5 → E5 → G5 → C6
fs.writeFileSync(
  path.join(outDir, 'celebration.wav'),
  toWav(
    sequence([
      [523.25, 0.5, 0],
      [659.25, 0.5, 0.14],
      [783.99, 0.5, 0.28],
      [1046.5, 0.9, 0.42],
    ]),
  ),
);

console.log('Wrote', outDir);
