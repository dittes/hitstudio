"""HitStudio sampler library: 230+ original sounds, synthesized from scratch (no samples, no third-party material).

Run:  python3 scripts/make-sampler-library.py     (needs numpy, scipy and ffmpeg)
Writes assets/sampler/library/*.flac and assets/sampler/manifest.json (the factory kit from make-sampler-kit.py is
listed in the manifest too, so the sound browser shows everything). The output is deterministic: every sound has its
own fixed random seed, so re-running recreates the same files.
"""
import json, os, subprocess, wave
import numpy as np
from scipy import signal

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'assets', 'sampler')
LIB = os.path.join(ROOT, 'library')
os.makedirs(LIB, exist_ok=True)
for _f in os.listdir(LIB):  # start clean so renamed or removed sounds never linger
    if _f.endswith(('.wav', '.flac')): os.remove(os.path.join(LIB, _f))

rng = np.random.default_rng(0)
def seed(n):
    global rng
    rng = np.random.default_rng(n)

# ── helpers ──────────────────────────────────────────────────
def T(sec): return np.arange(int(SR * sec)) / SR
def noise(n): return rng.uniform(-1, 1, n)
def env(t, decay, attack=0.0015): return np.minimum(1, t / max(attack, 1e-6)) * np.exp(-t * decay)
def lp(x, fc, order=2): return signal.lfilter(*signal.butter(order, min(fc, SR * 0.45) / (SR / 2), 'low'), x)
def hp(x, fc, order=2): return signal.lfilter(*signal.butter(order, fc / (SR / 2), 'high'), x)
def bp(x, lo, hi, order=2): return signal.lfilter(*signal.butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], 'band'), x)
def sat(x, d=2.0): return np.tanh(x * d) / np.tanh(d)
def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def sweep(f0, f1, tau, t): return 2 * np.pi * (f1 * t + (f0 - f1) * tau * (1 - np.exp(-t / tau)))
def sine(f, t, ph=0): return np.sin(2 * np.pi * f * t + ph)
def saw(f, t, n=40):
    return sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, n) if f * h < SR * 0.45)
def square(f, t, n=40):
    return sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, n, 2) if f * h < SR * 0.45)
def room(x, sec=0.28, amount=0.25, bright=0.5):
    n = int(SR * sec); t = np.arange(n) / SR
    ir = noise(n) * np.exp(-t * (7 / sec)); ir = lp(ir, 3000 + 6000 * bright); ir[0] = 0
    wet = signal.fftconvolve(x, ir)[: len(x)]
    return x + amount * wet / (np.max(np.abs(wet)) + 1e-9) * np.max(np.abs(x))
def widen(x, width=0.3):
    d = int(SR * 0.012)
    return np.stack([x + width * np.roll(lp(x, 5000), d), x + width * np.roll(lp(x, 5000), 2 * d)], 1)
def tvlp(x, cut):
    """one-pole low-pass with a time-varying cutoff (Hz per sample)"""
    cut = np.broadcast_to(np.asarray(cut, dtype=np.float64), x.shape)
    a = 1 - np.exp(-2 * np.pi * np.minimum(cut, SR * 0.45) / SR)
    y = np.zeros_like(x); z = 0.0
    for i in range(len(x)):
        z += a[i] * (x[i] - z); y[i] = z
    return y
def ks(f, sec, damp=0.4975, bright=1.0):
    n = int(SR * sec); N = max(2, int(SR / f)); buf = noise(N) * 0.9
    if bright < 1: buf = lp(buf, 2000 + 12000 * bright)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % N]; buf[i % N] = damp * (buf[i % N] + buf[(i + 1) % N])
    return out
def fm(f, t, ratio=1.0, index=2.0, idecay=5.0):
    return np.sin(2 * np.pi * f * t + index * np.exp(-t * idecay) * np.sin(2 * np.pi * f * ratio * t))

SOUNDS = []   # dicts: id, name, cat, file, dur, ch
CATS = [
    ('kicks', 'Kicks', 0), ('snares', 'Snares', 0), ('claps', 'Claps', 0), ('rims', 'Rims & clicks', 0),
    ('hats', 'Closed hats', 1), ('openhats', 'Open hats', 1), ('shakers', 'Shakers', 1), ('toms', 'Toms', 1), ('cymbals', 'Cymbals', 1),
    ('perc', 'Percussion', 1), ('808', '808s & subs', 2), ('bass', 'Synth bass', 2), ('chords', 'Chord stabs', 2), ('keys', 'Keys & plucks', 2),
    ('bells', 'Bells & mallets', 3), ('leads', 'Leads & synths', 3), ('vocal', 'Voices', 3), ('fx', 'FX & risers', 3),
]
counters = {}

def finish(x, peak_db=-1.5, fade=0.01, max_sec=3.0):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1: x = x[:, None]
    x = signal.lfilter(*signal.butter(1, 20 / (SR / 2), 'high'), x, axis=0)
    # cut the silent tail (below -66 dB for good), keep a little air
    m = np.max(np.abs(x), axis=1); pk = m.max() + 1e-12
    loud = np.where(m > pk * 0.0005)[0]
    end = min(len(x), (loud[-1] + int(SR * 0.03)) if len(loud) else len(x), int(SR * max_sec))
    x = x[:end]
    f = min(len(x) // 2, int(SR * fade)); x[-f:] *= np.linspace(1, 0, f)[:, None]
    x[:int(SR * 0.0004)] *= np.linspace(0, 1, int(SR * 0.0004))[:, None]
    return x / (np.max(np.abs(x)) + 1e-12) * (10 ** (peak_db / 20))

# only a few sounds really gain from stereo; everything else is stored as mono to keep the download small
STEREO_OK = {'Riser 3 s', 'Riser tonal', 'Impact classic', 'Cinematic hit', 'Boom', 'Choir Am', 'Supersaw chord', 'Hoover', 'Crystal', 'Tubular low', 'Sweep up slow', 'Am7 EP', 'Cmaj7 EP', 'Gamelan', 'Crash big'}

def add(cat, name, x, stereo=False, peak=-1.5, fade=0.01, max_sec=3.0):
    x = finish(x, peak, fade, max_sec)
    if x.shape[1] == 2 and not (stereo and name in STEREO_OK): x = x.mean(axis=1, keepdims=True)
    counters[cat] = counters.get(cat, 0) + 1
    sid = f'{cat}-{counters[cat]:02d}'
    data = (np.clip(x, -1, 1) * 32767).astype('<i2')
    tmp = os.path.join(LIB, sid + '.tmp.wav')
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(data.shape[1]); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
    out = os.path.join(LIB, sid + '.flac')   # lossless, about half the size of WAV, decoded natively by every current browser
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-compression_level', '8', '-map_metadata', '-1', out], check=True)
    os.remove(tmp)
    SOUNDS.append({'id': sid, 'name': name, 'cat': cat, 'file': f'library/{sid}.flac', 'dur': round(len(x) / SR, 3), 'ch': int(data.shape[1])})

# ── kicks ────────────────────────────────────────────────────
def kick(f0, f1, tau, decay, click=0.4, drive=1.6, sec=0.5, h2=0.3, low=None):
    t = T(sec); ph = sweep(f0, f1, tau, t)
    k = np.sin(ph) * env(t, decay) + h2 * np.sin(2 * ph) * env(t, decay * 3.5)
    k += click * hp(noise(len(t)), 2500) * np.exp(-t * 400)
    if low: k = lp(k, low)
    return sat(k, drive)
seed(101)
for name, args in [
    ('Punch', (180, 50, .03, 9, .4, 1.6, .5)), ('Deep', (140, 42, .05, 5.5, .3, 1.3, .8)), ('Boom', (120, 38, .08, 3.5, .2, 2.0, 1.1)),
    ('Tight', (220, 60, .02, 14, .5, 1.5, .25)), ('Click', (260, 55, .015, 16, 1.0, 1.4, .22)), ('Soft', (130, 52, .04, 8, .1, 1.1, .45)),
    ('Hard', (210, 48, .03, 8, .8, 3.2, .45)), ('Sub', (90, 40, .05, 4, .05, 1.2, 1.0)), ('House', (160, 55, .03, 10, .35, 1.8, .35)),
    ('Trap', (100, 36, .1, 2.5, .15, 2.2, 1.2)), ('Distorted', (200, 50, .03, 7, .6, 6.0, .45)), ('Vinyl', (150, 58, .035, 9, .2, 1.4, .4, .3, 1600)),
    ('Lo-fi', (140, 55, .04, 8, .15, 1.6, .4, .3, 1400)), ('Electro', (170, 45, .035, 7, .5, 2.0, .45, .8)), ('Short boom', (110, 40, .06, 7, .25, 1.7, .4)),
    ('Mid punch', (240, 70, .025, 11, .6, 1.8, .3)),
]:
    add('kicks', name, kick(*args))
# acoustic-flavoured kick: a thump plus a beater click
t = T(.4); k = sine(75, t) * env(t, 14) + 0.5 * bp(noise(len(t)), 60, 220) * env(t, 25) + 0.5 * hp(noise(len(t)), 3500) * np.exp(-t * 300)
add('kicks', 'Beater', sat(k * 1.2, 1.4))

# ── snares ───────────────────────────────────────────────────
def snare(tone, nlo, nhi, dn, dt, mix=0.7, rm=0.2, sec=0.45, drive=1.4, snap=0.0, decay_hp=0.2):
    t = T(sec)
    tn = (sine(tone, t) + 0.5 * sine(tone * 1.78, t)) * env(t, dt)
    nz = bp(noise(len(t)), nlo, nhi) * env(t, dn) + decay_hp * hp(noise(len(t)), 5000) * env(t, dn * 1.7)
    x = sat(tn * mix + nz * (1 - mix * 0.3) + snap * hp(noise(len(t)), 4000) * np.exp(-t * 500), drive)
    return room(x, 0.22, rm, .5) if rm else x
seed(102)
for name, a in [
    ('Classic', (186, 1800, 9500, 17, 24)), ('Crack', (210, 2500, 11000, 22, 32, .6, .1, .35, 1.8, .4)), ('Fat', (160, 1200, 8000, 14, 18, .8, .3, .5)),
    ('Dry', (190, 1800, 9000, 20, 26, .7, 0)), ('Big room', (180, 1500, 9000, 12, 20, .7, .6, .8)), ('Tight', (200, 2000, 10000, 28, 36, .6, .05, .25)),
    ('Gated', (185, 1800, 9000, 8, 22, .7, .3, .4)), ('Lo-fi', (170, 1000, 5000, 15, 22, .7, .15, .4, 2.2)), ('Electro', (230, 2500, 12000, 18, 40, .9, .1, .35, 2)),
    ('Piccolo', (260, 2800, 12000, 24, 34, .6, .1, .3)), ('808', (200, 1500, 8000, 16, 14, .9, .2, .45, 1.6)), ('Trap snap', (220, 3000, 12000, 30, 40, .5, .15, .3, 1.5, .6)),
    ('Rimshot', (300, 2500, 9000, 30, 45, 1.0, .1, .25, 2.2, .5)), ('Brush', (150, 3000, 12000, 7, 20, .1, .1, .4, 1.0)),
]:
    add('snares', name, snare(*a))

# ── claps ────────────────────────────────────────────────────
def clap(bursts, spread, band, tail_decay, rm, sec=0.5, g=1.0):
    t = T(sec); x = np.zeros(len(t))
    for j in range(bursts):
        i = int(SR * spread * j); n = int(SR * 0.014)
        x[i:i + n] += bp(noise(n), *band) * np.linspace(1, 0.2, n) * (0.7 + 0.3 * j / max(1, bursts - 1))
    tail = bp(noise(len(t)), band[0] * .9, band[1] * .9) * env(t, tail_decay, spread * bursts + 0.005) * (t > spread * bursts)
    return room(sat(x * 1.1 + tail * 0.8 * g, 1.5), 0.3, rm, .4)
seed(103)
for name, a in [('Dry', (3, .011, (900, 3500), 13, .1)), ('Wide', (4, .014, (800, 3200), 11, .4, .55)), ('Tight', (3, .008, (1100, 3800), 22, .05, .3)),
                ('Big', (5, .012, (700, 3000), 9, .6, .7)), ('Lo-fi', (3, .012, (700, 2200), 14, .2, .45)), ('Snap', (2, .007, (1500, 5000), 26, .05, .25)),
                ('Stack', (6, .009, (900, 3500), 12, .3, .5)), ('808', (3, .013, (1000, 4000), 14, .25, .5))]:
    add('claps', name, clap(*a))

# ── rims & clicks ────────────────────────────────────────────
seed(104)
t = T(.16); add('rims', 'Rim classic', sat(sine(1720, t) * env(t, 70) + .6 * sine(480, t) * env(t, 55) + .4 * bp(noise(len(t)), 3000, 9000) * env(t, 120), 1.6))
t = T(.2); add('rims', 'Side stick', sat(sine(900, t) * env(t, 60) + .5 * sine(1850, t) * env(t, 80) + .3 * bp(noise(len(t)), 1500, 6000) * env(t, 150), 1.8))
t = T(.12); add('rims', 'Wood click', sine(1250, t) * env(t, 110) + .3 * sine(2600, t) * env(t, 140))
t = T(.05); add('rims', 'Tick', hp(noise(len(t)), 3000) * env(t, 220, .0005) + .5 * sine(3200, t) * env(t, 300))
t = T(.1); add('rims', 'Tock', sine(700, t) * env(t, 90) + .4 * sine(1400, t) * env(t, 120))
t = T(.18); add('rims', 'Stick hit', bp(noise(len(t)), 2000, 7000) * env(t, 90, .0004) + .5 * sine(1100, t) * env(t, 70))
t = T(.3); add('rims', 'Finger snap', room(bp(noise(len(t)), 1800, 6500) * env(t, 55, .0005) + .6 * bp(noise(len(t)), 900, 1400, 3) * env(t, 38, .004), .15, .15))
t = T(.18); add('rims', '808 rim', sat(sine(1800, t) * env(t, 90) + sine(540, t) * env(t, 60) * .5, 2.2))

# ── closed hats ──────────────────────────────────────────────
def hat(cut, decay, metal=0.35, sec=0.18, dark=0, atk=0.0008, freqs=(5230, 6890, 7940, 9100, 10450)):
    t = T(sec); h = hp(noise(len(t)), cut, 4) * env(t, decay, atk)
    h += metal * hp(sum(sine(f, t, rng.uniform(0, 6)) for f in freqs), cut * .7) * env(t, decay * 1.2)
    return lp(h, dark) if dark else h
seed(105)
for name, a in [('Tight', (7500, 48)), ('Crisp', (9000, 60, .25)), ('Tick', (8500, 110, .1, .08)), ('Dark', (5500, 45, .35, .18, 7000)), ('Lo-fi', (5000, 38, .2, .18, 6500)),
                ('Soft', (7000, 40, .2, .18, 0, .003)), ('Sizzle', (8000, 28, .5, .25)), ('Foot', (4500, 55, .5, .15, 8000)), ('Trap', (9500, 75, .2, .12)),
                ('808', (7000, 65, .45, .15, 0, .0008, (4200, 5600, 7000, 8400, 9800))), ('Bright', (11000, 55, .3)), ('Pedal', (6000, 70, .4, .12, 9000))]:
    add('hats', name, hat(*a))

# ── open hats ────────────────────────────────────────────────
def ohat(cut, d1, d2, metal=.3, sec=.9, dark=0):
    t = T(sec); h = hp(noise(len(t)), cut, 4) * (.7 * env(t, d1, .0008) + .5 * env(t, d2))
    h += metal * hp(sum(sine(f, t, rng.uniform(0, 6)) for f in (5230, 6890, 7940, 9100, 10450)), cut * .8) * env(t, d1 * 1.1)
    return lp(h, dark) if dark else h
seed(106)
for name, a in [('Open classic', (6500, 7, 22)), ('Short open', (7000, 14, 30)), ('Long open', (6000, 4, 14, .35, 1.6)), ('Dark open', (5000, 8, 20, .3, .9, 7000)), ('Lo-fi open', (4500, 7, 18, .25, .9, 6000)),
                ('Bright open', (9000, 7, 22)), ('Loose', (6500, 5, 12, .5, 1.2)), ('808 open', (7000, 9, 24, .45))]:
    add('openhats', name, ohat(*a))

# ── shakers ──────────────────────────────────────────────────
seed(107)
def shake(sec, atk, decay, lo, hi, g=1.0): t = T(sec); return bp(noise(len(t)), lo, hi) * env(t, decay, atk) * g
add('shakers', 'Shaker', shake(.28, .03, 14, 4000, 11000))
add('shakers', 'Shaker short', shake(.14, .015, 28, 4500, 12000))
add('shakers', 'Shaker long', shake(.55, .07, 7, 3500, 10500))
x = shake(.4, .02, 12, 4000, 11000); t = T(.4); x += .35 * hp(sum(sine(f, t, rng.uniform(0, 6)) for f in (5600, 7100, 8700, 10200)), 4500) * env(t, 9); add('shakers', 'Tambourine', x)
add('shakers', 'Maraca', shake(.22, .008, 22, 5000, 12000))
add('shakers', 'Cabasa', shake(.2, .012, 18, 3000, 9000, 1.1) + .3 * shake(.2, .004, 40, 6000, 12000))
add('shakers', 'Egg shaker', shake(.18, .01, 24, 2500, 7000))
t = T(.5); x = shake(.5, .02, 10, 4000, 11000); x[int(SR * .12):] += shake(.5, .02, 12, 4000, 11000)[:len(x) - int(SR * .12)] * .8; add('shakers', 'Shaker roll', x)

# ── toms ─────────────────────────────────────────────────────
def tom(f0, f1, tau, decay, sec=.6, click=.25):
    t = T(sec); ph = sweep(f0, f1, tau, t)
    return sat(np.sin(ph) * env(t, decay) + .3 * np.sin(2 * ph) * env(t, decay * 2.2) + click * bp(noise(len(t)), 300, 2500) * np.exp(-t * 60), 1.4)
seed(108)
for name, a in [('Floor', (110, 62, .08, 5.5, .8)), ('Low', (150, 85, .07, 6, .7)), ('Mid', (190, 110, .06, 6.5)), ('High', (250, 150, .05, 7.5, .5)), ('Rack', (300, 190, .04, 9, .45)),
                ('Electro', (260, 90, .1, 5, .6)), ('Boom tom', (120, 50, .1, 3.5, 1.0)), ('Dry tom', (200, 120, .05, 14, .3))]:
    add('toms', name, tom(*a))

# ── cymbals ──────────────────────────────────────────────────
def cymbal(d1, d2, sec, lo=3500, metal=.35, freqs=(3250, 4170, 5480, 6310, 7920, 9830)):
    t = T(sec); c = hp(noise(len(t)), lo, 3) * (.8 * env(t, d1, .002) + .4 * env(t, d2))
    c += metal * hp(sum(sine(f, t, rng.uniform(0, 6)) * env(t, 2 + i * .4) for i, f in enumerate(freqs)), lo * .7)
    return c
seed(109)
for name, a in [('Crash classic', (2.6, 9, 1.9)), ('Crash big', (1.7, 6, 2.6, 3000)), ('Crash short', (4, 14, 1.0)), ('Ride', (3.5, 7, 1.8, 4500, .55)), ('Ride bell', (5, 8, 1.4, 5500, .7, (2400, 3900, 5200, 6800))),
                ('Splash', (6, 16, .8, 5000)), ('China', (3, 12, 1.2, 2500, .2)), ('Dark crash', (2.4, 8, 2.0, 2200))]:
    add('cymbals', name, widen(cymbal(*a), .3), stereo=True)

# ── percussion ───────────────────────────────────────────────
seed(110)
def cowbell(f1, f2, decay, sec=.5): t = T(sec); x = (square(f1, t, 9) + square(f2, t, 9)) * env(t, decay, .001); return sat(bp(x, f1 * .8, f2 * 2.5, 2), 1.6)
add('perc', 'Cowbell', cowbell(540, 810, 9)); add('perc', 'Cowbell high', cowbell(720, 1090, 11)); add('perc', 'Cowbell low', cowbell(420, 640, 8, .6))
t = T(.15); add('perc', 'Woodblock high', sine(1500, t) * env(t, 60) + .4 * sine(3000, t) * env(t, 80))
t = T(.18); add('perc', 'Woodblock low', sine(850, t) * env(t, 50) + .4 * sine(1700, t) * env(t, 70))
def conga(f, decay, slap=0, sec=.5): t = T(sec); ph = sweep(f * 1.25, f, .02, t); return sat(np.sin(ph) * env(t, decay) + .3 * np.sin(2 * ph) * env(t, decay * 2) + slap * bp(noise(len(t)), 1500, 6000) * np.exp(-t * 90), 1.3)
add('perc', 'Conga high', conga(330, 12)); add('perc', 'Conga low', conga(210, 9, 0, .6)); add('perc', 'Conga slap', conga(300, 20, .8, .3))
add('perc', 'Bongo high', conga(480, 18, .2, .3)); add('perc', 'Bongo low', conga(340, 15, .2, .35))
t = T(.25); add('perc', 'Clave', sine(2500, t) * env(t, 45) + .3 * sine(5000, t) * env(t, 70))
t = T(1.6); add('perc', 'Triangle', sum(a * sine(f, t) * env(t, d) for f, a, d in [(3100, 1, 2.5), (6900, .5, 3), (9300, .3, 4)]) * .8)
t = T(.6); add('perc', 'Agogo', sum(a * sine(f, t) * env(t, d) for f, a, d in [(700, 1, 7), (1880, .6, 9), (3200, .3, 12)]))
t = T(.5); add('perc', 'Tabla', sat(np.sin(sweep(260, 190, .03, t)) * env(t, 8) + .3 * np.sin(sweep(520, 380, .03, t)) * env(t, 12), 1.5))
t = T(.4); add('perc', 'Timbale', sat(sine(430, t) * env(t, 12) + .5 * bp(noise(len(t)), 2000, 8000) * env(t, 40) + .4 * sine(860, t) * env(t, 18), 1.6))

# ── 808s and subs ────────────────────────────────────────────
def s808(f, decay, drive=2.4, glide=1.8, sec=1.3, tau=.05, h2=.12):
    t = T(sec); ph = sweep(f * glide, f, tau, t)
    return sat(np.sin(ph) * env(t, decay, .004) + h2 * np.sin(2 * ph) * env(t, decay * 1.8), drive)
seed(111)
for note, m in [('E1', 28), ('F1', 29), ('G1', 31), ('A1', 33), ('Bb1', 34), ('C2', 36), ('D2', 38)]:
    add('808', f'808 {note}', s808(mtof(m), 2.4))
add('808', '808 long A1', s808(mtof(33), 1.1, 2.0, 1.5, 2.6)); add('808', '808 short A1', s808(mtof(33), 6, 2.0, 2.0, .5))
add('808', '808 dirty E1', s808(mtof(28), 2.2, 6, 1.6)); add('808', '808 glide D2', s808(mtof(38), 2.0, 2.4, 2.8, 1.3, .12))
t = T(1.2); add('808', 'Sub sine A1', sine(mtof(33), t) * env(t, 2.0, .008))
t = T(1.0); add('808', 'Sub round E1', sat(sine(mtof(28), t) * env(t, 2.6, .006) + .2 * sine(mtof(40), t) * env(t, 5), 1.8))

# ── synth bass ───────────────────────────────────────────────
def sbass(m, wave, cut0, cut1, cdec, decay, sec=.7, det=1.006, drive=2.0, res=0):
    t = T(sec); f = mtof(m)
    if wave == 'saw': x = saw(f, t, 30) + .6 * saw(f * det, t, 20)
    elif wave == 'square': x = square(f, t, 30) + .5 * square(f * det, t, 20)
    else: x = sine(f, t) + .4 * sine(2 * f, t)
    x = tvlp(x, cut1 + (cut0 - cut1) * np.exp(-t * cdec)) * env(t, decay, .003)
    return sat(x * .9, drive)
seed(112)
for name, a in [('Saw A1', (33, 'saw', 2600, 220, 9, 4.5)), ('Saw C2', (36, 'saw', 3000, 260, 10, 5)), ('Saw E2', (40, 'saw', 3200, 300, 11, 6)), ('Saw dark A1', (33, 'saw', 900, 160, 8, 3.5)),
                ('Square A1', (33, 'square', 1800, 200, 8, 4.5)), ('Square C2', (36, 'square', 2200, 240, 9, 5.5)), ('Pluck bass', (33, 'saw', 3500, 180, 18, 9, .45)),
                ('Round bass', (33, 'sine', 800, 400, 5, 3, .8)), ('Reese', (33, 'saw', 1800, 500, 2, 1.8, 1.4, 1.012, 1.6)), ('Acid', (36, 'saw', 3500, 250, 6, 3, .7, 1.0, 3.0)),
                ('Wide stab', (31, 'saw', 2800, 220, 12, 6, .55, 1.01)), ('Fifth stab', (40, 'square', 2600, 280, 14, 8, .4))]:
    add('bass', name, sbass(*a))

# ── chord stabs ──────────────────────────────────────────────
def chord(notes, kind, sec=1.1, decay=2.5, pan=True):
    t = T(sec); out = np.zeros((len(t), 2))
    for j, m in enumerate(notes):
        f = mtof(m); p = (-0.5 + j / max(1, len(notes) - 1)) * .9 if pan else 0
        if kind == 'ep': v = fm(f, t, 1.0, 2.6, 5.5) * env(t, decay, .004) + .25 * sine(f * 4, t) * env(t, 14)
        elif kind == 'organ': v = (sine(f, t) + .5 * sine(2 * f, t) + .35 * sine(3 * f, t) + .25 * sine(4 * f, t)) * env(t, decay * 1.4, .006)
        elif kind == 'saw': v = tvlp(saw(f, t, 25) + .5 * saw(f * 1.006, t, 20), 600 + 3500 * np.exp(-t * 9)) * env(t, decay * 1.5, .004)
        elif kind == 'string': v = tvlp(saw(f, t, 20) + saw(f * 1.01, t, 20) + saw(f * .99, t, 20), 2500) * env(t, decay * .9, .06)
        elif kind == 'brass': v = tvlp(saw(f, t, 25), 700 + 3000 * (1 - np.exp(-t * 14)) * np.exp(-t * 3)) * env(t, decay * 1.6, .025)
        else: v = sine(f, t) * env(t, decay)
        out[:, 0] += v * (1 - max(0, p)); out[:, 1] += v * (1 + min(0, p))
    return sat(out * (.9 / len(notes)) * 1.6, 1.3)
seed(113)
for name, notes, kind in [('Am7 EP', [45, 52, 55, 59, 64], 'ep'), ('Cmaj7 EP', [48, 55, 59, 64, 67], 'ep'), ('Dm9 EP', [50, 57, 60, 64, 65], 'ep'), ('Fmaj7 EP', [41, 53, 57, 60, 64], 'ep'),
                          ('G7 EP', [43, 53, 59, 62, 67], 'ep'), ('Em7 EP', [40, 55, 59, 62, 66], 'ep'), ('Am organ', [45, 57, 60, 64], 'organ'), ('C organ', [48, 60, 64, 67], 'organ'),
                          ('Am saw', [45, 57, 60, 64], 'saw'), ('F saw', [41, 53, 57, 60], 'saw'), ('Power A', [33, 40, 45, 52], 'saw'), ('Sus2 strings', [45, 52, 57, 59], 'string'),
                          ('Am strings', [45, 57, 60, 64], 'string'), ('Brass chord', [48, 55, 60, 64], 'brass')]:
    add('chords', name, chord(notes, kind), stereo=True)

# ── keys & plucks ────────────────────────────────────────────
seed(114)
for name, m in [('EP C4', 60), ('EP A3', 57), ('EP E4', 64)]:
    t = T(1.6); add('keys', name, widen(fm(mtof(m), t, 1.0, 2.2, 4.5) * env(t, 2.2, .003) + .2 * sine(mtof(m) * 4, t) * env(t, 16), .1), stereo=True)
for name, m, d in [('Pluck C4', 60, .4975), ('Pluck G3', 55, .4985), ('Pluck E4', 64, .497)]:
    add('keys', name, lp(ks(mtof(m), 1.4, d), 8000) * np.exp(-T(1.4) * 1.3))
add('keys', 'Harp C5', lp(ks(mtof(72), 1.8, .499, .9), 10000) * np.exp(-T(1.8) * .9))
add('keys', 'Guitar A2', lp(ks(mtof(45), 1.6, .4965, .6), 4000) * np.exp(-T(1.6) * 1.1))
t = T(1.3); add('keys', 'Marimba A3', (sine(mtof(57), t) * env(t, 5) + .4 * sine(mtof(57) * 4, t) * env(t, 16) + .1 * sine(mtof(57) * 9.2, t) * env(t, 30)))
t = T(1.2); add('keys', 'Kalimba C5', (sine(mtof(72), t) * env(t, 6) + .35 * sine(mtof(72) * 5.4, t) * env(t, 20)) + .2 * hp(noise(len(t)), 3000) * np.exp(-t * 200))
t = T(1.5); add('keys', 'Piano C4', sat(fm(mtof(60), t, 1.0, 1.4, 3) * env(t, 2.6, .002) + .5 * fm(mtof(60) * 2.0005, t, 1, 1, 6) * env(t, 3.5) + .25 * hp(noise(len(t)), 2500) * np.exp(-t * 160), 1.2))
t = T(1.8); add('keys', 'Piano C3', sat(fm(mtof(48), t, 1.0, 1.8, 2.6) * env(t, 1.9, .002) + .4 * fm(mtof(48) * 2.0005, t, 1, 1, 5) * env(t, 3) + .25 * hp(noise(len(t)), 1800) * np.exp(-t * 140), 1.2))
t = T(2.0); add('keys', 'Music box', sum(a * sine(mtof(84) * r, t) * env(t, d) for r, a, d in [(1, 1, 2), (3.9, .3, 6), (7.8, .15, 10)]) * .7)
t = T(2.2); add('keys', 'Vibes C5', sum(a * sine(mtof(72) * r, t) * env(t, d) for r, a, d in [(1, 1, 1.6), (4, .25, 5), (10, .1, 9)]) * (1 + .15 * sine(5.5, t)))
add('keys', 'Harpsichord C4', lp(ks(mtof(60), 1.1, .492, 1.0), 12000) * np.exp(-T(1.1) * 3.2))
t = T(1.4); add('keys', 'Clav E3', sat(tvlp(square(mtof(52), t, 30), 600 + 4000 * np.exp(-t * 18)) * env(t, 4.5, .002), 2))

# ── bells & mallets ──────────────────────────────────────────
seed(115)
def bell(f, sec, parts=((1, 1, 1.5), (2.76, .5, 2.6), (5.4, .28, 4.2), (8.93, .14, 6.5)), idx=1.4):
    t = T(sec); return sum(a * np.sin(2 * np.pi * f * r * t + idx * np.sin(2 * np.pi * f * 1.4 * t) * env(t, 3)) * env(t, d) for r, a, d in parts)
for name, m in [('Bell C5', 72), ('Bell E5', 76), ('Bell G5', 79), ('Bell A5', 81)]:
    add('bells', name, widen(bell(mtof(m), 2.4) * .4, .3), stereo=True)
add('bells', 'Glockenspiel', widen(bell(mtof(84), 1.6, ((1, 1, 3), (2.4, .5, 5), (5.6, .3, 9)), .6) * .6, .25), stereo=True)
add('bells', 'Tubular low', widen(bell(mtof(55), 3.0, ((1, 1, .9), (2.0, .6, 1.4), (3.0, .5, 1.8), (4.2, .3, 2.6)), 1.0) * .5, .3), stereo=True)
add('bells', 'Crystal', widen(bell(mtof(88), 2.2, ((1, 1, 1.4), (3.1, .6, 2.2), (6.7, .35, 3.6), (11, .2, 5)), 1.8) * .4, .35), stereo=True)
add('bells', 'Chime', widen(bell(mtof(91), 2.8, ((1, 1, 1.1), (2.3, .6, 1.8), (4.1, .4, 3)), .8) * .5, .3), stereo=True)
t = T(1.4); add('bells', 'Mallet', sat(sine(mtof(67), t) * env(t, 6) + .5 * sine(mtof(67) * 3, t) * env(t, 14) + .2 * sine(mtof(67) * 7, t) * env(t, 24), 1.2))
t = T(2.4); add('bells', 'Gamelan', widen(sum(a * sine(mtof(70) * r, t) * env(t, d) for r, a, d in [(1, 1, 1.8), (1.52, .6, 2.2), (2.31, .45, 2.8), (3.7, .3, 4)]) * .6, .3), stereo=True)

# ── leads & synths ───────────────────────────────────────────
seed(116)
def lead(m, kind, sec=.8, decay=4, cut=4000):
    t = T(sec); f = mtof(m)
    if kind == 'saw': x = saw(f, t, 30) + .7 * saw(f * 1.007, t, 30) + .7 * saw(f * .993, t, 30)
    elif kind == 'square': x = square(f, t, 40)
    elif kind == 'pulse': x = square(f, t, 40) - square(f, t + .12 / f, 40) * .9
    else: x = sine(f, t) + .3 * sine(2 * f, t)
    return sat(tvlp(x, cut * (.4 + .6 * np.exp(-t * 7))) * env(t, decay, .004) * .6, 1.6)
for name, a in [('Saw lead A3', (57, 'saw')), ('Saw lead C4', (60, 'saw')), ('Square lead', (57, 'square')), ('Pulse lead', (60, 'pulse')), ('Chip beep', (72, 'square', .35, 8, 9000)),
                ('Sine lead', (69, 'sine', 1.0, 3)), ('Pop synth', (64, 'saw', .6, 6, 5500))]:
    add('leads', name, lead(*a))
t = T(.9); x = sum(saw(mtof(m) * (1 + d), t, 25) for m in (57, 60, 64) for d in (-.012, 0, .012)); add('leads', 'Supersaw chord', widen(tvlp(x, 600 + 6000 * np.exp(-t * 8)) * env(t, 3.5, .005) * .15, .3), stereo=True)
t = T(.8); add('leads', 'Brass stab', sat(tvlp(saw(mtof(55), t, 30) + .8 * saw(mtof(55) * 1.004, t, 30), 500 + 4500 * (1 - np.exp(-t * 20)) * np.exp(-t * 4)) * env(t, 4.5, .02) * .6, 1.8))
t = T(1.2); add('leads', 'Hoover', widen(tvlp(sum(saw(mtof(45) * (1 + (k - 1.5) * .012), t, 25) for k in range(4)), 3500) * env(t, 2.2, .01) * .3, .4), stereo=True)

# ── voices ───────────────────────────────────────────────────
seed(117)
FORM = {'ah': [(750, .9, 80), (1150, .5, 100), (2600, .25, 160)], 'ee': [(300, .9, 60), (2300, .6, 140), (3000, .35, 180)], 'oo': [(320, .9, 60), (800, .35, 90), (2400, .1, 160)],
        'oh': [(500, .9, 70), (900, .5, 90), (2500, .15, 160)], 'eh': [(550, .9, 80), (1800, .55, 120), (2500, .3, 160)]}
def voice(vowel, m, sec=1.3, vib=5.4, vdepth=.012, atk=.1, rel=.3, breath=.025):
    t = T(sec); f0 = mtof(m) * (1 + vdepth * sine(vib, t) * np.minimum(1, t * 3)); ph = 2 * np.pi * np.cumsum(f0) / SR
    src = sum(np.sin(h * ph) / h ** .9 for h in range(1, 40) if mtof(m) * h < 9000)
    v = sum(bp(src, max(60, fc - bw), fc + bw) * g for fc, g, bw in FORM[vowel]) + .25 * lp(src, 300)
    v *= np.minimum(1, t / atk) * np.minimum(1, (sec - t) / rel)
    return v + breath * hp(noise(len(t)), 4000) * np.minimum(1, t / atk) * np.minimum(1, (sec - t) / rel)
for vowel, m, nm in [('ah', 57, 'Ah A3'), ('ah', 64, 'Ah E4'), ('ee', 60, 'Ee C4'), ('oo', 55, 'Oo G3'), ('oh', 60, 'Oh C4')]:
    add('vocal', nm, widen(voice(vowel, m), .35), stereo=True)
t = T(1.4); ch = sum(voice('ah', m, 1.4, 5 + k * .4, .01, .12, .35) for k, m in enumerate((52, 55, 59, 64))) / 4; add('vocal', 'Choir Am', widen(ch, .4), stereo=True)
t = T(.35); hey = (bp(noise(len(t)), 800, 3200) * env(t, 20, .004) * .6 + voice('eh', 62, .35, 6, .05, .01, .12, .08) * .8); add('vocal', 'Hey', hey)
t = T(.5); add('vocal', 'Breath', bp(noise(len(t)), 600, 5000) * np.minimum(1, t / .1) * np.minimum(1, (.5 - t) / .25) * .5)

# ── fx ───────────────────────────────────────────────────────
seed(118)
def riser(sec, lo, hi, tonal=0.25, curve=1.6, bright=2.4):
    t = T(sec); sw = lo * ((hi / lo) ** (t / sec)); y = tvlp(noise(len(t)), sw)
    ton = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (t / sec * 2)) / SR) * tonal
    return (y * bright + ton) * (t / sec) ** curve * np.minimum(1, (sec - t) / .06)
for name, a in [('Riser 1 s', (1.0, 400, 14000)), ('Riser 2 s', (2.0, 300, 16000)), ('Riser 3 s', (3.0, 250, 16000, .3)), ('Riser dark', (2.4, 150, 6000, .15, 1.4)),
                ('Riser tonal', (2.5, 300, 12000, .6)), ('Riser bright', (2.0, 2000, 18000, .1, 1.3)), ('Riser slow', (3.0, 200, 10000, .2, 2.2)), ('Riser short', (.6, 500, 12000, .1, 1.2))]:
    add('fx', name, widen(riser(*a), .35), stereo=True)
for name, sec, hi in [('Downlifter', 1.6, 12000), ('Downlifter long', 2.6, 14000), ('Downlifter dark', 1.8, 5000)]:
    t = T(sec); sw = hi * ((150 / hi) ** (t / sec)); y = tvlp(noise(len(t)), sw) * 2.2 * env(t, 1.4, .02); add('fx', name, widen(y, .3), stereo=True)
t = T(1.4); add('fx', 'Tape stop', sat(np.sin(2 * np.pi * np.cumsum(220 * np.exp(-t * 3.2)) / SR) * np.exp(-t * 1.6), 1.5))
def impact(f0, f1, tau, dec, sec, nz=.5, rm=.45):
    t = T(sec); boom = np.sin(sweep(f0, f1, tau, t)) * env(t, dec, .002); burst = lp(noise(len(t)), 6000) * env(t, 9) * nz + hp(noise(len(t)), 2500) * env(t, 4) * .12
    return room(sat(boom * 1.2 + burst, 1.6), .9, rm, .15)
for name, a in [('Impact classic', (95, 34, .12, 1.9, 2.6)), ('Impact deep', (70, 28, .15, 1.4, 3.0, .3)), ('Hit short', (130, 45, .05, 5, 1.0, .6, .2)), ('Boom', (60, 25, .2, 1.1, 3.0, .2, .6)),
                ('Cinematic hit', (85, 32, .1, 1.5, 3.0, .8, .7)), ('Sub drop', (80, 30, .25, 1.2, 2.2, .05, .3))]:
    add('fx', name, widen(impact(*a), .25), stereo=True)
for name, up, a, b, sec in [('Sweep up', True, 200, 15000, 1.4), ('Sweep down', False, 15000, 200, 1.4), ('Sweep up slow', True, 300, 12000, 2.4), ('Whoosh', True, 400, 9000, .8), ('Swoosh', False, 9000, 500, .7), ('Air', True, 3000, 16000, 1.0)]:
    t = T(sec); c = a * ((b / a) ** (t / sec)); y = tvlp(noise(len(t)), c) * (np.sin(np.pi * np.minimum(1, t / sec)) ** (.8 if up else 1.2)) * 2.5; add('fx', name, widen(y, .4), stereo=True)
for name, f0, f1, sec, kind in [('Laser', 4000, 300, .35, 'sine'), ('Zap', 6000, 200, .2, 'saw'), ('Laser up', 300, 5000, .4, 'sine'), ('Blip', 900, 1800, .15, 'square'), ('Power down', 1200, 60, .9, 'saw'), ('Power up', 80, 1500, .8, 'saw')]:
    t = T(sec); ph = 2 * np.pi * np.cumsum(f0 * (f1 / f0) ** (t / sec)) / SR
    w = np.sin(ph) if kind == 'sine' else (np.sign(np.sin(ph)) * .6 if kind == 'square' else sum(np.sin(h * ph) / h for h in range(1, 12)))
    add('fx', name, sat(lp(w, 9000) * env(t, 3.2 if sec > .5 else 7, .003) * .8, 1.4))
t = T(.4); x = np.zeros(len(t)); step = int(SR * .045)
for j in range(8): seg = slice(j * step, j * step + step); x[seg] = (sine(300 + 120 * (j % 3), t[seg]) + .5 * bp(noise(step), 800, 4000)) * np.hanning(step) * (j % 2 == 0)
add('fx', 'Glitch stutter', sat(x, 1.8))
t = T(.5); g = noise(len(t)); g[::7] = 0; add('fx', 'Glitch noise', bp(g, 800, 9000) * env(t, 8, .002) * (np.sin(2 * np.pi * 28 * t) > 0))
t = T(.6); add('fx', 'Bit crush hit', np.round(sat(sine(180, t) * env(t, 8) + .5 * noise(len(t)) * env(t, 30), 2) * 6) / 6)
t = T(.5); add('fx', 'Reverse snare', (room(snare(186, 1800, 9500, 17, 24, .7, .5, .5), .5, .5)[::-1])[: len(t)] * np.linspace(.2, 1, len(t)) ** 2)
t = T(1.6); add('fx', 'Reverse crash', (cymbal(2.6, 9, 1.6)[::-1]) * .8)
def crackle(sec, dens):
    n = int(SR * sec); x = np.zeros(n); idx = rng.integers(0, n, int(dens * sec))
    x[idx] = rng.uniform(-1, 1, len(idx)) * rng.uniform(.2, 1, len(idx)) ** 2
    return hp(lp(x, 8000) + 0.01 * lp(noise(n), 4000), 400)
add('fx', 'Vinyl crackle', crackle(2.0, 260), max_sec=2.2); add('fx', 'Vinyl dust', crackle(2.0, 90), max_sec=2.2); add('fx', 'Tape hiss', hp(lp(noise(int(SR * 1.5)), 9000), 3000) * .35, fade=.2, max_sec=1.6)

# ── manifest ─────────────────────────────────────────────────
factory = [
    ('01-kick', 'Kick', 'kicks'), ('02-snare', 'Snare', 'snares'), ('03-clap', 'Clap', 'claps'), ('04-rim', 'Rim', 'rims'), ('05-hat-closed', 'Hat', 'hats'), ('06-hat-open', 'Open hat', 'openhats'),
    ('07-tom', 'Tom', 'toms'), ('08-crash', 'Crash', 'cymbals'), ('09-808-sub', '808', '808'), ('10-bass-stab', 'Bass stab', 'bass'), ('11-chord-am9', 'Am9 chord', 'chords'), ('12-pluck', 'Pluck', 'keys'),
    ('13-bell', 'Bell', 'bells'), ('14-vox-ooh', 'Vox ooh', 'vocal'), ('15-riser', 'Riser', 'fx'), ('16-impact', 'Impact', 'fx'),
]
fac = []
for fid, name, cat in factory:
    with wave.open(os.path.join(ROOT, fid + '.wav')) as w:
        fac.append({'id': 'kit-' + fid[:2], 'name': name, 'cat': cat, 'file': fid + '.wav', 'dur': round(w.getnframes() / w.getframerate(), 3), 'ch': w.getnchannels(), 'factory': True})
allsounds = fac + SOUNDS
manifest = {'version': 1, 'categories': [{'id': c, 'name': n, 'row': r} for c, n, r in CATS], 'sounds': allsounds}
with open(os.path.join(ROOT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, separators=(',', ':'))
tot = sum(os.path.getsize(os.path.join(LIB, f)) for f in os.listdir(LIB))
print(f'{len(SOUNDS)} library sounds + {len(fac)} kit sounds = {len(allsounds)}; library {tot / 1e6:.1f} MB')
for c, n, _ in CATS: print(f'  {n:16s} {sum(1 for s in allsounds if s["cat"] == c)}')
