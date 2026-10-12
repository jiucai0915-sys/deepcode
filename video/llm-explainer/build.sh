#!/usr/bin/env bash
# 一键重建：旁白 → 背景音乐 → 混音 → 渲染视频 → 导出预览静帧
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"

python3 src/tts.py          # assets/audio/narration_*.wav, timeline.json, output/subtitles.srt
python3 src/music.py        # assets/audio/music.wav
python3 src/mix.py          # assets/audio/mix.wav
python3 src/render.py       # output/llm_explainer_20s.mp4

mkdir -p output/stills
for t in 1 5 9 13 17 19.5; do
  ffmpeg -v error -y -ss "$t" -i output/llm_explainer_20s.mp4 -frames:v 1 "output/stills/t_${t}s.png"
done

ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of compact output/llm_explainer_20s.mp4
ffmpeg -hide_banner -i output/llm_explainer_20s.mp4 -af volumedetect -vn -f null - 2>&1 | grep -E "mean_volume|max_volume"
