# HitStudio visualization expansion

Reviewed 2026-11-06:

- https://vizz.fm/visualizers/ — inspiration for varied particle, light-trail, warp and polar-curve families, rather than many colour variants of one animation.
- https://github.com/kevinraymond/fosfora/wiki and https://github.com/kevinraymond/fosfora/blob/main/docs/GALLERY.md — inspiration for flowing fields, phosphor persistence and frequency-history displays.
- https://en.wikipedia.org/wiki/Spectrogram — reference requested by the user for the time/frequency/intensity representation.
- https://webaudio.github.io/web-audio-api/#AnalyserNode — primary implementation reference for FFT frequency bins, decibel data and windowing.

All added rendering and measurement code is original to this implementation. No source code, shaders, recordings or graphical assets were imported from those projects.

## Eighteen scenes

The previous ten remain. Eight additions: Spectrogram, Frequency waterfall, Phosphor density, Flow field, Warp drive, Laser rosette, Light helix and Cymatic bloom. Both rendering modes and all existing recording layouts support them. Measured analysis plots bypass bloom and FXAA so labels and data remain sharp. The Analysis filter shows the three measured FFT displays; the art collection retains the decorative idle previews.

## Measurement details

The three analysis scenes use a dedicated, unsmoothed 8192-sample Web Audio analyser tapped from the shared master. Data is sampled at up to 30 frames/second and mapped into 256 logarithmic frequency bands from 20 Hz to the lesser of 20 kHz and Nyquist. At 48 kHz the FFT bin spacing is about 5.86 Hz; low-frequency labels do not imply finer resolution. The band value is the strongest actual FFT bin in that band, mapped from −100 to −10 dB. This is a browser FFT-level display, not a calibrated SPL instrument.

The spectrogram shows frequency vertically and time horizontally; the waterfall places frequency horizontally and newest time at the top. History choices are 6, 12 or 24 seconds. Timestamp regridding leaves missing samples blank; a gap over one second resets the rolling history. Silence is real zero intensity, without the artistic idle signal. The history is bounded at 900 frames. Clear history also resets the density plot.

Phosphor density shows the recent occupancy of frequency/level cells, with roughly 2.5-second exponential persistence, a white live trace and a coloured decaying peak hold. Its persistence is independent of the spectrogram time-window control, which is hidden for this scene.

Flow field and the other artistic scenes are stylized visual effects driven by band energies; Cymatic bloom is not a physical Chladni-plate simulation. MP4/WebM and portrait/landscape/square export use the same renderer-independent scene state. A recording starting midway through playback includes only the available live history, not an offline analysis of the entire file.
