# SPEC — "Rewind the hit" (storyline B)

GOAL:    a Product Hunt visitor sees a finished, alive track first, learns it was made start-to-finish in one browser tab, and remembers "hitstudio.org".
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps
TIME:    32.3 s x 30 = 969 frames. Music: "Storm Horizon" (HitStudio code synthwave-epic-7), 104 BPM, 1 beat = 0.577 s = 17.3 frames, 1 bar = 2.308 s = 69.2 frames.

LOOK:    the product's own skin. Ground #0c0c10 (app background), ink #f5f3ff, muted ink #a1a1b5.
         Accent: the brand gradient #f472b6 -> #fb923c (Generate button), only on the reveal word, the drop line and the end card.
         Display: Inter 800, 120-150 px, tracking -3%; secondary Inter 600 44-56 px.
         Medium: real HitStudio UI captured at 3840x2160 shown at 1.25-1.9x; the real Orb scene (app/features/visualizer/scenes/orb.js, HitStudio palette #a78bfa #f472b6 #fb923c #38bdf8, Unreal bloom) rendered live by three.js and driven by the film's audio.
         Depth: UI planes get a 0 40px 120px rgba(0,0,0,.55) shadow when they sit on the ground; no grain, 0% vignette.
OBJECTS: the Orb (the real scene, audio-reactive); the Create screen (code synthwave-epic-7 -> idea "Storm Horizon" with drum grid, melody, chords A#maj7 D#maj7 Gm7 F7, bass);
         the Edit timeline (Drums/Bass/Chords/Melody lanes, pink playhead); the Mixer (four channel strips + Master); the HitStudio logo (three vertical bars on the pink-orange tile).
MOTION:  enter expo.out 0.5 s; camera moves power3.inOut 0.5 s with 0-18 px motion blur; rewind = power2.in whips 0.25-0.35 s each with 40 px horizontal blur, playing backwards;
         type: words land with a 6-frame scale 1.06 -> 1 + blur 10 -> 0 px, then hold still. Cursor: 120 px macOS arrow, clicks on a beat.
SHOTS:
  1  0.00-4.62  (bars 1-2, chorus)  Orb full bleed, beating. At 3.5 s the camera pulls back 0.9 s and the Orb settles into the real Visualize screen ("Shapes · Orb"). Sound: chorus.
  2  4.62-6.92  (bar 3)  REWIND: tape-rewind audio (chorus reversed, 2x). Screens whip backwards L->R: Visualize -> Mix -> Edit -> Create, each blurrier-faster then braking to a stop on an empty Create with code "synthwave-epic-7" typed. Line "Rewind." none — the picture tells it.
  3  6.92-10.00 (build)  Create. Punch-in on the code field; cursor clicks the arrow on beat at 7.50; the idea "Storm Horizon" appears; camera eases down onto the drum grid. Line (8.2-9.9): "Start with an idea".
  4  10.00-13.08  Edit. The four lanes, the playhead travelling. Line: "Arrange it".
  5  13.08-16.15  Mix. Channel strips; push-in toward the Master meter. Line: "Mix it". Riser from the sampler's own riser.wav peaks at 16.15.
  6  16.15-23.08 (chorus)  DROP: zoom through the Visualize icon into the Orb, full bleed, biggest moment. Line at 17.3: "Watch it come" + "alive" (gradient word).
  7  23.08-27.69  Claim on #0c0c10: "A whole studio." / "One browser tab." then smaller "No account. No upload.". Orb shrinks behind into a small accent and leaves.
  8  27.69-32.30  End card: the logo tile lands on the kick (sampler impact.wav), its three bars rise like meters, "HitStudio" wipes in to its right, "hitstudio.org" below. Held 2.5 s; music fades over the last bar.
BANNED:  dark void with small floating UI (UI is always >= 70% of frame); fade-and-slide-up on every element; three feature cards; title over dimmed screenshot; logo docked in a corner; invented UI; claims not in README.
QA:      t=1.5 (Orb fills frame), 4.3 (Orb inside Visualize), 5.6 (rewind blur), 7.6 (cursor click), 9.0, 11.5, 14.5, 17.8 (drop line), 25 (claim), 31 (end card).
