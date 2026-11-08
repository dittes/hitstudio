// Genre presets: a whole sampler setup per genre (16 library sounds for the 16 pads, a tempo, swing and a starting groove).
// Pads keep their roles from the factory kit: 0 kick, 1 snare, 2 clap, 3 rim · 4 hat, 5 open hat, 6 tom, 7 cymbal · 8 808, 9 bass, 10 chord, 11 pluck · 12 bell, 13 voice, 14 riser, 15 impact.
// The ids match the genres of the Create screen. Rows use the beat notation: . off · x normal · X accent.
import { DEFAULT_KIT, DEFAULT_PARAMS } from './kit.js'
import { loadManifest, assignLibrarySound, resetPad, setParam } from './engine.js'
import { loadRows } from './beat.js'

export const PRESETS = [
  { id: 'lofi', name: 'Lo-fi', bpm: 80, swing: 0.3,
    sounds: ['kicks-13', 'snares-08', 'claps-05', 'rims-02', 'hats-05', 'openhats-05', 'toms-08', 'cymbals-04', '808-12', 'bass-08', 'chords-01', 'keys-13', 'bells-07', 'vocal-05', 'fx-09', 'fx-15'],
    rows: { 0: 'X... ..x. .xX. ....', 1: '.... X... .... X..x', 3: '..x. .... ..x. ....', 4: 'x.x. x.x. x.x. x.xx', 9: 'x... .... ..x. ....', 10: 'X... .... .... ....' } },
  { id: 'house', name: 'House', bpm: 124, swing: 0.04,
    sounds: ['kicks-09', 'snares-05', 'claps-04', 'rims-04', 'hats-07', 'openhats-01', 'toms-06', 'cymbals-01', '808-09', 'bass-10', 'chords-02', 'keys-04', 'leads-09', 'vocal-07', 'fx-02', 'fx-13'],
    rows: { 0: 'X... X... X... X...', 2: '.... X... .... X...', 4: '..x. ..x. ..x. ..x.', 5: '..x. ..x. ..x. ..x.', 9: '..x. ..x. ..x. ..x.', 10: 'x... .... ..x. ....' } },
  { id: 'synthwave', name: 'Synthwave', bpm: 100, swing: 0,
    sounds: ['kicks-14', 'snares-09', 'claps-02', 'rims-08', 'hats-10', 'openhats-08', 'toms-06', 'cymbals-02', '808-06', 'bass-02', 'chords-09', 'leads-02', 'leads-08', 'vocal-06', 'fx-03', 'fx-14'],
    rows: { 0: 'X... ..x. X... ....', 1: '.... X... .... X...', 2: '.... X... .... X...', 4: 'x.x. x.x. x.x. x.x.', 8: 'X... x.x. X... x.x.', 10: 'X... .... .... ....', 11: '.... ..x. .... ..x.' } },
  { id: 'trap', name: 'Trap', bpm: 140, swing: 0,
    sounds: ['kicks-10', 'snares-12', 'claps-08', 'rims-04', 'hats-09', 'openhats-08', 'toms-07', 'cymbals-07', '808-03', 'bass-11', 'chords-03', 'keys-05', 'bells-02', 'vocal-07', 'fx-04', 'fx-16'],
    rows: { 0: 'X... ..x. ...X ....', 1: '.... .... X... ....', 2: '.... .... X... ....', 4: 'xxxx xxxx xxxx xxxx', 5: '.... .... .... ..x.', 8: 'X... ..x. ...X ....', 11: 'x... .... ..x. ....' } },
  { id: 'pop', name: 'Pop', bpm: 110, swing: 0,
    sounds: ['kicks-16', 'snares-03', 'claps-04', 'rims-03', 'hats-02', 'openhats-06', 'toms-05', 'cymbals-02', '808-08', 'bass-07', 'chords-04', 'keys-11', 'leads-07', 'vocal-01', 'fx-06', 'fx-13'],
    rows: { 0: 'X... .... X... ..x.', 1: '.... X... .... X...', 2: '.... X... .... X...', 4: 'x.x. x.x. x.x. x.x.', 5: '.... .... .... ..x.', 9: 'x... ..x. x... ....', 10: 'X... .... X... ....' } },
  { id: 'chillhop', name: 'Chillhop', bpm: 88, swing: 0.24,
    sounds: ['kicks-06', 'snares-04', 'claps-06', 'rims-07', 'hats-06', 'openhats-02', 'toms-03', 'cymbals-04', '808-13', 'bass-08', 'chords-03', 'keys-14', 'bells-05', 'vocal-04', 'fx-07', 'fx-15'],
    rows: { 0: 'X... ..x. ..X. ....', 1: '.... X... .... X...', 2: '.... .... .... x...', 4: 'x.x. x.x. x.x. x.xx', 9: 'x... .... ..x. ....', 10: 'X... .... .... ....', 12: '.... .... ..x. ....' } },
  { id: 'ambient', name: 'Ambient', bpm: 76, swing: 0,
    sounds: ['kicks-06', 'snares-14', 'claps-03', 'rims-06', 'hats-12', 'openhats-03', 'toms-01', 'cymbals-05', '808-12', 'bass-08', 'chords-12', 'keys-07', 'bells-07', 'vocal-06', 'fx-05', 'fx-17'],
    rows: { 0: 'X... .... .... ....', 3: '.... .... ..x. ....', 4: '..x. .... ..x. ....', 10: 'X... .... .... ....', 11: '.... .x.. .... ..x.', 12: '.... .... x... ....' } },
  { id: 'afro', name: 'Afro', bpm: 102, swing: 0.14,
    sounds: ['kicks-03', 'snares-13', 'perc-06', 'perc-04', 'shakers-01', 'hats-03', 'perc-10', 'perc-01', '808-05', 'bass-07', 'chords-08', 'keys-10', 'bells-10', 'vocal-07', 'fx-02', 'fx-14'],
    rows: { 0: 'X..x ..x. X..x ..x.', 1: '.... .... x... ..x.', 2: '..x. .x.. ..x. .x..', 3: 'x... ..x. x... ..x.', 4: 'x.xx x.xx x.xx x.xx', 5: '.... .... .... ..x.', 6: '..x. .... ..x. x...', 7: '.... x... .... x...', 9: 'x..x ..x. ..x. ....', 11: 'x.x. ..x. x... ..x.' } },
  { id: 'rock', name: 'Rock', bpm: 120, swing: 0,
    sounds: ['kicks-17', 'snares-01', 'claps-04', 'rims-02', 'hats-02', 'openhats-03', 'toms-01', 'cymbals-01', 'bass-03', 'bass-04', 'chords-11', 'keys-08', 'bells-06', 'vocal-07', 'fx-02', 'fx-13'],
    rows: { 0: 'X.x. ..x. X... ..x.', 1: '.... X... .... X...', 4: 'x.x. x.x. x.x. x.x.', 7: 'X... .... .... ....', 8: 'X... ..x. X... ....', 9: 'X... ..x. X... ....', 10: 'X... .... X... ....' } },
  { id: 'dubstep', name: 'Dubstep', bpm: 140, swing: 0,
    sounds: ['kicks-11', 'snares-07', 'claps-07', 'rims-04', 'hats-10', 'openhats-08', 'toms-06', 'cymbals-08', '808-10', 'bass-09', 'chords-10', 'bass-10', 'leads-01', 'vocal-08', 'fx-01', 'fx-18'],
    rows: { 0: 'X... .... .... ..x.', 1: '.... .... X... ....', 2: '.... .... X... ....', 4: 'x.x. x.x. x.x. x.x.', 8: 'X... .... .x.. ....', 9: '.... .... .... x.x.', 12: 'X... .... .... ....' } },
  { id: 'techno', name: 'Techno', bpm: 132, swing: 0,
    sounds: ['kicks-07', 'snares-06', 'claps-03', 'rims-03', 'hats-01', 'openhats-04', 'toms-06', 'cymbals-04', '808-07', 'bass-10', 'chords-09', 'keys-16', 'bells-09', 'vocal-08', 'fx-03', 'fx-33'],
    rows: { 0: 'X... X... X... X...', 2: '.... X... .... X...', 4: '..x. ..x. ..x. ..x.', 5: '..x. ..x. ..x. ..x.', 9: '.x.x .x.x .x.x .x.x', 11: 'x... ..x. .x.. x...' } },
  { id: 'dnb', name: 'Drum & bass', bpm: 172, swing: 0,
    sounds: ['kicks-04', 'snares-02', 'claps-03', 'rims-04', 'hats-03', 'openhats-02', 'toms-06', 'cymbals-03', '808-09', 'bass-09', 'chords-02', 'keys-04', 'leads-09', 'vocal-08', 'fx-01', 'fx-14'],
    rows: { 0: 'X... ..x. .... ..x.', 1: '.... X... ...x X...', 4: 'x.x. x.x. x.x. x.x.', 5: '.... ...x .... ....', 9: 'X... .... ..x. ....', 10: 'X... .... .... ....' } },
]

/** Load a genre: sounds on all 16 pads (their settings back to the factory ones), tempo, swing and a starting beat. */
export async function applyPreset(id) {
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) return false
  const manifest = await loadManifest()
  await Promise.all(preset.sounds.map(async (sid, i) => {
    const entry = manifest.sounds.find((x) => x.id === sid)
    if (!entry) return
    setParam(i, { ...DEFAULT_PARAMS, ...DEFAULT_KIT[i].params })
    if (entry.factory) await resetPad(i)
    else await assignLibrarySound(i, entry)
  }))
  loadRows(preset.rows, preset.bpm, preset.swing)
  return true
}
