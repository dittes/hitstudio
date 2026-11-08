# HitStudio audio provenance

Checked 2026-11-06.

## Opening ident

assets/brand/hitstudio-welcome.mp3 is an original 5.65-second instrumental electronic ident composed by Astra for this project: rising glass plucks, shimmer, a low-end impact, harmonic resolution and a stereo tail. It contains no vocals, borrowed recordings or external samples. The source composition is preserved in scripts/compose-instrumental-intro.py and production details in assets/brand/intro-provenance.txt. The former voice ident is no longer used.

Section switching uses an original 90ms quiet synthesized accent. It plays through a separate UI bus and is excluded from music exports and visualizer recordings.

Opening playback has no enter-with-sound/enter-quietly buttons. The app attempts autoplay; browser autoplay policy may require a first user interaction. Explicit music playback cancels a pending ident. The ident is not inserted into the arrangement.

## Live radio

The library offers a short, curated list of stations that publish a free public listener stream: Radio Paradise (four channels), KEXP 90.3 and dublab. HitStudio plays each stream directly from the station's own server. It does not record, download, re-stream or cache the audio, and each station card links to the station's website. The visualizer only analyses what is playing. The custom-stream field is for streams the user is allowed to listen to.

Whether a given jurisdiction treats linking to a public stream as needing a licence is not settled law (the UK TuneIn case is the best-known example, and it turned largely on recording and on directory-style services). Before any public launch, ask each station for written permission or confirm their terms, and consider legal advice. Nothing has been confirmed with the stations yet.

The former bundled CC0 Freesound pack has been removed.

## Sampler kit

The 16 factory sounds in assets/sampler/ (kick, snare, clap, rim, two hats, tom, crash, 808, bass stab, Am9 chord, pluck, bell, vocal "ooh", riser, impact) are original sounds synthesized from scratch for HitStudio with scripts/make-sampler-kit.py (numpy and scipy: oscillators, filtered noise, FM and Karplus-Strong synthesis; the vocal is a formant synth, not a recording of a person). They contain no recorded samples and no third-party material, and the script recreates them exactly. The sound browser adds a library of 227 more original sounds (kicks, snares, claps, hats, percussion, 808s, synth bass, chord stabs, keys, bells, leads, voices, FX), also synthesized from scratch with scripts/make-sampler-library.py (numpy, scipy and ffmpeg for the lossless FLAC files; deterministic). Sounds you load into a pad yourself are stored only in your browser (IndexedDB) and are never uploaded.

## Runtime library notices

Three.js and Immer are MIT licensed. The MP3 encoder lamejs is LGPL licensed; its license and bundled source are distributed in vendor/. These are software licenses, separate from the sound recordings’ CC0 terms.
