# Review — "Rewind the hit" (pass 1)

Checked from snapshots at 1.5, 4.3, 5.0, 5.6, 6.6, 7.55, 8.8, 10.2, 11.6, 13.1, 14.6, 15.75, 15.95, 16.1, 16.4, 18.6, 21, 24.6, 26.5, 27.3, 27.55, 27.69, 28, 29, 31, 32.05 s. `hyperframes check`: ok (one info: the Orb canvas is intentionally covered by the UI scenes).

## Fixed in this pass
- Claim: the Orb showed as a hard-edged rectangle (banned "floating card"). The frame now stays full bleed; the 3D camera (view offset + zoom) moves the core right and shrinks it.
- End hand-off: a circular iris closes onto the Orb core where the logo tile lands (no rectangle inside the circle).
- Lens values arrived one frame late on direct seeks; the Orb now renders from the timeline's onUpdate, after every tween.
- Mix and Edit had large empty areas. Mix is framed at 1.5–1.62x with "Mix it" in the free space. Edit is at 1.25–1.38x.
- The dive into the Visualize icon now pans the icon to the centre while zooming.
- Drop line contrast over the bright core: stronger dark halo, moved to 112 px from the bottom.
- SFX: each peak placed one frame after its picture (riser peak at 2.506 s, so it starts at 13.681; impact peak 0.102 s, starts at 27.623; click at 7.53).

## Known / not verified
- The sound was measured, not listened to. The score and SFX are all HitStudio's own audio.
- Edit and Mix are real screen recordings at 1x (1920 px), shown at up to 1.62x, so they're slightly softer than the 2x stills.
- The rewind blur frames (4.7–6.4 s) are intentionally smeared.
