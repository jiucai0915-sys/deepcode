"""主渲染脚本：用 skia 逐帧绘制 1920x1080 动画，直接以管道送入 ffmpeg 编码。

用法:
  python3 src/render.py                 # 渲染完整视频 → output/llm_explainer_20s.mp4
  python3 src/render.py --still 9.5     # 只渲染某一时刻的静帧（快速预览）
  python3 src/render.py --no-audio      # 不混入音频

文字/颜色/时间参数请改 src/config.py；画面时间轴锚定在 assets/audio/timeline.json（由 tts.py 生成）。
"""
import argparse
import json
import math
import os
import subprocess
import sys
from multiprocessing import Pool

import numpy as np
import skia

sys.path.insert(0, os.path.dirname(__file__))
import config as C  # noqa: E402

W, H, FPS = C.W, C.H, C.FPS
COL = C.COLORS

# ============================================================== 时间轴 TIMELINE
TL = json.loads((C.AUDIO_DIR / "timeline.json").read_text())
LINES = TL["lines"]


def _anchor(name):
    i, f = C.ANCHORS[name]
    ln = LINES[i]
    return ln["start"] + f * ln["duration"]


A = {k: _anchor(k) for k in C.ANCHORS}
T_TITLE_MORPH = (A["question_in"] - 0.35, A["question_in"] + 0.55)
T_CAUTION = A["caution_in"]
T_END = C.DURATION

# 逐字生成时间表：每个回答 token 的“落位”时刻
N_ANS = len(C.ANSWER_TOKENS)
GEN_T = [0.0] * N_ANS
for k in range(C.PROB_AT):
    GEN_T[k] = A["generate_in"] + 0.05 + k * C.FIRST_STREAM_STEP
T_PROB_IN = GEN_T[C.PROB_AT - 1] + 0.08
T_PROB_SEL = max(T_PROB_IN + 0.85, A["fast_stream"])
GEN_T[C.PROB_AT] = T_PROB_SEL + 0.38
_rest = N_ANS - C.PROB_AT - 1
_rest_end = LINES[3]["end"] - C.FAST_STREAM_END_PAD
_step = (_rest_end - GEN_T[C.PROB_AT]) / max(_rest, 1)
for j in range(_rest):
    GEN_T[C.PROB_AT + 1 + j] = GEN_T[C.PROB_AT] + (j + 1) * _step
FLIGHT = 0.32
STEP_TIMES = [A["question_in"], A["token_split"], A["ids_in"], A["model_in"], A["generate_in"]]

# ============================================================== 布局 LAYOUT
Q_Y = 470            # 提问文字中线
Q_FONT = 76
CHIP_PAD = 26
CHIP_H = 104
ROW_Y_IDS = 420      # 进入“数字”阶段后 token 行上移到这里
MODEL = skia.Rect.MakeLTRB(110, 228, 1075, 902)
COL_X = [178 + i * 167.5 for i in range(6)]
ROW_Y = [785, 690, 597, 504]           # 0: 输入向量；1-3: 网络层
OUT_NODE = (COL_X[5], 405)
CHIP_Y_MODEL, CHIP_S_MODEL = 860, 0.5
VEC_S_MODEL = 0.85
ANS_ORIGIN = (1135, 228)
ANS_SIZE = (675, 302)
PROB_ORIGIN = (1135, 566)
PROB_SIZE = (675, 336)
SUB_Y = 990
TOKEN_COLORS = [COL["cyan"], COL["violet"], COL["amber"], COL["pink"], COL["cyan"], COL["violet"]]


# ============================================================== 工具函数 HELPERS
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, u):
    return a + (b - a) * u


def ease_io(u):
    u = clamp(u)
    return 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2


def ease_out(u):
    u = clamp(u)
    return 1 - (1 - u) ** 3


def ease_in(u):
    u = clamp(u)
    return u ** 3


def ease_back(u, s=1.6):
    u = clamp(u)
    return 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2


def prog(t, a, b):
    return clamp((t - a) / (b - a)) if b > a else float(t >= a)


def window(t, a, b, fi=0.25, fo=0.25):
    return ease_io(prog(t, a - fi, a)) * (1 - ease_io(prog(t, b, b + fo)))


_FONTS = {}


def font(size, bold=True):
    key = (round(size, 2), bold)
    if key not in _FONTS:
        tf = _TYPEFACES[bold]
        f = skia.Font(tf, size)
        f.setEdging(skia.Font.Edging.kAntiAlias)
        f.setSubpixel(True)
        f.setHinting(skia.FontHinting.kNone)
        _FONTS[key] = f
    return _FONTS[key]


_TYPEFACES = {}


def paint(rgb, a=1.0, stroke=0.0, blur=0.0, shader=None):
    p = skia.Paint(AntiAlias=True)
    p.setColor(skia.Color(int(rgb[0]), int(rgb[1]), int(rgb[2]), int(clamp(a) * 255)))
    if stroke:
        p.setStyle(skia.Paint.kStroke_Style)
        p.setStrokeWidth(stroke)
        p.setStrokeCap(skia.Paint.kRound_Cap)
    if blur > 0:
        p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, blur))
    if shader is not None:
        p.setShader(shader)
        p.setAlphaf(clamp(a))
    return p


def tw(s, size, bold=True):
    return font(size, bold).measureText(s)


def text(c, s, x, y, size, rgb, a=1.0, bold=True, align="left", glow=0.0, glow_rgb=None,
         glow_a=0.7, shader=None):
    """Draw text with baseline y. Returns width."""
    if a <= 0.003:
        return tw(s, size, bold)
    f = font(size, bold)
    w = f.measureText(s)
    if align == "center":
        x -= w / 2
    elif align == "right":
        x -= w
    if glow > 0:
        c.drawString(s, x, y, f, paint(glow_rgb or rgb, a * glow_a, blur=glow))
    c.drawString(s, x, y, f, paint(rgb, a, shader=shader))
    return w


def base_y(cy, size):
    """Baseline that vertically centres CJK text of `size` on `cy`."""
    return cy + size * 0.36


def rrect(c, x0, y0, x1, y1, r, fill=None, fill_a=1.0, stroke=None, stroke_a=1.0, sw=2.0,
          glow=0.0, glow_a=0.5):
    rect = skia.RRect.MakeRectXY(skia.Rect.MakeLTRB(x0, y0, x1, y1), r, r)
    if glow > 0 and (stroke or fill):
        c.drawRRect(rect, paint(stroke or fill, glow_a, stroke=sw * 2, blur=glow))
    if fill is not None:
        c.drawRRect(rect, paint(fill, fill_a))
    if stroke is not None:
        c.drawRRect(rect, paint(stroke, stroke_a, stroke=sw))


def circle(c, x, y, r, rgb, a=1.0, blur=0.0, stroke=0.0):
    if a > 0.003:
        c.drawCircle(x, y, r, paint(rgb, a, stroke=stroke, blur=blur))


def mix_rgb(a, b, u):
    return tuple(lerp(a[i], b[i], u) for i in range(3))


def lin_grad(x0, y0, x1, y1, cols):
    return skia.GradientShader.MakeLinear(
        [skia.Point(x0, y0), skia.Point(x1, y1)],
        [skia.Color(int(r), int(g), int(b), 255) for r, g, b in cols])


def bezier(p0, p1, p2, u):
    return ((1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u ** 2 * p2[0],
            (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u ** 2 * p2[1])


# ============================================================== 静态资源 STATIC
class Static:
    pass


S = Static()


def init_static():
    if getattr(S, "ready", False):
        return
    _TYPEFACES[True] = skia.Typeface.MakeFromFile(str(C.FONT_BOLD))
    _TYPEFACES[False] = skia.Typeface.MakeFromFile(str(C.FONT_REGULAR))

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    v = (yy / H)[..., None]
    top = np.array(COL["bg_top"], np.float32)
    bot = np.array(COL["bg_bottom"], np.float32)
    img = top * (1 - v) + bot * v
    for (cx, cy, rad, rgb, k) in [(1450, 260, 900, COL["bg_glow"], 0.55),
                                  (300, 950, 800, (16, 60, 90), 0.45)]:
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / rad
        g = np.clip(1 - d, 0, 1) ** 2 * k
        img = img * (1 - g[..., None]) + np.array(rgb, np.float32) * g[..., None]
    rgba = np.dstack([np.clip(img, 0, 255).astype(np.uint8), np.full((H, W), 255, np.uint8)])
    S.bg = skia.Image.fromarray(np.ascontiguousarray(rgba), colorType=skia.kRGBA_8888_ColorType)

    d = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H / 2) / (H * 0.66)) ** 2)
    va = (np.clip(d - 0.55, 0, 1) ** 1.6 * 200).astype(np.uint8)
    vig = np.zeros((H, W, 4), np.uint8)
    vig[..., 3] = va
    S.vignette = skia.Image.fromarray(vig, colorType=skia.kRGBA_8888_ColorType,
                                      alphaType=skia.kUnpremul_AlphaType)

    gs = 56
    grid = np.zeros((H + gs, W + gs, 4), np.uint8)
    for gy in range(gs // 2, H + gs, gs):
        for gx in range(gs // 2, W + gs, gs):
            grid[gy - 1:gy + 1, gx - 1:gx + 1] = (120, 150, 230, 34)
    S.grid = skia.Image.fromarray(grid, colorType=skia.kRGBA_8888_ColorType,
                                  alphaType=skia.kUnpremul_AlphaType)
    S.grid_step = gs

    rng = np.random.default_rng(3)
    S.grain = [rng.integers(-3, 4, size=(H, W, 1), dtype=np.int16) for _ in range(6)]

    n = 80
    S.particles = dict(x=rng.uniform(0, W, n), y=rng.uniform(0, H, n),
                       vx=rng.uniform(-14, 14, n), vy=rng.uniform(-22, -4, n),
                       r=rng.uniform(1.2, 4.5, n), ph=rng.uniform(0, 6.28, n),
                       c=rng.integers(0, 3, n))

    # token geometry
    f = font(Q_FONT)
    widths = [f.measureText(s) for s in C.QUESTION_TOKENS]
    total = sum(widths)
    x = W / 2 - total / 2
    S.contig_left, S.contig_cx = [], []
    for w in widths:
        S.contig_left.append(x)
        S.contig_cx.append(x + w / 2)
        x += w
    S.tok_w = widths
    S.contig_x0, S.contig_x1 = W / 2 - total / 2, W / 2 + total / 2
    chip_w = [w + 2 * CHIP_PAD for w in widths]
    gap = 34
    tot = sum(chip_w) + gap * (len(chip_w) - 1)
    x = W / 2 - tot / 2
    S.split_cx = []
    for cw in chip_w:
        S.split_cx.append(x + cw / 2)
        x += cw + gap
    S.chip_w = chip_w
    S.char_w = [[f.measureText(ch) for ch in s] for s in C.QUESTION_TOKENS]
    S.char_edges = [0.0]
    for ws in S.char_w:
        for cw_ in ws:
            S.char_edges.append(S.char_edges[-1] + cw_)

    rng2 = np.random.default_rng(11)
    S.vec = rng2.uniform(-1, 1, size=(6, 8))

    # attention weights for edges (row r -> r+1), causal: j <= i
    S.att = []
    for r in range(3):
        m = np.zeros((6, 6))
        for i in range(6):
            logits = rng2.normal(0, 0.8, i + 1)
            logits[i] += 0.9
            if i == 5:
                logits[0] += 2.2   # 天空
                logits[3] += 2.6   # 蓝色
                logits[1] += 0.8   # 为什么
            e = np.exp(logits - logits.max())
            m[i, :i + 1] = e / e.sum()
        S.att.append(m)
    S.edges = []
    for r in range(3):
        y0 = ROW_Y[r] - (26 if r == 0 else 12)
        y1 = ROW_Y[r + 1] + 12
        for i in range(6):
            for j in range(i + 1):
                p = skia.Path()
                p.moveTo(COL_X[j], y0)
                p.cubicTo(COL_X[j], y0 - 42, COL_X[i], y1 + 42, COL_X[i], y1)
                pm = skia.PathMeasure(p, False)
                S.edges.append(dict(r=r, i=i, j=j, w=float(S.att[r][i, j]), path=p,
                                    pm=pm, L=pm.getLength(), ph=float(rng2.uniform(0, 1))))

    # "training data" cloud on the right that streams into the network
    S.snips = []
    n = len(C.DATA_SNIPPETS)
    cols_, rows_ = 4, int(math.ceil(n / 4))
    l0 = A["model_in"] + 1.25
    l1 = A["attention_in"] - 0.55
    order = rng2.permutation(n)
    for k, s in enumerate(C.DATA_SNIPPETS):
        r_, c_ = divmod(k, cols_)
        cx = 1215 + (c_ + 0.5) * (560 / cols_) + rng2.uniform(-28, 28) + (r_ % 2) * 36
        cy = 330 + r_ * (500 / max(rows_ - 1, 1)) + rng2.uniform(-14, 14)
        S.snips.append(dict(s=s, cx=cx, cy=cy, t_in=A["model_in"] + 0.75 + 0.02 * k,
                            t_l=l0 + (l1 - l0) * order[k] / max(n - 1, 1), dur=0.55,
                            tr=int(rng2.integers(1, 4)), tc=int(rng2.integers(0, 6)),
                            size=float(rng2.uniform(21, 26)), ph=float(rng2.uniform(0, 6.28))))

    # answer layout (local panel coords)
    fs = 44
    x, y = 36, 140
    maxx = ANS_SIZE[0] - 36
    S.ans_pos = []
    for s in C.ANSWER_TOKENS:
        w = tw(s, fs)
        punct = s in "，。、！？；：" and len(s) == 1
        if x + w > maxx and not punct:
            x = 36
            y += 64
        S.ans_pos.append((x, y, w))
        x += w
    S.ans_fs = fs
    S.ready = True
    check_glyphs()


def check_glyphs():
    strings = [C.TITLE, C.TITLE_SUB, C.QUESTION, C.CAUTION_EMPH, C.CAUTION_REST, C.END_TAG,
               *C.STEPS, *C.ANSWER_TOKENS, *[c for c, _ in C.CANDIDATES], *C.LABELS.values(),
               *C.DATA_SNIPPETS, *[ln["subtitle"] for ln in LINES], "0123456789%…问：上文＿"]
    missing = set()
    for bold in (True, False):
        f = font(30, bold)
        for s in strings:
            for ch, g in zip(s, f.textToGlyphs(s)):
                if g == 0 and not ch.isspace():
                    missing.add(ch)
    if missing:
        print(f"[render] WARNING missing glyphs: {''.join(sorted(missing))}", file=sys.stderr)


# ============================================================== 场景 SCENES
def draw_background(c, t):
    c.drawImage(S.bg, 0, 0)
    gs = S.grid_step
    c.drawImage(S.grid, -(t * 6) % gs - gs / 2, -(t * 3) % gs - gs / 2)
    # slow drifting nebula blobs
    for (cx, cy, r, rgb, a, sp) in [(1500, 300, 520, COL["violet"], 0.10, 0.11),
                                    (420, 780, 480, COL["cyan"], 0.07, 0.08)]:
        x = cx + 60 * math.sin(t * sp * 2 * math.pi / 3)
        y = cy + 40 * math.cos(t * sp * 2 * math.pi / 4)
        sh = skia.GradientShader.MakeRadial(
            skia.Point(x, y), r,
            [skia.Color(*rgb, int(255 * a)), skia.Color(*rgb, 0)])
        p = skia.Paint(AntiAlias=True)
        p.setShader(sh)
        c.drawCircle(x, y, r, p)
    P = S.particles
    cols = [COL["cyan"], COL["violet"], COL["amber"]]
    for k in range(len(P["x"])):
        x = (P["x"][k] + P["vx"][k] * t) % (W + 40) - 20
        y = (P["y"][k] + P["vy"][k] * t) % (H + 40) - 20
        tw_ = 0.5 + 0.5 * math.sin(t * 1.3 + P["ph"][k])
        r = P["r"][k]
        circle(c, x, y, r * 2.2, cols[P["c"][k]], 0.10 + 0.12 * tw_, blur=r * 1.6)
        circle(c, x, y, r * 0.55, (220, 235, 255), 0.25 + 0.35 * tw_)


def draw_title(c, t):
    m = ease_io(prog(t, *T_TITLE_MORPH))
    big, small = 92, 30
    f = font(big)
    w = f.measureText(C.TITLE)
    x0, y0 = W / 2 - w / 2, 505
    x1, y1 = 96, 86
    sc = lerp(1, small / big, m)
    tx, ty = lerp(x0, x1, m), lerp(y0, y1, m)
    fade_end = 1 - ease_io(prog(t, T_END - C.FADE_OUT - 0.2, T_END))

    # orbit flourish behind the title card
    fl = (1 - m) * ease_out(prog(t, 0.0, 0.9))
    if fl > 0.01:
        for k, (rad, a, sp) in enumerate([(330, 0.10, 0.25), (430, 0.07, -0.18), (540, 0.05, 0.12)]):
            circle(c, W / 2, 520, rad * lerp(0.85, 1, fl), COL["violet"] if k % 2 else COL["cyan"],
                   a * fl, stroke=1.4)
            for q in range(3):
                ang = t * sp * 2 * math.pi + q * 2.09 + k
                px, py = W / 2 + rad * math.cos(ang), 520 + rad * 0.98 * math.sin(ang)
                circle(c, px, py, 9, COL["cyan"], 0.35 * fl, blur=8)
                circle(c, px, py, 3, (230, 250, 255), 0.9 * fl)

    c.save()
    c.translate(tx, ty)
    c.scale(sc, sc)
    shader = lin_grad(0, -big, w, 0, [COL["text"], (190, 240, 255), COL["cyan"]])
    xx = 0.0
    for k, ch in enumerate(C.TITLE):
        u = ease_out(prog(t, 0.15 + k * 0.035, 0.75 + k * 0.035))
        cw = f.measureText(ch)
        if u > 0:
            dy = (1 - u) * 28
            glow = lerp(18, 6, m)
            c.drawString(ch, xx, dy, f, paint(COL["cyan"], 0.45 * u * fade_end, blur=glow))
            c.drawString(ch, xx, dy, f, paint(COL["text"], u * fade_end, shader=shader))
        xx += cw
    c.restore()

    a_sub = ease_out(prog(t, 0.7, 1.3)) * (1 - ease_io(prog(m, 0, 0.5)))
    if a_sub > 0:
        lw = w * ease_io(prog(t, 0.55, 1.35))
        c.drawRect(skia.Rect.MakeLTRB(W / 2 - lw / 2, 548, W / 2 + lw / 2, 551),
                   paint(COL["cyan"], 0.85 * a_sub, shader=lin_grad(
                       W / 2 - lw / 2, 0, W / 2 + lw / 2, 0,
                       [COL["violet"], COL["cyan"], COL["amber"]])))
        c.drawRect(skia.Rect.MakeLTRB(W / 2 - lw / 2, 546, W / 2 + lw / 2, 553),
                   paint(COL["cyan"], 0.5 * a_sub, blur=8))
        text(c, C.TITLE_SUB, W / 2, 618, 36, COL["muted"], a_sub, bold=False, align="center")
    if m > 0.6:
        circle(c, 78, 76, 5, COL["cyan"], (m - 0.6) / 0.4 * fade_end, blur=0)
        circle(c, 78, 76, 10, COL["cyan"], 0.5 * (m - 0.6) / 0.4 * fade_end, blur=6)


def draw_steps(c, t):
    a = ease_io(prog(t, A["question_in"] - 0.2, A["question_in"] + 0.5))
    a *= 1 - ease_io(prog(t, T_END - C.FADE_OUT - 0.2, T_END))
    if a <= 0:
        return
    done_all = ease_io(prog(t, T_CAUTION, T_CAUTION + 0.6))
    size = 24
    pad = 18
    sep = 30
    widths = [tw(s, size) + 2 * pad for s in C.STEPS]
    total = sum(widths) + sep * (len(widths) - 1)
    x = W - 96 - total
    cy = 74
    xs = []
    for w in widths:
        xs.append(x)
        x += w + sep
    # smoothly sliding highlight
    pos = 0.0
    for k, st in enumerate(STEP_TIMES):
        pos = k * 1.0 if k == 0 else lerp(pos, k, ease_io(prog(t, st - 0.15, st + 0.3)))
    k0 = int(math.floor(pos))
    k1 = min(k0 + 1, len(xs) - 1)
    u = pos - k0
    hx0 = lerp(xs[k0], xs[k1], u)
    hw = lerp(widths[k0], widths[k1], u)
    ha = a * (1 - done_all)
    rrect(c, hx0, cy - 22, hx0 + hw, cy + 22, 22, fill=COL["cyan"], fill_a=0.16 * ha,
          stroke=COL["cyan"], stroke_a=0.85 * ha, sw=1.6, glow=10, glow_a=0.35 * ha)
    for k, s in enumerate(C.STEPS):
        d = clamp(pos - k + 1)
        active = clamp(1 - abs(pos - k))
        rgb = mix_rgb(COL["muted"], COL["text"], max(active, done_all * 0.6))
        alpha = a * lerp(0.55, 1.0, max(d, done_all))
        text(c, s, xs[k] + widths[k] / 2, base_y(cy, size), size, rgb, alpha, align="center")
        if k < len(C.STEPS) - 1:
            sx = xs[k] + widths[k] + sep / 2
            p = paint(COL["muted"], 0.5 * a, stroke=1.6)
            c.drawLine(sx - 4, cy - 6, sx + 2, cy, p)
            c.drawLine(sx + 2, cy, sx - 4, cy + 6, p)


def token_state(i, t):
    """Return (cx, cy, scale, split_u, model_u) for question token i."""
    ts = A["token_split"]
    su = ease_io(prog(t, ts + 0.12 + 0.07 * i, ts + 0.8 + 0.07 * i))
    x = lerp(S.contig_cx[i], S.split_cx[i], su)
    ru = ease_io(prog(t, A["ids_in"] - 0.3, A["ids_in"] + 0.35))
    y = lerp(Q_Y, ROW_Y_IDS, ru)
    mu = ease_io(prog(t, A["model_in"] + 0.04 * i, A["model_in"] + 0.95 + 0.04 * i))
    x = lerp(x, COL_X[i] + model_shift(t), mu)
    y = lerp(y, CHIP_Y_MODEL, mu)
    s = lerp(1.0, CHIP_S_MODEL, mu)
    return x, y, s, su, mu


def draw_question_stage(c, t):
    qi = A["question_in"]
    if t < qi - 0.3:
        return
    ts = A["token_split"]
    # chat bubble
    ba = ease_out(prog(t, qi - 0.25, qi + 0.25)) * (1 - ease_io(prog(t, ts + 0.1, ts + 0.6)))
    if ba > 0.003:
        bs = lerp(0.9, 1.0, ease_back(prog(t, qi - 0.25, qi + 0.3))) * lerp(1, 1.06, prog(t, ts, ts + 0.6))
        bw = (S.contig_x1 - S.contig_x0) + 120
        bh = 136
        c.save()
        c.translate(W / 2, Q_Y)
        c.scale(bs, bs)
        rrect(c, -bw / 2, -bh / 2, bw / 2, bh / 2, 34, fill=COL["panel"], fill_a=0.9 * ba,
              stroke=COL["cyan"], stroke_a=0.55 * ba, sw=2, glow=16, glow_a=0.25 * ba)
        tail = skia.Path()
        tail.moveTo(bw / 2 - 90, bh / 2 - 2)
        tail.lineTo(bw / 2 - 40, bh / 2 + 30)
        tail.lineTo(bw / 2 - 52, bh / 2 - 2)
        tail.close()
        c.drawPath(tail, paint(COL["panel"], 0.9 * ba))
        c.restore()

    # stage label above the row
    labels = [(C.LABELS["question"], qi - 0.1, ts - 0.05),
              (C.LABELS["tokens"], ts + 0.45, A["ids_in"] - 0.45),
              (C.LABELS["ids"], A["ids_in"] + 0.3, A["model_in"] - 0.25)]
    _, ry, _, _, _ = token_state(0, t)
    for s, a0, a1 in labels:
        la = window(t, a0, a1, 0.25, 0.25)
        if la > 0:
            yy = ry - 118 + (1 - la) * 10
            text(c, s, W / 2, yy, 32, COL["muted"], la, bold=False, align="center")

    # typing reveal
    n_chars = sum(len(s) for s in C.QUESTION_TOKENS)
    typed = prog(t, qi + 0.05, qi + 0.95) * n_chars
    g = 0
    ga = model_alpha(t)
    for i, s in enumerate(C.QUESTION_TOKENS):
        x, y, sc, su, mu = token_state(i, t)
        cw = S.chip_w[i]
        rgb = TOKEN_COLORS[i]
        c.save()
        c.translate(x, y)
        c.scale(sc, sc)
        if su > 0.001:
            ca = su * ga
            rrect(c, -cw / 2, -CHIP_H / 2, cw / 2, CHIP_H / 2, 22, fill=rgb, fill_a=0.13 * ca,
                  stroke=rgb, stroke_a=0.9 * ca, sw=2.4, glow=14, glow_a=0.45 * ca)
        xx = -S.tok_w[i] / 2
        for k, ch in enumerate(s):
            ua = clamp(typed - g) * ga
            g += 1
            if ua > 0:
                tcol = mix_rgb(COL["text"], mix_rgb(COL["text"], rgb, 0.35), su)
                text(c, ch, xx, base_y(0, Q_FONT) + (1 - ease_out(ua)) * 14, Q_FONT, tcol, ua,
                     glow=10 if su > 0 else 0, glow_rgb=rgb, glow_a=0.35 * su)
            xx += S.char_w[i][k]
        c.restore()

    # caret while typing
    if qi < t < qi + 1.25:
        cx = S.contig_x0 + S.char_edges[int(typed)]
        on = (math.sin(t * 14) > -0.3) or typed < n_chars
        if on:
            c.drawRect(skia.Rect.MakeXYWH(cx + 6, Q_Y - 38, 5, 76), paint(COL["cyan"], 0.95))
            c.drawRect(skia.Rect.MakeXYWH(cx + 3, Q_Y - 40, 11, 80), paint(COL["cyan"], 0.4, blur=6))

    # scan line that "cuts" the sentence into tokens
    su = prog(t, ts, ts + 0.75)
    if 0 < su < 1:
        x0, x1 = S.contig_x0 - 40, S.contig_x1 + 40
        sx = lerp(x0, x1, ease_io(su))
        a = math.sin(su * math.pi)
        sh = lin_grad(0, Q_Y - 110, 0, Q_Y + 110,
                      [COL["bg_top"], COL["cyan"], COL["bg_top"]])
        c.drawRect(skia.Rect.MakeXYWH(sx - 2, Q_Y - 110, 4, 220), paint(COL["cyan"], a, shader=sh))
        c.drawRect(skia.Rect.MakeXYWH(sx - 14, Q_Y - 100, 28, 200), paint(COL["cyan"], 0.35 * a, blur=14))
        # trailing sheen
        c.drawRect(skia.Rect.MakeLTRB(x0, Q_Y - 70, sx, Q_Y + 70),
                   paint(COL["cyan"], 0.06 * a, shader=lin_grad(x0, 0, sx, 0, [COL["bg_top"], COL["cyan"]])))
    for b in range(1, len(C.QUESTION_TOKENS)):
        bx = S.contig_left[b]
        x0, x1 = S.contig_x0 - 40, S.contig_x1 + 40
        tb = ts + 0.75 * inv_ease_io((bx - x0) / (x1 - x0))
        sp = prog(t, tb, tb + 0.45)
        if 0 < sp < 1:
            r = lerp(6, 46, ease_out(sp))
            circle(c, bx, Q_Y, r, COL["cyan"], 0.8 * (1 - sp), stroke=2)
            circle(c, bx, Q_Y, 10, (230, 250, 255), 0.9 * (1 - sp), blur=6)


def inv_ease_io(y):
    lo, hi = 0.0, 1.0
    for _ in range(30):
        mid = (lo + hi) / 2
        if ease_io(mid) < y:
            lo = mid
        else:
            hi = mid
    return lo


def draw_numbers(c, t):
    ii, vi, mi = A["ids_in"], A["vectors_in"], A["model_in"]
    if t < ii:
        return
    fade_ids = 1 - ease_io(prog(t, mi, mi + 0.5))
    for i, tid in enumerate(C.TOKEN_IDS):
        x, y, sc, su, mu = token_state(i, t)
        rgb = TOKEN_COLORS[i]
        p = ease_out(prog(t, ii + 0.25 + 0.09 * i, ii + 0.75 + 0.09 * i))
        if p > 0 and fade_ids > 0:
            a = p * fade_ids
            yy = y + CHIP_H / 2 + 62 - (1 - p) * 34
            c.drawLine(x, y + CHIP_H / 2 + 6, x, yy - 36, paint(rgb, 0.5 * a, stroke=1.6))
            val = int(round(tid * ease_out(prog(t, ii + 0.25 + 0.09 * i, ii + 0.95 + 0.09 * i))))
            text(c, str(val), x, yy, 38, COL["amber"], a, align="center", glow=10, glow_a=0.45)
        # vector strip
        vp = ease_out(prog(t, vi + 0.07 * i, vi + 0.6 + 0.07 * i))
        if vp <= 0:
            continue
        mu2 = ease_io(prog(t, mi + 0.04 * i, mi + 0.95 + 0.04 * i))
        vx = lerp(x, COL_X[i], mu2) if mu2 < 1 else COL_X[i]
        row_vy = ROW_Y_IDS + CHIP_H / 2 + 142
        vy = lerp(row_vy, ROW_Y[0], mu2)
        vs = lerp(1.15, VEC_S_MODEL, mu2)
        draw_vector(c, vx, vy, vs, S.vec[i], vp, model_alpha(t), t, i)


def draw_vector(c, x, y, s, vals, p, alpha, t, i):
    n = len(vals)
    bw, gap, hh = 10 * s, 4 * s, 30 * s
    total = n * bw + (n - 1) * gap
    x0 = x - total / 2
    a = alpha * p
    act = activity(0, i, t)
    rrect(c, x0 - 12 * s, y - hh - 8 * s, x0 + total + 12 * s, y + hh + 8 * s, 10 * s,
          fill=COL["panel"], fill_a=0.7 * a, stroke=COL["panel_edge"], stroke_a=(0.6 + 0.4 * act) * a,
          sw=1.4, glow=8 if act > 0.05 else 0, glow_a=0.6 * act * a)
    for k, v in enumerate(vals):
        h = v * hh * p
        rgb = COL["cyan"] if v >= 0 else COL["violet"]
        bx = x0 + k * (bw + gap)
        r = skia.Rect.MakeLTRB(bx, min(y, y - h), bx + bw, max(y, y - h) + 0.5)
        c.drawRoundRect(r, 2, 2, paint(rgb, (0.85 + 0.15 * act) * a))
    c.drawLine(x0 - 4 * s, y, x0 + total + 4 * s, y, paint(COL["muted"], 0.35 * a, stroke=1))


def model_alpha(t):
    return 1 - ease_io(prog(t, T_CAUTION - 0.1, T_CAUTION + 0.55))


def model_shift(t):
    return -70 * ease_io(prog(t, T_CAUTION, T_CAUTION + 0.9))


def activity(r, i, t):
    a = 0.0
    for k, tg in enumerate(GEN_T):
        tw_ = tg - FLIGHT - 0.42 + r * 0.09
        d = (t - tw_) / 0.07
        if -3 < d < 3:
            col_w = 1.0 if i == 5 else 0.35
            a = max(a, math.exp(-d * d) * col_w)
    for sn in S.snips:
        te = sn["t_l"] + sn["dur"]
        if sn["tr"] == r and sn["tc"] == i:
            d = (t - te) / 0.09
            if -3 < d < 3:
                a = max(a, 0.8 * math.exp(-d * d))
    return a


def draw_model(c, t):
    mi = A["model_in"]
    if t < mi - 0.1:
        return
    ma = model_alpha(t)
    pa = ease_io(prog(t, mi, mi + 0.8)) * ma
    c.save()
    c.translate(model_shift(t), 0)
    r = MODEL
    rrect(c, r.left(), r.top(), r.right(), r.bottom(), 30, fill=COL["panel"], fill_a=0.55 * pa,
          stroke=COL["panel_edge"], stroke_a=0.7 * pa, sw=1.6, glow=20, glow_a=0.18 * pa)
    text(c, "大语言模型", r.left() + 34, r.top() + 50, 32, COL["text"], pa)
    text(c, "LLM", r.left() + 34 + tw("大语言模型", 32) + 12, r.top() + 50, 24, COL["cyan"], pa, bold=False)
    tag1 = window(t, mi + 0.3, A["attention_in"] - 0.1, 0.3, 0.3)
    tag2 = window(t, A["attention_in"], T_CAUTION + 0.5, 0.3, 0.4)
    for s, a, rgb in [("从海量文本数据中学到规律", tag1, COL["amber"]),
                      ("结合上下文 · 预测下一个词", tag2, COL["cyan"])]:
        if a > 0:
            w_ = tw(s, 24, False) + 36
            x1 = r.right() - 30
            rrect(c, x1 - w_, r.top() + 22, x1, r.top() + 62, 20, fill=rgb, fill_a=0.10 * a * pa,
                  stroke=rgb, stroke_a=0.7 * a * pa, sw=1.4)
            text(c, s, x1 - w_ / 2, r.top() + 50, 24, rgb, a * pa, bold=False, align="center")

    # edges: residual links first, then attention
    ai = A["attention_in"]
    for e in S.edges:
        rr, i, j, w = e["r"], e["i"], e["j"], e["w"]
        lr = ease_io(prog(t, mi + 0.55 + 0.25 * rr, mi + 1.0 + 0.25 * rr))
        if i == j:
            prog_draw = lr
        else:
            prog_draw = ease_io(prog(t, ai + 0.18 * rr + 0.03 * j, ai + 0.7 + 0.18 * rr + 0.03 * j))
        if prog_draw <= 0:
            continue
        hot = i == 5 and t > ai
        rgb = COL["cyan"] if hot else COL["violet"]
        a = (0.10 + 0.75 * w) * ma * (1.0 if hot else 0.7)
        sw = 1.0 + 4.5 * w
        path = e["path"]
        if prog_draw < 1:
            seg = skia.Path()
            e["pm"].getSegment(0, e["L"] * prog_draw, seg, True)
            path = seg
        if hot and w > 0.15:
            c.drawPath(path, paint(rgb, 0.5 * a, stroke=sw * 3, blur=6))
        c.drawPath(path, paint(rgb, a, stroke=sw))
        # travelling pulses along strong edges
        if prog_draw >= 1 and w > 0.18 and t > ai + 0.5:
            spd = 0.9
            for q in range(2):
                u = ((t - ai) * spd + e["ph"] + q * 0.5) % 1.0
                for k in range(4):
                    uk = u - k * 0.03
                    if uk < 0:
                        continue
                    pos, _ = e["pm"].getPosTan(e["L"] * uk)
                    circle(c, pos.x(), pos.y(), 3.2 - k * 0.6, (225, 250, 255) if hot else COL["violet"],
                           (0.9 - k * 0.22) * ma * min(1, w * 2.5))

    # nodes
    for rr in range(1, 4):
        lr = ease_back(prog(t, mi + 0.45 + 0.25 * (rr - 1), mi + 0.95 + 0.25 * (rr - 1)))
        if lr <= 0:
            continue
        for i in range(6):
            act = activity(rr, i, t)
            x, y = COL_X[i], ROW_Y[rr]
            rad = 11 * lr * (1 + 0.25 * act)
            base = COL["cyan"] if (i == 5 and t > ai) else COL["violet"]
            circle(c, x, y, rad * 2.2, base, (0.18 + 0.5 * act) * ma, blur=10)
            circle(c, x, y, rad, COL["panel"], 0.95 * ma)
            circle(c, x, y, rad, base, 0.95 * ma, stroke=2.2)
            circle(c, x, y, rad * 0.45, mix_rgb(base, (255, 255, 255), act), (0.6 + 0.4 * act) * ma)

    # output node: next-token prediction
    oa = ease_out(prog(t, A["generate_in"] - 0.35, A["generate_in"] + 0.1)) * ma
    if oa > 0:
        ox, oy = OUT_NODE
        c.drawLine(COL_X[5], ROW_Y[3] - 12, ox, oy + 20, paint(COL["amber"], 0.7 * oa, stroke=2))
        act = 0.0
        for tg in GEN_T:
            d = (t - (tg - FLIGHT)) / 0.08
            if -3 < d < 3:
                act = max(act, math.exp(-d * d))
        circle(c, ox, oy, 34 + 10 * act, COL["amber"], (0.25 + 0.5 * act) * oa, blur=16)
        circle(c, ox, oy, 19, COL["panel"], oa)
        circle(c, ox, oy, 19, COL["amber"], oa, stroke=2.6)
        circle(c, ox, oy, 7 + 3 * act, (255, 230, 180), oa)
        text(c, "下一个词？", ox - 36, base_y(oy, 26), 26, COL["amber"], oa, align="right")
    c.restore()


def draw_data(c, t):
    """Training-data snippets: a floating cloud that streams into the model's layers."""
    mi = A["model_in"]
    if t < mi or t > A["attention_in"] + 0.5:
        return
    la = window(t, mi + 0.9, A["attention_in"] - 0.5, 0.35, 0.35)
    if la > 0:
        text(c, C.LABELS["data"], 1495, 262, 30, COL["text"], la, align="center")
        text(c, "书籍 · 网页 · 百科 · 对话 · 代码 …", 1495, 298, 22, COL["muted"], la, bold=False,
             align="center")
    for sn in S.snips:
        ai = ease_out(prog(t, sn["t_in"], sn["t_in"] + 0.45))
        if ai <= 0:
            continue
        u = prog(t, sn["t_l"], sn["t_l"] + sn["dur"])
        if u >= 1:
            continue
        fx = sn["cx"] + 6 * math.sin(t * 1.4 + sn["ph"])
        fy = sn["cy"] + 5 * math.cos(t * 1.1 + sn["ph"]) + (1 - ai) * 16
        tx, ty = COL_X[sn["tc"]], ROW_Y[sn["tr"]]
        p0, p2 = (fx, fy), (tx, ty)
        p1 = (lerp(fx, tx, 0.55), min(fy, ty) - 140)
        size = sn["size"]
        if u <= 0:
            w_ = tw(sn["s"], size, False) + 28
            rrect(c, fx - w_ / 2, fy - 21, fx + w_ / 2, fy + 21, 21, fill=COL["panel"],
                  fill_a=0.75 * ai, stroke=COL["panel_edge"], stroke_a=0.9 * ai, sw=1.3)
            text(c, sn["s"], fx, base_y(fy, size), size, (190, 205, 240), ai, bold=False, align="center")
            continue
        ue = ease_io(u)
        # streak trail
        pts = [bezier(p0, p1, p2, ease_io(clamp(u - k * 0.03))) for k in range(10)]
        for k in range(len(pts) - 1):
            c.drawLine(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1],
                       paint(COL["cyan"], 0.55 * (1 - k / 9) * (1 - ue * 0.4), stroke=3.2 - k * 0.28))
        px, py = pts[0]
        sc = lerp(1.0, 0.0, clamp(ue * 1.6))
        if sc > 0.02:
            w_ = (tw(sn["s"], size, False) + 28) * sc
            rrect(c, px - w_ / 2, py - 21 * sc, px + w_ / 2, py + 21 * sc, 21 * sc,
                  fill=COL["panel"], fill_a=0.75, stroke=COL["cyan"], stroke_a=0.9, sw=1.3)
            text(c, sn["s"], px, base_y(py, size * sc), size * sc, (210, 235, 255), 1.0, bold=False,
                 align="center")
        circle(c, px, py, 12, COL["cyan"], 0.5 * clamp(ue * 2), blur=8)
        circle(c, px, py, 3.5, (235, 252, 255), clamp(ue * 2))


def ans_transform(t):
    """Answer panel origin + scale (moves to centre for the caution beat)."""
    k = ease_io(prog(t, T_CAUTION, T_CAUTION + 0.9))
    s1 = 1.18
    ox1 = W / 2 - ANS_SIZE[0] * s1 / 2
    oy1 = 236
    return lerp(ANS_ORIGIN[0], ox1, k), lerp(ANS_ORIGIN[1], oy1, k), lerp(1, s1, k)


def draw_answer(c, t):
    a_in = ease_out(prog(t, A["generate_in"] - 0.8, A["generate_in"] - 0.1))
    if a_in <= 0:
        return
    fade = 1 - ease_io(prog(t, T_END - C.FADE_OUT - 0.1, T_END))
    a = a_in
    ox, oy, s = ans_transform(t)
    ox += (1 - a_in) * 60
    w, h = ANS_SIZE
    c.save()
    c.translate(ox, oy)
    c.scale(s, s)
    ck = ease_io(prog(t, T_CAUTION + 0.3, T_CAUTION + 1.0))
    edge = mix_rgb(COL["panel_edge"], COL["amber"], ck * 0.6)
    rrect(c, 0, 0, w, h, 26, fill=COL["panel"], fill_a=0.82 * a, stroke=edge, stroke_a=0.85 * a,
          sw=1.6, glow=18, glow_a=0.2 * a)
    circle(c, 46, 44, 13, COL["cyan"], a, blur=0)
    circle(c, 46, 44, 22, COL["cyan"], 0.35 * a, blur=10)
    text(c, C.LABELS["answer"], 72, base_y(44, 28), 28, COL["text"], a)
    q = "问：" + C.QUESTION
    text(c, q, w - 30, base_y(44, 22), 22, COL["muted"], a, bold=False, align="right")
    c.drawLine(30, 80, w - 30, 80, paint(COL["panel_edge"], 0.6 * a, stroke=1))

    fs = S.ans_fs
    last = None
    for k, s_ in enumerate(C.ANSWER_TOKENS):
        tg = GEN_T[k]
        if t < tg:
            break
        x, y, tw_ = S.ans_pos[k]
        flash = math.exp(-(t - tg) / 0.35)
        rgb = mix_rgb(COL["text"], COL["cyan"], flash * 0.8)
        text(c, s_, x, y, fs, rgb, a, glow=12 if flash > 0.03 else 0, glow_rgb=COL["cyan"],
             glow_a=0.6 * flash)
        last = (x + tw_, y)
    if last is None:
        last = (36, 140)
    done = t > GEN_T[-1] + 0.6
    if not done and t > A["generate_in"] - 0.2:
        if math.sin(t * 12) > -0.2 or t < GEN_T[-1]:
            c.drawRect(skia.Rect.MakeXYWH(last[0] + 5, last[1] - 36, 4, 44), paint(COL["cyan"], a))

    # verification sweep during the caution beat
    vs = prog(t, T_CAUTION + 1.1, T_CAUTION + 2.6)
    if vs > 0:
        rows = sorted(set(p[1] for p in S.ans_pos))
        n = len(rows)
        for ri, ry in enumerate(rows):
            xs = [p[0] for p in S.ans_pos if p[1] == ry]
            xe = [p[0] + p[2] for p in S.ans_pos if p[1] == ry]
            u = clamp(vs * n - ri)
            if u <= 0:
                continue
            x0, x1 = min(xs), max(xe)
            xu = lerp(x0, x1, ease_io(u))
            c.drawRect(skia.Rect.MakeLTRB(x0, ry + 12, xu, ry + 15), paint(COL["amber"], 0.85 * fade))
            if u < 1:
                c.drawRect(skia.Rect.MakeLTRB(xu - 40, ry - 40, xu, ry + 14),
                           paint(COL["amber"], 0.22, shader=lin_grad(xu - 40, 0, xu, 0,
                                                                     [COL["panel"], COL["amber"]])))
    c.restore()


def ans_slot_abs(k):
    x, y, _ = S.ans_pos[k]
    return ANS_ORIGIN[0] + x, ANS_ORIGIN[1] + y


def prob_row_y(k):
    return 146 + k * 50


def draw_prob(c, t):
    a = ease_out(prog(t, T_PROB_IN - 0.2, T_PROB_IN + 0.25)) * (1 - ease_io(prog(t, T_CAUTION, T_CAUTION + 0.5)))
    if a <= 0:
        return
    ox, oy = PROB_ORIGIN
    oy += (1 - ease_out(prog(t, T_PROB_IN - 0.2, T_PROB_IN + 0.3))) * 40
    w, h = PROB_SIZE
    c.save()
    c.translate(ox, oy)
    rrect(c, 0, 0, w, h, 26, fill=COL["panel"], fill_a=0.82 * a, stroke=COL["panel_edge"],
          stroke_a=0.85 * a, sw=1.6, glow=18, glow_a=0.2 * a)
    text(c, C.LABELS["prob"], 34, 50, 28, COL["text"], a)
    ctx = "上文：…" + "".join(C.ANSWER_TOKENS[C.PROB_AT - 3:C.PROB_AT])
    cw = text(c, ctx, 34, 94, 24, COL["muted"], a, bold=False)
    blink = 0.5 + 0.5 * math.sin(t * 10)
    c.drawRect(skia.Rect.MakeXYWH(34 + cw + 8, 94 - 22, 44, 26),
               paint(COL["amber"], (0.25 + 0.5 * blink) * a * (1 - prog(t, T_PROB_SEL, T_PROB_SEL + 0.2)), stroke=1.6))
    maxw = 400
    sel = ease_out(prog(t, T_PROB_SEL - 0.1, T_PROB_SEL + 0.25))
    for k, (lab, pv) in enumerate(C.CANDIDATES):
        y = prob_row_y(k)
        g = ease_out(prog(t, T_PROB_IN + 0.05 + 0.08 * k, T_PROB_IN + 0.65 + 0.08 * k))
        top = k == 0
        rgb = COL["amber"] if top else COL["violet"]
        if top and sel > 0:
            rrect(c, 20, y - 24, w - 20, y + 24, 14, fill=COL["amber"], fill_a=0.12 * sel * a,
                  stroke=COL["amber"], stroke_a=0.8 * sel * a, sw=1.6, glow=12, glow_a=0.4 * sel * a)
        text(c, lab, 40, base_y(y, 30), 30, COL["text"] if top else COL["muted"], a)
        bx0 = 130
        bw = maxw * pv * g
        c.drawRoundRect(skia.Rect.MakeLTRB(bx0, y - 9, bx0 + maxw, y + 9), 9, 9,
                        paint(COL["panel_edge"], 0.35 * a))
        if bw > 1:
            sh = lin_grad(bx0, 0, bx0 + bw, 0, [mix_rgb(rgb, COL["bg_top"], 0.3), rgb])
            if top:
                c.drawRoundRect(skia.Rect.MakeLTRB(bx0, y - 9, bx0 + bw, y + 9), 9, 9,
                                paint(rgb, 0.6 * a, blur=10))
            c.drawRoundRect(skia.Rect.MakeLTRB(bx0, y - 9, bx0 + bw, y + 9), 9, 9,
                            paint(rgb, a * (1 if top else 0.8), shader=sh))
        text(c, f"{int(round(pv * 100 * g))}%", bx0 + maxw + 18, base_y(y, 28), 28,
             COL["amber"] if top else COL["muted"], a)
    c.restore()


def draw_flights(c, t):
    """Tokens flying from the output node (or the probability panel) into the answer."""
    fs = S.ans_fs
    for k, s_ in enumerate(C.ANSWER_TOKENS):
        tg = GEN_T[k]
        u = prog(t, tg - FLIGHT, tg)
        if u <= 0 or u >= 1:
            continue
        if k == C.PROB_AT:
            p0 = (PROB_ORIGIN[0] + 40, PROB_ORIGIN[1] + base_y(prob_row_y(0), 30))
        else:
            p0 = (OUT_NODE[0] - tw(s_, fs) / 2, OUT_NODE[1] + 14)
        p2 = ans_slot_abs(k)
        p1 = (lerp(p0[0], p2[0], 0.45), min(p0[1], p2[1]) - 110)
        for g in range(5, -1, -1):
            ug = ease_io(clamp(u - g * 0.05))
            px, py = bezier(p0, p1, p2, ug)
            sc = lerp(0.7, 1.0, ug)
            a = (1.0 if g == 0 else 0.28 / g) * math.sin(min(1, u * 1.15) * math.pi * 0.5 + 0.0001) ** 0.5
            rgb = COL["amber"] if g == 0 else COL["cyan"]
            text(c, s_, px, py, fs * sc, rgb, a, glow=14 if g == 0 else 0, glow_a=0.7)


def draw_caution(c, t):
    cz = T_CAUTION
    a = ease_out(prog(t, cz + 0.55, cz + 1.0))
    if a <= 0:
        return
    fade = 1 - ease_io(prog(t, T_END - C.FADE_OUT - 0.1, T_END))
    s = lerp(0.85, 1.0, ease_back(prog(t, cz + 0.55, cz + 1.05)))
    size = 46
    w1 = tw(C.CAUTION_EMPH, size)
    w2 = tw(C.CAUTION_REST, size)
    icon = 52
    pad = 44
    total = pad + icon + 20 + w1 + w2 + pad
    cy = 712
    pulse = 0.5 + 0.5 * math.sin((t - cz) * 4)
    c.save()
    c.translate(W / 2, cy)
    c.scale(s, s)
    rrect(c, -total / 2, -50, total / 2, 50, 50, fill=COL["amber"], fill_a=0.10 * a * fade,
          stroke=COL["amber"], stroke_a=0.95 * a * fade, sw=2.4, glow=18 + 8 * pulse,
          glow_a=(0.35 + 0.2 * pulse) * a * fade)
    x = -total / 2 + pad
    tri = skia.Path()
    tri.moveTo(x + icon / 2, -icon / 2 + 2)
    tri.lineTo(x + icon, icon / 2 - 4)
    tri.lineTo(x, icon / 2 - 4)
    tri.close()
    pp = paint(COL["amber"], a * fade, stroke=3.2)
    pp.setStrokeJoin(skia.Paint.kRound_Join)
    c.drawPath(tri, pp)
    c.drawLine(x + icon / 2, -8, x + icon / 2, 8, paint(COL["amber"], a * fade, stroke=4))
    circle(c, x + icon / 2, 16, 2.6, COL["amber"], a * fade)
    x += icon + 20
    text(c, C.CAUTION_EMPH, x, base_y(0, size), size, COL["amber"], a * fade, glow=10, glow_a=0.5)
    text(c, C.CAUTION_REST, x + w1, base_y(0, size), size, COL["text"], a * fade)
    c.restore()

    ea = ease_out(prog(t, cz + 2.2, cz + 2.9)) * fade
    if ea > 0:
        text(c, C.END_TAG, W / 2, 826 + (1 - ea) * 10, 28, COL["muted"], ea, bold=False, align="center")


def draw_subtitles(c, t):
    for ln in LINES:
        a = window(t, ln["sub_start"] + 0.12, ln["sub_end"] - 0.12, 0.12, 0.12)
        if a <= 0:
            continue
        s = ln["subtitle"]
        size = 42
        w = tw(s, size, False)
        bw, bh = w + 76, 74
        rrect(c, W / 2 - bw / 2, SUB_Y - bh / 2, W / 2 + bw / 2, SUB_Y + bh / 2, 18,
              fill=(4, 7, 20), fill_a=0.74 * a, stroke=(255, 255, 255), stroke_a=0.08 * a, sw=1)
        text(c, s, W / 2, base_y(SUB_Y, size) - 1, size, (247, 250, 255), a, bold=False, align="center")


def draw_frame(t):
    init_static()
    surf = skia.Surface(W, H)
    c = surf.getCanvas()
    draw_background(c, t)
    draw_title(c, t)
    draw_model(c, t)
    draw_numbers(c, t)
    draw_question_stage(c, t)
    draw_data(c, t)
    draw_answer(c, t)
    draw_prob(c, t)
    draw_flights(c, t)
    draw_caution(c, t)
    draw_steps(c, t)
    c.drawImage(S.vignette, 0, 0)
    draw_subtitles(c, t)
    fo = prog(t, T_END - C.FADE_OUT, T_END)
    if fo > 0:
        c.drawRect(skia.Rect.MakeWH(W, H), paint((2, 4, 12), ease_in(fo) * 0.92))
    fi = 1 - prog(t, 0, 0.35)
    if fi > 0:
        c.drawRect(skia.Rect.MakeWH(W, H), paint((2, 4, 12), fi))
    arr = surf.makeImageSnapshot().toarray(colorType=skia.kRGBA_8888_ColorType)
    return arr


def frame_bytes(i):
    t = i / FPS
    arr = draw_frame(t)
    rgb = arr[..., :3].astype(np.int16)
    rgb += S.grain[(i // 2) % len(S.grain)]
    np.clip(rgb, 0, 255, out=rgb)
    return rgb.astype(np.uint8).tobytes()


def save_still(t, path):
    arr = draw_frame(t)
    skia.Image.fromarray(np.ascontiguousarray(arr), colorType=skia.kRGBA_8888_ColorType).save(str(path))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--still", type=float, nargs="*")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--out", default=str(C.OUTPUT / "llm_explainer_20s.mp4"))
    args = ap.parse_args()
    C.OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.still:
        (C.OUTPUT / "preview").mkdir(exist_ok=True)
        for t in args.still:
            p = C.OUTPUT / "preview" / f"still_{t:05.2f}.png"
            save_still(t, p)
            print(p)
        return

    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    mix = C.AUDIO_DIR / "mix.wav"
    if not args.no_audio and mix.exists():
        cmd += ["-i", str(mix), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k",
                "-ar", "48000", "-ac", "2"]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-maxrate", "14M", "-bufsize", "28M", "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-r", str(FPS), "-t", f"{C.DURATION:.3f}",
            "-movflags", "+faststart", args.out]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    batch = 16
    with Pool(args.workers, initializer=init_static) as pool:
        for b0 in range(0, C.N_FRAMES, batch):
            idx = list(range(b0, min(b0 + batch, C.N_FRAMES)))
            for buf in pool.map(frame_bytes, idx):
                enc.stdin.write(buf)
            print(f"\r[render] {idx[-1] + 1}/{C.N_FRAMES}", end="", flush=True)
    enc.stdin.close()
    enc.wait()
    print(f"\n[render] wrote {args.out}")
    if enc.returncode:
        sys.exit(enc.returncode)


if __name__ == "__main__":
    main()
