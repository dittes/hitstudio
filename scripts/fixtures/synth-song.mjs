// A small synthetic "pop song" with known stems, used to measure separation quality (SDR).
// Looping band (drums, bass, chords, arpeggio) + a NON-repeating vibrato "voice" with consonants.
export function makeSong({ sr = 22050, seconds = 48, seed = 7 } = {}) {
  let s = seed >>> 0
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
  const n = Math.floor(sr * seconds)
  const z = () => [new Float32Array(n), new Float32Array(n)]
  const drums = z(), bass = z(), other = z(), vocals = z()
  const bpm = 100, beat = 60 / bpm, step = beat / 4, bar = beat * 4
  const noise = () => rnd() * 2 - 1
  const add = (t, i, v, pan = 0) => { t[0][i] += v * (1 - Math.max(0, pan)); t[1][i] += v * (1 + Math.min(0, pan)) }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)

  // drums: 16 steps per bar, repeating
  const kick = [0, 6, 10], snare = [4, 12]
  for (let b = 0; b < Math.ceil(seconds / bar); b++) {
    for (let st = 0; st < 16; st++) {
      const t0 = b * bar + st * step, i0 = Math.floor(t0 * sr)
      if (i0 >= n) continue
      const len = Math.floor(0.25 * sr)
      if (kick.includes(st)) for (let k = 0; k < len && i0 + k < n; k++) { const t = k / sr; add(drums, i0 + k, 0.7 * Math.sin(2 * Math.PI * (45 * t + 75 * (1 - Math.exp(-t * 28)) / 28)) * Math.exp(-t * 14), 0) }
      if (snare.includes(st)) for (let k = 0; k < len && i0 + k < n; k++) { const t = k / sr; add(drums, i0 + k, (0.45 * noise() + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 22), 0) }
      if (st % 2 === 0) { let prev = 0; for (let k = 0; k < Math.floor(0.05 * sr) && i0 + k < n; k++) { const x = noise(), hp = x - prev; prev = x; const t = k / sr; const v = 0.14 * hp * Math.exp(-t * 90); drums[0][i0 + k] += v; drums[1][i0 + k] += v * 0.7 + 0.04 * noise() * Math.exp(-t * 90) } }
    }
  }
  // bass: 2-bar pattern
  const bassNotes = [[0, 33], [3, 33], [6, 36], [8, 31], [11, 31], [14, 38], [16, 29], [19, 29], [22, 33], [24, 31], [27, 33], [30, 36]]
  for (let loop = 0; loop * bar * 2 < seconds; loop++) for (const [st, m] of bassNotes) {
    const t0 = loop * bar * 2 + st * step, i0 = Math.floor(t0 * sr), f = mtof(m), len = Math.floor(step * 2.6 * sr)
    for (let k = 0; k < len && i0 + k < n; k++) { const t = k / sr, e = Math.min(1, t * 80) * Math.exp(-t * 3.5); add(bass, i0 + k, 0.5 * e * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * 2 * f * t) + 0.12 * Math.sin(2 * Math.PI * 3 * f * t)), 0) }
  }
  // chord pad (wide, detuned) and a plucked arpeggio (centre-ish), 4-chord loop
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
  for (let b = 0; b * bar < seconds; b++) {
    const ch = chords[b % 4], i0 = Math.floor(b * bar * sr), len = Math.floor(bar * sr)
    for (const m of ch) for (let k = 0; k < len && i0 + k < n; k++) {
      const t = k / sr, f = mtof(m), env = Math.min(1, t * 6) * Math.min(1, (bar - t) * 8)
      let l = 0, r = 0
      for (let h = 1; h <= 6; h++) { l += Math.sin(2 * Math.PI * f * 1.003 * h * t) / h; r += Math.sin(2 * Math.PI * f * 0.997 * h * t + 0.5) / h }
      other[0][i0 + k] += 0.07 * env * l; other[1][i0 + k] += 0.07 * env * r
    }
    for (let st = 0; st < 16; st += 2) {
      const m = ch[(st / 2) % 3] + 12, i0b = Math.floor((b * bar + st * step) * sr), f = mtof(m), len2 = Math.floor(step * 2.2 * sr)
      for (let k = 0; k < len2 && i0b + k < n; k++) { const t = k / sr, e = Math.exp(-t * 9); let v = 0; for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * h); add(other, i0b + k, 0.25 * e * v, 0.15) }
    }
  }
  // voice: random notes, vibrato, harmonic series with formants, breath + consonant bursts, centre, tiny reverb
  const scale = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72], formants = [[800, 150, 1], [1250, 200, 0.7], [2700, 300, 0.4]]
  let t0 = 0.6, prevIdx = 4
  const voice = new Float32Array(n)
  while (t0 < seconds - 0.8) {
    const dur = 0.25 + rnd() * 0.7, idx = Math.max(0, Math.min(scale.length - 1, prevIdx + Math.round((rnd() - 0.5) * 4))); prevIdx = idx
    const f0 = mtof(scale[idx] - 12 + (rnd() < 0.3 ? 12 : 0)), i0 = Math.floor(t0 * sr), len = Math.floor(dur * sr), vib = 5.2 + rnd(), ph = rnd() * 6
    for (let k = 0; k < len && i0 + k < n; k++) {
      const t = k / sr, env = Math.min(1, t * 25) * Math.min(1, (dur - t) * 14), f = f0 * Math.pow(2, 0.025 * Math.sin(2 * Math.PI * vib * t + ph) / 1.0 * (1 - Math.exp(-t * 4)) / 1.2)
      let v = 0
      for (let h = 1; h * f < 8000; h++) { const hf = h * f; let g = 0; for (const [fc, bw, a] of formants) g += a * Math.exp(-Math.pow((hf - fc) / bw, 2)); v += (g + 0.02) / Math.pow(h, 0.7) * Math.sin(2 * Math.PI * hf * t) }
      voice[i0 + k] += 0.17 * env * v + 0.01 * env * noise()
    }
    // consonant at note start
    for (let k = 0; k < Math.floor(0.045 * sr) && i0 + k < n; k++) { const t = k / sr; voice[i0 + k] += 0.12 * noise() * Math.exp(-t * 60) }
    t0 += dur + (rnd() < 0.35 ? 0.25 + rnd() * 0.4 : 0.02)
  }
  const d = Math.floor(0.017 * sr)
  for (let i = 0; i < n; i++) { vocals[0][i] = voice[i] + 0.18 * (i >= d ? voice[i - d] : 0); vocals[1][i] = voice[i] + 0.18 * (i >= d * 2 ? voice[i - d * 2] : 0) }
  const mix = z()
  for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) mix[c][i] = drums[c][i] + bass[c][i] + other[c][i] + vocals[c][i]
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix[0][i]), Math.abs(mix[1][i]))
  const g = 0.9 / peak
  for (const track of [drums, bass, other, vocals, mix]) for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) track[c][i] *= g
  return { sr, n, mix, truth: { drums, bass, other, vocals } }
}
