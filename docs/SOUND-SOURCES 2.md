# HitStudio audio provenance

Checked 2026-11-06.

## Opening ident

assets/brand/hitstudio-welcome.mp3 is an original 5.65-second instrumental electronic ident composed by Astra for this project: rising glass plucks, shimmer, a low-end impact, harmonic resolution and a stereo tail. It contains no vocals, borrowed recordings or external samples. The source composition is preserved in scripts/compose-instrumental-intro.py and production details in assets/brand/intro-provenance.txt. The former voice ident is no longer used.

Section switching uses an original 90ms quiet synthesized accent. It plays through a separate UI bus and is excluded from music exports and visualizer recordings.

Opening playback has no enter-with-sound/enter-quietly buttons. The app attempts autoplay; browser autoplay policy may require a first user interaction. Explicit music playback cancels a pending ident. The ident is not inserted into the arrangement.

## Bundled Freesound library

Eleven locally bundled sounds are public high-quality MP3 **preview versions**, not the uploaders’ lossless originals. Each actual Freesound source page linked CC0 1.0 at acquisition. assets/sounds/manifest.json records creator, source page, CC0 link, public preview URL, edition, checked date and SHA-256 checksum. assets/sounds/LICENSES.txt retains the source list.

CC0 reference: https://creativecommons.org/publicdomain/zero/1.0/ . It permits reuse and redistribution under its terms; it does not establish that an uploader owns every third-party right. These files do not require a Freesound login or API key at runtime. Playback and timeline imports use the bundled copies.

The library includes kicks, snares, claps, hi-hat texture, a synth pad, outdoor/night ambience and a stream recording. Source links remain visible beside the sounds. Other Freesound licenses are not included by default.

## Runtime library notices

Three.js and Immer are MIT licensed. The MP3 encoder lamejs is LGPL licensed; its license and bundled source are distributed in vendor/. These are software licenses, separate from the sound recordings’ CC0 terms.
