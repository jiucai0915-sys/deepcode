"""生成逐句旁白：TTS → 去首尾静音 → 压缩句内长停顿 → 统一变速以适配 20 秒。
输出: assets/audio/narration_XX.wav, assets/audio/timeline.json, output/subtitles.srt
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import config as C  # noqa: E402

SR = 48000
RAW_DIR = C.AUDIO_DIR / "raw"


def run(cmd, **kw):
    subprocess.run(cmd, check=True, **kw)


def synth_raw(text, engine):
    """Return path to a cached raw TTS file for `text`."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{engine}|{text}".encode()).hexdigest()[:12]
    ext = "mp3" if engine == "gtts" else "wav"
    path = RAW_DIR / f"{engine}_{key}.{ext}"
    if path.exists() and path.stat().st_size > 1000:
        return path
    if engine == "gtts":
        from gtts import gTTS
        gTTS(text, lang="zh-CN").save(str(path))
    else:
        piper = shutil.which("piper") or os.path.expanduser("~/.local/bin/piper")
        run([piper, "-m", C.PIPER_MODEL, "-f", str(path)], input=text.encode(),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return path


def decode(path, tempo=1.0):
    af = [f"atempo={tempo:.4f}"] if abs(tempo - 1) > 1e-3 else []
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR)]
    if af:
        cmd += ["-af", ",".join(af)]
    cmd += ["-f", "f32le", "-"]
    out = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def tighten(x, keep=C.PAUSE_KEEP, thresh_db=-42.0, min_run=0.22):
    """Trim head/tail silence and shorten internal pauses longer than min_run."""
    win = int(SR * 0.01)
    n = len(x) // win
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    peak = np.max(rms)
    loud = 20 * np.log10(rms / peak) > thresh_db
    idx = np.where(loud)[0]
    if len(idx) == 0:
        return x
    first, last = max(idx[0] - 2, 0), min(idx[-1] + 4, n)
    segs, i = [], first
    keep_w, min_w = int(keep * 100), int(min_run * 100)
    while i < last:
        j = i
        if not loud[i]:
            while j < last and not loud[j]:
                j += 1
            run_len = j - i
            if run_len > min_w:
                segs.append((i, i + keep_w // 2))
                segs.append((j - keep_w // 2, j))
            else:
                segs.append((i, j))
        else:
            while j < last and loud[j]:
                j += 1
            segs.append((i, j))
        i = j
    fade = int(SR * 0.004)
    parts = []
    for a, b in segs:
        seg = x[a * win: b * win].copy()
        if len(seg) > 2 * fade:
            seg[:fade] *= np.linspace(0, 1, fade)
            seg[-fade:] *= np.linspace(1, 0, fade)
        parts.append(seg)
    return np.concatenate(parts)


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    pcm = (x * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    engine = os.environ.get("TTS_ENGINE", C.TTS_ENGINE)
    try:
        raws = [synth_raw(ln["text"], engine) for ln in C.NARRATION]
    except Exception as e:
        if engine != "gtts":
            raise
        print(f"[tts] gTTS failed ({e}); falling back to piper", file=sys.stderr)
        engine = "piper"
        raws = [synth_raw(ln["text"], engine) for ln in C.NARRATION]
    finish(engine, raws)


def finish(engine, raws):
    lines = C.NARRATION
    tight = [tighten(decode(p)) for p in raws]
    raw_total = sum(len(t) for t in tight) / SR
    gaps = C.GAP * (len(lines) - 1)
    avail = C.NARRATION_END - C.NARRATION_START_PREF - gaps
    tempo = max(1.0, raw_total / avail)
    start = C.NARRATION_START_PREF
    if tempo > 1.18:
        tempo = min(C.MAX_TEMPO, raw_total / (C.NARRATION_END - C.NARRATION_START_MIN - gaps))
        tempo = max(tempo, 1.18)
    print(f"[tts] engine={engine} raw_total={raw_total:.2f}s tempo={tempo:.3f}")

    clips = []
    for i, p in enumerate(raws):
        tmp = C.AUDIO_DIR / f"_tight_{i}.wav"
        write_wav(tmp, tight[i])
        y = decode(tmp, tempo)
        tmp.unlink()
        y = y / (np.max(np.abs(y)) + 1e-9) * 0.89
        clips.append(y)
    total = sum(len(c) for c in clips) / SR + gaps
    start = max(C.NARRATION_START_MIN, min(C.NARRATION_START_PREF, C.NARRATION_END - total))

    timeline, t = [], start
    for i, (ln, y) in enumerate(zip(lines, clips)):
        path = C.AUDIO_DIR / f"narration_{i + 1:02d}.wav"
        write_wav(path, y)
        d = len(y) / SR
        timeline.append({"index": i + 1, "text": ln["text"], "subtitle": ln["subtitle"],
                         "file": path.name, "start": round(t, 3), "end": round(t + d, 3),
                         "duration": round(d, 3)})
        t += d + C.GAP
    if timeline[-1]["end"] > C.NARRATION_END + 0.05:
        print(f"[tts] WARNING: narration ends at {timeline[-1]['end']:.2f}s", file=sys.stderr)

    for k, ln in enumerate(timeline):
        nxt = timeline[k + 1]["start"] - 0.05 if k + 1 < len(timeline) else C.DURATION - 0.3
        ln["sub_start"] = round(max(0.0, ln["start"] - 0.05), 3)
        ln["sub_end"] = round(min(ln["end"] + 0.25, nxt), 3)

    meta = {"engine": engine, "tempo": round(tempo, 4), "lines": timeline}
    (C.AUDIO_DIR / "timeline.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))

    C.OUTPUT.mkdir(parents=True, exist_ok=True)
    srt = []
    for k, ln in enumerate(timeline):
        srt.append(f"{k + 1}\n{srt_time(ln['sub_start'])} --> {srt_time(ln['sub_end'])}\n"
                   f"{ln['subtitle']}\n")
    (C.OUTPUT / "subtitles.srt").write_text("\n".join(srt), encoding="utf-8")
    for ln in timeline:
        print(f"  {ln['start']:6.2f} - {ln['end']:6.2f}  {ln['subtitle']}")


if __name__ == "__main__":
    main()
