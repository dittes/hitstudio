"""HitStudio Kit 01: 16 original sounds synthesized from scratch (no samples, no third-party material).

Run:  python3 scripts/make-sampler-kit.py     (needs numpy and scipy)
The output is deterministic (fixed random seed), so re-running recreates the same files."""
import numpy as np, wave, os
from scipy import signal

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sampler')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1234)

def t_(sec): return np.arange(int(SR * sec)) / SR
def noise(n): return rng.uniform(-1, 1, n)
def env_exp(t, decay, attack=0.0015): return np.minimum(1, t / max(attack, 1e-6)) * np.exp(-t * decay)
def lp(x, fc, order=2): return signal.lfilter(*signal.butter(order, fc / (SR / 2), 'low'), x)
def hp(x, fc, order=2): return signal.lfilter(*signal.butter(order, fc / (SR / 2), 'high'), x)
def bp(x, lo, hi, order=2): return signal.lfilter(*signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band'), x)
def sat(x, drive=2.0): return np.tanh(x * drive) / np.tanh(drive)
def sweep_phase(f0, f1, tau, t): return 2 * np.pi * (f1 * t + (f0 - f1) * tau * (1 - np.exp(-t / tau)))
def room(x, sec=0.28, amount=0.25, bright=0.5):
    n = int(SR * sec); t = np.arange(n) / SR
    ir = noise(n) * np.exp(-t * (7 / sec)); ir = lp(ir, 3000 + 6000 * bright)
    ir[0] = 0
    wet = signal.fftconvolve(x, ir)[: len(x)]
    return x + amount * wet / (np.max(np.abs(wet)) + 1e-9) * np.max(np.abs(x))
def stereo(x, width=0.0, seed=1):
    if width == 0: return np.stack([x, x], 1)
    r = np.random.default_rng(seed); d = int(SR * 0.012)
    l = x + width * np.roll(lp(x, 5000), d); rr = x + width * np.roll(lp(x, 5000), 2 * d)
    return np.stack([l, rr], 1)
def finish(x, peak_db=-1.2, fade=0.015):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1: x = x[:, None]
    x = x - x.mean(axis=0, keepdims=True) * 0.0
    x = signal.lfilter(*signal.butter(1, 18 / (SR / 2), 'high'), x, axis=0)  # remove DC / subsonic
    f = int(SR * fade); x[-f:] *= np.linspace(1, 0, f)[:, None]
    x[:int(SR * 0.0004)] *= np.linspace(0, 1, int(SR * 0.0004))[:, None]
    x = x / (np.max(np.abs(x)) + 1e-9) * (10 ** (peak_db / 20))
    return x.astype(np.float32)
def write(name, x):
    x = finish(x) if x.ndim == 1 or x.dtype != np.float32 else x
    data = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(f'{OUT}/{name}.wav', 'wb') as w:
        w.setnchannels(data.shape[1]); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
    print(f'{name:14s} {data.shape[0] / SR:4.2f}s {data.shape[1]}ch {os.path.getsize(f"{OUT}/{name}.wav") // 1024} KB')

# 01 Kick
t = t_(0.55); ph = sweep_phase(190, 46, 0.035, t)
k = np.sin(ph) * env_exp(t, 7.5) + 0.35 * np.sin(2 * ph) * env_exp(t, 28)
k += 0.5 * hp(noise(len(t)), 2500) * np.exp(-t * 400)  # click
write('01-kick', sat(k, 1.7))
# 02 Snare
t = t_(0.42)
tone = (np.sin(2 * np.pi * 186 * t) + 0.5 * np.sin(2 * np.pi * 332 * t)) * env_exp(t, 24)
nz = bp(noise(len(t)), 1800, 9500) * env_exp(t, 17) * 0.9 + hp(noise(len(t)), 5000) * env_exp(t, 30) * 0.2
write('02-snare', room(sat(tone * 0.7 + nz * 0.75, 1.4), 0.22, 0.2))
# 03 Clap
t = t_(0.5); x = np.zeros(len(t))
for off, g in [(0, 0.8), (0.011, 0.9), (0.024, 1.0)]:
    i = int(SR * off); n = int(SR * 0.014); x[i:i + n] += bp(noise(n), 900, 3500) * np.linspace(1, 0.2, n) * g
tail = bp(noise(len(t)), 800, 3000) * env_exp(t, 13, 0.034) * (t > 0.032)
write('03-clap', room(sat(x * 1.1 + tail * 0.8, 1.5), 0.3, 0.35))
# 04 Rim
t = t_(0.16)
r = np.sin(2 * np.pi * 1720 * t) * env_exp(t, 70) + 0.6 * np.sin(2 * np.pi * 480 * t) * env_exp(t, 55) + 0.4 * bp(noise(len(t)), 3000, 9000) * env_exp(t, 120)
write('04-rim', sat(r, 1.6))
# 05 Hat closed
t = t_(0.14); h = hp(noise(len(t)), 7500, 4) * env_exp(t, 48, 0.0008)
h += 0.35 * hp(sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) for f in (5230, 6890, 7940, 9100, 10450)), 5000) * env_exp(t, 55)
write('05-hat-closed', h)
# 06 Hat open
t = t_(0.7); h = hp(noise(len(t)), 6500, 4) * (0.7 * env_exp(t, 7, 0.0008) + 0.5 * env_exp(t, 22))
h += 0.3 * hp(sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) for f in (5230, 6890, 7940, 9100, 10450)), 5500) * env_exp(t, 8)
write('06-hat-open', h)
# 07 Tom
t = t_(0.6); ph = sweep_phase(190, 98, 0.06, t)
tm = np.sin(ph) * env_exp(t, 6.5) + 0.3 * np.sin(2 * ph) * env_exp(t, 14) + 0.25 * bp(noise(len(t)), 300, 2200) * np.exp(-t * 60)
write('07-tom', sat(tm, 1.4))
# 08 Crash
t = t_(1.9); cr = hp(noise(len(t)), 3500, 3) * (0.8 * env_exp(t, 2.6, 0.002) + 0.4 * env_exp(t, 9))
cr += 0.35 * hp(sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * env_exp(t, 2 + i * 0.4) for i, f in enumerate((3250, 4170, 5480, 6310, 7920, 9830))), 2500)
write('08-crash', stereo(cr, 0.35, 8))
# 09 808 sub (tuned to A1 = 55 Hz)
t = t_(1.3); ph = sweep_phase(110, 55, 0.05, t)
s8 = np.sin(ph) * env_exp(t, 2.3, 0.004) + 0.12 * np.sin(2 * ph) * env_exp(t, 4)
write('09-808-sub', sat(s8, 2.4))
# 10 Bass stab (saw, A1, filter sweep)
t = t_(0.7); f0 = 55.0
saw = sum(np.sin(2 * np.pi * f0 * h * t) / h for h in range(1, 28)) + sum(np.sin(2 * np.pi * f0 * 1.006 * h * t) / h for h in range(1, 20)) * 0.6
cut = 220 + 2400 * np.exp(-t * 9); b = np.zeros_like(saw); y = 0.0
a = 1 - np.exp(-2 * np.pi * cut / SR)
for i in range(len(saw)): y += a[i] * (saw[i] - y); b[i] = y
b = lp(b, 3000) * env_exp(t, 4.5, 0.003)
write('10-bass-stab', sat(b * 0.9, 2.2))
# 11 Chord Am9 (A2 E3 G3 B3 C4) electric-piano style FM
t = t_(1.5); chord = np.zeros((len(t), 2))
for j, (m, pan) in enumerate([(45, -0.5), (52, -0.2), (55, 0.1), (59, 0.35), (60, 0.55)]):
    f = 440 * 2 ** ((m - 69) / 12); mod = 2.6 * env_exp(t, 5.5)
    v = np.sin(2 * np.pi * f * t + mod * np.sin(2 * np.pi * f * t)) * env_exp(t, 2.2, 0.004) + 0.25 * np.sin(2 * np.pi * f * 4 * t) * env_exp(t, 14)
    chord[:, 0] += v * (1 - max(0, pan)); chord[:, 1] += v * (1 + min(0, pan))
write('11-chord-am9', sat(chord * 0.28, 1.3))
# 12 Pluck (Karplus-Strong A3)
n = int(SR * 1.3); f = 220.0; N = int(SR / f); buf = noise(N) * 0.9; out = np.zeros(n)
for i in range(n):
    out[i] = buf[i % N]; buf[i % N] = 0.4975 * (buf[i % N] + buf[(i + 1) % N])
write('12-pluck', stereo(lp(out, 7000) * np.exp(-t_(1.3) * 1.2), 0.15, 12))
# 13 Bell (E5 FM)
t = t_(2.4); f = 659.25
bell = sum(a * np.sin(2 * np.pi * f * r * t + 1.4 * np.sin(2 * np.pi * f * 1.4 * t) * env_exp(t, 3)) * env_exp(t, d) for r, a, d in [(1, 1, 1.5), (2.76, 0.5, 2.6), (5.4, 0.28, 4.2), (8.93, 0.14, 6.5)])
write('13-bell', stereo(bell * 0.4, 0.3, 13))
# 14 Vox "ooh" (A3 with vibrato and formants)
t = t_(1.5); f0 = 220 * (1 + 0.012 * np.sin(2 * np.pi * 5.4 * t) * np.minimum(1, t * 3))
ph = 2 * np.pi * np.cumsum(f0) / SR
src = sum(np.sin(h * ph) / h ** 0.9 for h in range(1, 40))
formants = [(330, 0.9, 70), (800, 0.55, 90), (2500, 0.25, 140)]
v = sum(bp(src, fc - bw, fc + bw, 2) * g for fc, g, bw in formants)
v = (v + 0.25 * lp(src, 300)) * np.minimum(1, t / 0.12) * np.minimum(1, (1.5 - t) / 0.35)
v += 0.025 * hp(noise(len(t)), 4000) * np.minimum(1, t / 0.12) * np.minimum(1, (1.5 - t) / 0.3)
write('14-vox-ooh', stereo(v, 0.35, 14))
# 15 Riser (noise sweep + rising tone)
t = t_(2.6); sw = 300 * (24 ** (t / 2.6)); y = np.zeros(len(t)); a = 1 - np.exp(-2 * np.pi * np.minimum(sw, 18000) / SR); z = 0.0; nz = noise(len(t))
for i in range(len(t)): z += a[i] * (nz[i] - z); y[i] = z
ton = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (t / 2.6 * 2)) / SR) * 0.25
rs = (y * 2.4 + ton) * (t / 2.6) ** 1.6 * np.minimum(1, (2.6 - t) / 0.06)
write('15-riser', stereo(rs, 0.4, 15))
# 16 Impact (boom + noise burst, long tail)
t = t_(2.6); boom = np.sin(sweep_phase(95, 34, 0.12, t)) * env_exp(t, 1.9, 0.002)
burst = lp(noise(len(t)), 6000) * env_exp(t, 9) * 0.5 + hp(noise(len(t)), 2500) * env_exp(t, 4) * 0.12
imp = sat(boom * 1.2 + burst, 1.6); imp = room(imp, 0.9, 0.45, 0.15)
write('16-impact', stereo(imp, 0.25, 16))
