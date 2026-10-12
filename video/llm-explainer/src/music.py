"""用 numpy 合成 20 秒轻柔的氛围背景音乐（pad 和弦 + 轻琶音 + 低频脉冲 + 简易混响）。
输出: assets/audio/music.wav （48 kHz 立体声）
"""
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import config as C  # noqa: E402

SR = 48000
DUR = C.DURATION
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# D 大调：Dmaj9 → Bm9 → Gmaj7(#11) → A6sus，每个和弦 5 秒
CHORDS = [
    [50, 57, 62, 66, 69, 76],
    [47, 54, 62, 66, 69, 73],
    [43, 54, 59, 62, 66, 73],
    [45, 52, 59, 62, 64, 71],
]
CHORD_LEN = DUR / len(CHORDS)


def fft_lowpass(x, fc, order=2):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / fc) ** (2 * order)), len(x))


def soft_saw(f, phase_t, n_harm=8):
    out = np.zeros_like(phase_t)
    for k in range(1, n_harm + 1):
        out += np.sin(2 * np.pi * f * k * phase_t) / (k ** 1.6)
    return out


def chord_env(i):
    start, end = i * CHORD_LEN, (i + 1) * CHORD_LEN
    att, rel = 1.2, 1.6
    e = np.clip((t - start + 0.4) / att, 0, 1) * np.clip((end + rel - t) / rel, 0, 1)
    return np.sin(e * np.pi / 2) ** 2


def pad():
    L = np.zeros(N)
    R = np.zeros(N)
    for i, ch in enumerate(CHORDS):
        env = chord_env(i)
        active = env > 0
        tt = t[active]
        for j, m in enumerate(ch):
            f = midi(m + 12 if j == 0 else m)
            amp = 0.5 if j == 0 else 0.32
            vib = 0.0015 * np.sin(2 * np.pi * (0.13 + 0.03 * j) * tt)
            L[active] += amp * soft_saw(f * (1 - 0.0018 + vib), tt, 6) * env[active]
            R[active] += amp * soft_saw(f * (1 + 0.0018 - vib), tt, 6) * env[active]
    # slow filter swell
    breath = 0.75 + 0.25 * np.sin(2 * np.pi * t / 10 - np.pi / 2)
    return fft_lowpass(L, 1800) * breath, fft_lowpass(R, 1800) * breath


def bass():
    out = np.zeros(N)
    beat = 60.0 / C.MUSIC_BPM
    for i, ch in enumerate(CHORDS):
        f = midi(ch[0] - 12)
        env = chord_env(i)
        out += np.sin(2 * np.pi * f * t) * env * 0.55
    # gentle quarter-note pulse on the bass
    ph = (t % beat) / beat
    pulse = 0.55 + 0.45 * np.exp(-ph * 5)
    return out * pulse


def arp():
    L = np.zeros(N)
    R = np.zeros(N)
    step = 60.0 / C.MUSIC_BPM / 2
    pattern = [0, 2, 3, 4, 5, 4, 3, 2]
    n_steps = int(DUR / step)
    for s in range(n_steps):
        st = s * step
        ci = min(int(st / CHORD_LEN), len(CHORDS) - 1)
        note = CHORDS[ci][pattern[s % len(pattern)]] + 12
        f = midi(note)
        seg_len = int(SR * 1.4)
        a = int(st * SR)
        b = min(a + seg_len, N)
        tt = np.arange(b - a) / SR
        env = (1 - np.exp(-tt * 200)) * np.exp(-tt * 3.2) * np.clip((tt[-1] - tt) / 0.2, 0, 1)
        tone = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt)) * env
        vel = 0.6 + 0.4 * (s % 4 == 0)
        pan = 0.5 + 0.35 * np.sin(s * 0.9)
        L[a:b] += tone * vel * (1 - pan)
        R[a:b] += tone * vel * pan
    return L, R


def reverb(x, seconds=2.4, mix=0.35, seed=0):
    n = int(SR * seconds)
    r = np.random.default_rng(seed)
    ir = r.standard_normal(n) * np.exp(-np.arange(n) / SR * 3.2)
    ir[: int(SR * 0.012)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    m = len(x) + n
    nfft = 1 << (m - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]
    return (1 - mix) * x + mix * wet * 1.8


def shimmer():
    """Soft airy noise swell under the title."""
    nz = rng.standard_normal(N)
    nz = np.diff(np.concatenate([[0], nz]))  # tilt to highs
    env = np.clip(t / 0.8, 0, 1) * np.clip((2.6 - t) / 1.4, 0, 1)
    return nz * env * 0.025


def main():
    pL, pR = pad()
    aL, aR = arp()
    b = bass()
    sh = shimmer()
    L = 0.55 * pL + 0.30 * aL + 0.45 * b + sh
    R = 0.55 * pR + 0.30 * aR + 0.45 * b + np.roll(sh, 240)
    L = reverb(L, seed=1)
    R = reverb(R, seed=2)
    fade_in = np.clip(t / 1.2, 0, 1) ** 2
    fade_out = np.clip((DUR - t) / 1.6, 0, 1) ** 1.5
    L *= fade_in * fade_out
    R *= fade_in * fade_out
    st = np.stack([L, R], axis=1)
    st = st / np.max(np.abs(st)) * 0.7
    C.AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    out = C.AUDIO_DIR / "music.wav"
    pcm = (np.clip(st, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"[music] wrote {out}")


if __name__ == "__main__":
    main()
