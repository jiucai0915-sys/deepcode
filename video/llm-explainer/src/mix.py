"""把逐句旁白按 timeline.json 摆放，与背景音乐混合（人声期间自动闪避 ducking）。
输出: assets/audio/mix.wav （48 kHz 立体声）
"""
import json
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import config as C  # noqa: E402

SR = 48000


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        ch, n = w.getnchannels(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float64) / 32768
    return x.reshape(-1, ch)


def db(x):
    return 10 ** (x / 20)


def smooth(env, attack, release):
    """Asymmetric one-pole smoothing, run on a 1 kHz control rate for speed."""
    step = SR // 1000
    ctrl = env[::step]
    out = np.empty_like(ctrl)
    a_att = np.exp(-1 / (attack * 1000))
    a_rel = np.exp(-1 / (release * 1000))
    acc = ctrl[0]
    for i, v in enumerate(ctrl):
        a = a_att if v < acc else a_rel
        acc = a * acc + (1 - a) * v
        out[i] = acc
    return np.repeat(out, step)[: len(env)]


def main():
    meta = json.loads((C.AUDIO_DIR / "timeline.json").read_text())
    n = int(SR * C.DURATION)
    voice = np.zeros(n)
    active = np.zeros(n)
    for ln in meta["lines"]:
        clip = read_wav(C.AUDIO_DIR / ln["file"])[:, 0]
        a = int(round(ln["start"] * SR))
        b = min(a + len(clip), n)
        voice[a:b] += clip[: b - a]
        active[max(0, a - int(0.12 * SR)): b + int(0.1 * SR)] = 1.0

    music = read_wav(C.AUDIO_DIR / "music.wav")[:n]
    if len(music) < n:
        music = np.pad(music, ((0, n - len(music)), (0, 0)))

    voice_rms = np.sqrt(np.mean(voice[active > 0] ** 2))
    music_rms = np.sqrt(np.mean(music[SR:-SR] ** 2))
    under = db(C.MUSIC_UNDER_VOICE_DB) * voice_rms / music_rms
    free = db(C.MUSIC_FREE_DB) * voice_rms / music_rms
    gain = smooth(free + (under - free) * active, attack=0.12, release=0.45)
    mix = music * gain[:, None] + voice[:, None]

    peak = np.max(np.abs(mix))
    mix *= db(C.MIX_PEAK_DB) / peak
    out = C.AUDIO_DIR / "mix.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
    print(f"[mix] wrote {out}  (music under voice {C.MUSIC_UNDER_VOICE_DB} dB, "
          f"free {C.MUSIC_FREE_DB} dB rel. voice RMS)")


if __name__ == "__main__":
    main()
