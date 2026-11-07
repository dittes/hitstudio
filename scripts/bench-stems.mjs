// Measures separation quality (SDR, higher is better) on a synthetic song with known stems.
//   node scripts/bench-stems.mjs [v1|v2|both]
const which = process.argv[2] || 'both'
const {makeSong} = await import('./fixtures/synth-song.mjs')
const sdr = (ref, est) => {
  let r = 0, e = 0
  for (let c = 0; c < 2; c++) for (let i = 0; i < ref[c].length; i++) { r += ref[c][i] ** 2; e += (ref[c][i] - est[c][i]) ** 2 }
  return 10 * Math.log10(r / (e + 1e-20))
}
const add = (a, b) => [a[0].map((v, i) => v + b[0][i]), a[1].map((v, i) => v + b[1][i])]
export async function evaluate(label, separate, songs) {
  const rows = []
  for (const song of songs) {
    const t0 = performance.now()
    const st = await separate(song.mix[0], song.mix[1], song.sr)
    const ms = performance.now() - t0
    const inst = add(add(st.drums, st.bass), st.other), instRef = add(add(song.truth.drums, song.truth.bass), song.truth.other)
    rows.push({ vocals: sdr(song.truth.vocals, st.vocals), instrumental: sdr(instRef, inst), drums: sdr(song.truth.drums, st.drums), bass: sdr(song.truth.bass, st.bass), other: sdr(song.truth.other, st.other), ms })
  }
  const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length
  const out = Object.fromEntries(['vocals', 'instrumental', 'drums', 'bass', 'other', 'ms'].map((k) => [k, +avg(k).toFixed(2)]))
  console.log(label.padEnd(4), JSON.stringify(out))
  return out
}
const songs = [makeSong({ seed: 7 }), makeSong({ seed: 21 }), makeSong({ seed: 99 })]
if (which !== 'v2') await evaluate('v1', (l, r, sr) => import('./fixtures/stems-v1.mjs').then((m) => m.separateStems(l, r, sr)), songs)
if (which !== 'v1') await evaluate('v2', (l, r, sr) => import('../app/features/tools/stems-core.js').then((m) => m.separateStems(l, r, sr, { params: JSON.parse(process.env.PARAMS || '{}') })), songs)
