# Bloom Studio — plan & contributor contract

A beginner-friendly, browser-based digital audio workstation. Clean UI, lots of
micro-animations, everything runs locally in the browser (no upload, no account —
same promise as the ohfis.com audio tools).

Stack: Vite + React 19 + TypeScript, zustand + immer (state + undo), Web Audio API,
three.js (visuals), motion (animations), lucide-react (icons), @breezystack/lamejs (MP3).

Run: `cd studio && npm run dev` → http://localhost:5199 · Typecheck: `npx tsc --noEmit -p .`

## Product pillars

| Mode | What a beginner can do |
|---|---|
| **Edit** | Drop files, record, arrange clips on tracks, cut/split/trim/fade, loop, undo everything |
| **Mix** | Channel strips: volume, pan, mute/solo, meters, effect racks; "auto-balance" |
| **Create** | Drum step-sequencer + melody grid locked to a scale, chord pads, bounce to a track |
| **DJ** | Two decks, BPM detect + sync, crossfader, EQ/filter, hot cues, loops, record the mix |
| **Visualize** | Fullscreen three.js scenes driven by the music; record a video of it |

Cross-cutting: export (WAV/MP3/FLAC/AIFF/Opus, stems, selection, loudness presets),
offline project save/load + autosave, command palette (⌘K), beginner hints, ohfis-style
"quick tasks" (cut a song, join files, make a ringtone, remove noise, change speed…).

## Architecture (read before coding)

```
src/
  core/            ← shared, owned by the lead. DO NOT EDIT (ask the lead instead)
    types.ts       data model: Project, Track, Clip, EffectInstance, Selection, UIState
    store.ts       useStore (zustand). Change the project ONLY via mutate(label, draft => …)
    engine.ts      getEngine(): playback, live graph, render() for export/bounce, analysers
    buffers.ts     AudioBuffer registry (immutable buffers by id) + sliceBuffer/mapBuffer
    peaks.ts       multi-resolution waveform peaks + peaksForView()
    effects/registry.ts   registerEffect() / getEffect() / allEffects()
    commands.ts    registerCommand() — shortcuts + palette
    toast.ts       toast('…')
    ids.ts         uid, colors, clamp, dbToGain, formatTime
  ui/kit.tsx       shared animated primitives: Button, IconButton, Tooltip, Knob, Slider,
                   Toggle, Segmented, Modal, Meter, Card, Hint, Kbd, RollingNumber, burst()
  app/             shell (TopBar, ModeRail, TransportBar, palette, toasts) — lead only
  features/<name>/ ← each agent owns exactly one folder
```

### Rules for every feature agent
1. Write only inside your `src/features/<name>/` folder. Keep the exports listed below
   exactly (other parts of the app import them).
2. Mutate the project only with `useStore.getState().mutate('Human label', p => {...})`
   so undo works. Use `{ coalesce: 'some-key' }` for drags/knob turns.
3. AudioBuffers are immutable. Destructive edits: create a new buffer
   (`buffers.add(newBuf, name)`) and point the clip at the new `bufferId`.
4. Live sources (DJ decks, instruments, previews) connect to `getEngine().externalInput`.
   Offline rendering of the arrangement: `getEngine().render({ start, end, trackIds })`.
5. Smooth UI (playheads, meters, visuals) polls `getEngine().position` / analysers in
   requestAnimationFrame. Don't subscribe React to 60 fps state.
6. Styling: plain CSS file(s) in your folder, class names prefixed with your feature
   (`.tl-`, `.mx-`, `.dj-`, `.cr-`, `.vz-`, `.fx-`, `.io-`). Use the CSS variables from
   `styles/tokens.css` only (works in dark + light theme). Use `ui/kit` components.
7. Micro-animations everywhere, but purposeful: spring presses, hover lifts, value pops,
   layout animations with `motion/react`, satisfying feedback on success (`burst()`).
8. Beginner language: no jargon without a hint. Show `<Hint>` only when `ui.hints` is on.
9. Register keyboard shortcuts / palette entries with `registerCommand` (ids prefixed by
   feature). Don't steal shortcuts listed below.
10. Before finishing: `npx tsc --noEmit -p .` must show no errors in your folder.

### Feature contracts (exports other code relies on)
| Folder | Must export | Notes |
|---|---|---|
| `timeline` | `EditView()` | the Edit mode screen |
| `mixer` | `MixView()` | the Mix mode screen |
| `create` | `CreateView()` | |
| `dj` | `DJView()` | |
| `visualizer` | `VisualizeView()`, `MiniVisualizer()` | Mini sits in the top bar (≈ 320×40) |
| `effects` | `EffectRack({ target })` (`target` = trackId or `'master'`); importing the module registers all effects + `process.*` commands | |
| `io` | `importFiles(files, { trackId?, at? })`, `IOLayer()` (mounted once; renders export/welcome/save dialogs); registers `io.*` + `transport.record` | |

### Reserved shortcuts
Space play/pause · Esc stop · Home/Enter start · ←/→ ±5 s · L loop · M metronome · R record ·
⌘Z / ⇧⌘Z undo/redo · ⌘K palette · ⌘1-5 modes · ⇧⌘N new track ·
timeline: S split, Delete, ⌘C/⌘X/⌘V/⌘D, ⌘A, ⇧⌘A, +/- zoom, ⇧Z fit, ⇧M marker, I inspector, Alt+←/→ nudge, 1-2 tools · create: ⇧Space, A–K keys ·
io: ⌘S save, ⌘O open, ⌘E export, ⌘I import.

### Command ids used across features
`transport.record` (io) · `io.export` · `io.import` · `io.demo` (load demo song) ·
`io.welcome` · `process.normalize|amplify|reverse|fadeIn|fadeOut|noiseReduce|silenceTrim|speed|pitch`
(effects; act on the current selection) · `timeline.split|delete|duplicate`.

## Reference: Audacity source
`../audacity-master/au3/libraries/au3-builtin-effects/*Base.cpp` (Echo, Phaser, WahWah,
Reverb, Compressor, Normalize, NoiseReduction, TruncSilence, ChangeTempo/Pitch, ToneGen,
BassTreble, Distortion…) and `au3/src/effects/`. Port algorithms, not UI.
`au3-wave-track-paint` shows how Audacity draws waveforms (min/max/rms per column).
