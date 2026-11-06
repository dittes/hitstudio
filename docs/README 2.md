# HitStudio

A private browser music studio for hitstudio.org, implemented in plain HTML, CSS and native JavaScript modules. The existing dark/light theme, gradient accents, sidebar and studio layouts are retained. No React, JSX, Zustand, Motion, Vite or TypeScript is needed to run the active app.

## Run

Serve this folder with any static HTTP server, or use `npm run dev` / `node scripts/serve.mjs` and open http://localhost:5199. No installation is needed. ES modules require HTTP; double-clicking index.html through file:// is not supported. HTTPS (or localhost) is required for microphone access and some browser encoders.

`npm run check` validates the native module graph. `npm run build` copies the upload-ready site into dist/. Upload the contents of dist/ to your static host, with JavaScript served as JavaScript. There is no application backend, remote API key or build step required on the host.

## Studio

The sidebar contains Create, Edit, Mix, DJ, Tools, then Visualize. Tools contains the quick tasks formerly shown in the welcome dialog. Lift the player bar with its handle (or swipe it upward) to open songs, bundled CC0 sounds, and a direct radio-stream input underneath. Swipe down or press the handle again to close it. Local song files are stored in IndexedDB on this browser; original demo songs are synthesized locally. Add a library song to the timeline explicitly to edit or export it.

Entering Beat Maker stops normal playback and selects the beat source. Tips can be dismissed and restored through Search actions → Show tips. Section switching has a quiet 90ms sound, excluded from recorded music.

The audio engine, effect processors, exports, undo/redo, beat sequencer, DJ engines, project format and visualization renderers are retained as native JavaScript. Listening, sound previews, the welcome ident, beat playback, studio playback and DJ playback share one source switch so they stop competing sources. The visualizer emits no tones. Selecting a scene does not start music. A metronome is only available in studio editing/creation.

The original 5.65-second instrumental opening ident has no vocals. It attempts to play on opening without an entry gate. Browsers that block autoplay defer it to the first interaction; an explicit playback interaction takes priority and cancels the pending ident.

Eighteen scenes are available in the scrolling gallery. The original ten are joined by Spectrogram, Frequency waterfall, Phosphor density, Flow field, Warp drive, Laser rosette, Light helix and Cymatic bloom. Filter to Audio analysis for the three measured FFT views, with frequency/level labels, clearable history and 6/12/24-second time windows. Both rendering modes include all eighteen. See VISUALIZATION-NOTES.md for references and measurement limits.

Press the red recording icon to select MP4 or WebM and a layout: landscape Full HD (1920×1080), portrait Full HD (1080×1920), or square (1080×1080). A separate canvas renders the composition at exactly that resolution, without studio controls or screen stretching, and records at 30 fps with the shared master audio. The recording canvas is released after saving or an error. Video recording defaults to MP4 with H.264/AAC when supported by the browser. WebM is available explicitly and is the announced fallback if MP4 cannot be recorded. The file extension follows its actual container. In immersive mode, all controls, the player and an open library fade away after three seconds without interaction, returning on mouse movement, touch or keyboard input. Recording dialogs remain visible. Use Compatibility rendering if WebGL is unavailable. Browser and device codec/performance support varies; physical-device Safari/Firefox testing remains outstanding.

New project files use .hitstudio; legacy .bloom projects remain readable. Old storage keys stay unchanged for existing preferences and autosaves on the same origin. Browser storage does not transfer automatically to a new domain; download your project before moving.

All bundled runtime libraries are local: Three.js (MIT), Immer (MIT), lamejs (LGPL, see vendor/lamejs-LICENSE) and Lucide icon paths (ISC, app/ui/icons.js, see vendor/lucide-LICENSE). Their notices are included in vendor/. See SOUND-SOURCES.md and assets/sounds/manifest.json for audio provenance.

The previous React implementation and migration files are preserved in legacy/ for recovery and excluded from the static distribution. No public deployment or domain/DNS change has been made.

## Song generator (songsmith)

`app/lib/songsmith.js` is a small, dependency-free music generator. `generateSetup({ genre, mood, seed })` returns a complete Create setup (tempo, key, scale, drum grid, motif-based melody, diatonic progression, bass pattern, mix) that always fits together; the same seed gives the same result, shareable as a code like `lofi-chill-7`. `arrangeSong(setup, 'loop'|'short'|'full')` lays it out as intro/verse/build/chorus/break/outro. An Energy value (`busy`, Simple↔Busy) shapes hi-hat feel, ghost notes, fills and melody density. Twelve genres (Lo-fi, House, Synthwave, Trap, Pop, Chillhop, Ambient, Afro/Dancehall, Rock, Dubstep, Techno, Drum & Bass) across 7 drum kits and 18 instruments (incl. electric piano, organ, rock guitar, strings, marimba, flute, brass, supersaw, 808 sub, reese, wobble and picked bass) and five moods are included, plus sixteen curated demo songs (`DEMO_SETS`). Everything it generates is ordinary Create state, so ideas stay editable in the Beat, Melody and Chords tabs (the Chords tab edits the 4-bar progression, chord sound and bass line).

`app/features/create/songgen.js` renders setups with the Create synths: into the Beat Maker, into a multi-track song with section markers, or as a mixed-down library demo. The Create → ✨ Generate tab is the UI for all of it.
