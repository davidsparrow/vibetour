"""headunit.py <car dir> <seconds> <out dir>: the car's two screens as videos, for composite.sh to light up.

A car with "screens" in car.json gets the radio's face on its console screen (band, LIVE, equalizer lights, station,
song, transport, presets 1-6) and the station and the water temperature on the cluster's centre display. Each video is
the size of its screen box, in cockpit pixels, drawn on black: composite.sh blends them onto the dark glass with
"screen", so the glass keeps its sheen and the hands pass in front. The temperature warms up from cold to half over
the first WARMUP seconds (45). This is a stand-in for the app's live radio (src/webview/ui/radioDeck.ts), which draws
the same face into the same box. Writes <out>/console.mp4 and <out>/cluster.mp4.
"""
import json, math, os, random, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

car, T, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
FPS = 24
SS = 4                                   # supersampling for the static layers
WARMUP = float(os.environ.get("WARMUP", 45))
screens = json.load(open(f"{car}/car.json"))["screens"]

AMBER, AMBER_DIM = (240, 162, 74), (46, 30, 16)
CYAN, TEXT, MUTED, RED = (94, 200, 240), (226, 230, 236), (120, 130, 142), (230, 84, 72)
STATION = "Groove Salad"
# The songs the stand-in plays, by start time in seconds. Made-up titles: the app shows the stream's own.
SONGS = [(0, "Pacific Static", "Slow Lanes"), (200, "Marine Layer", "Fog Line, Late Afternoon")]


def font(px, bold=False):
    for path in ("/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" if bold
                 else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, round(px * SS), index=(1 if bold else 0) if path.endswith(".ttc") else 0)
    return ImageFont.load_default()


def fit(d, text, f, w):
    """The text cut with an ellipsis to fit w (supersampled) pixels."""
    if d.textlength(text, font=f) <= w:
        return text
    while text and d.textlength(text + "…", font=f) > w:
        text = text[:-1]
    return text.rstrip() + "…"


def transport(d, x, y, s, gap):
    """Power, previous, pause and next, drawn (monospace fonts lack the glyphs)."""
    lw = max(1, round(s / 7))
    d.arc([x, y, x + s, y + s], 300, 240, fill=RED, width=lw)
    d.line([x + s / 2, y - s * 0.05, x + s / 2, y + s * 0.45], fill=RED, width=lw)
    x += s + gap
    d.rectangle([x, y, x + s * 0.13, y + s], fill=TEXT)
    d.polygon([(x + s, y), (x + s * 0.2, y + s / 2), (x + s, y + s)], fill=TEXT)
    x += s + gap
    d.rectangle([x + s * 0.15, y, x + s * 0.4, y + s], fill=TEXT)
    d.rectangle([x + s * 0.6, y, x + s * 0.85, y + s], fill=TEXT)
    x += s + gap
    d.polygon([(x, y), (x + s * 0.8, y + s / 2), (x, y + s)], fill=TEXT)
    d.rectangle([x + s * 0.87, y, x + s, y + s], fill=TEXT)


def console_base(w, h, artist, title):
    """Everything on the console face that doesn't move, for one song. Returns the image and the boxes that do move."""
    W, H = w * SS, h * SS
    im = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(im)
    p = 0.05 * W
    u = min(w / 190, h / 175)            # layout unit: the grand tourer's screen is about 165x155 px
    f8 = font(8 * u, True)
    d.rounded_rectangle([p, p, p + 34 * u * SS, p + 13 * u * SS], radius=3 * SS, outline=(70, 80, 92), width=SS)
    d.text((p + 4 * u * SS, p + 2.5 * u * SS), "FM", font=f8, fill=CYAN)
    d.text((p + 19 * u * SS, p + 2.5 * u * SS), "CB", font=f8, fill=MUTED)
    d.text((W - p, p + 2.5 * u * SS), "LIVE", font=f8, fill=(220, 120, 110), anchor="ra")
    lw = d.textlength("LIVE", font=f8)
    live = (W - p - lw - 9 * u * SS, p + 4 * u * SS, W - p - lw - 4 * u * SS, p + 9 * u * SS)
    eq = (p, p + 17 * u * SS, W - p, p + 66 * u * SS)
    ty = eq[3] + 6 * u * SS
    d.text((p, ty), fit(d, STATION, font(15 * u, True), W - 2 * p), font=font(15 * u, True), fill=CYAN)
    d.text((p, ty + 19 * u * SS), fit(d, artist, font(9.5 * u), W - 2 * p), font=font(9.5 * u), fill=TEXT)
    d.text((p, ty + 31 * u * SS), fit(d, title, font(9.5 * u), W - 2 * p), font=font(9.5 * u), fill=TEXT)
    transport(d, p + 2 * u * SS, ty + 46 * u * SS, 10 * u * SS, 13 * u * SS)
    by, bh = H - p - 14 * u * SS, 14 * u * SS
    bw = (W - 2 * p) / 6
    for i in range(6):
        b = [p + i * bw + 1.5 * u * SS, by, p + (i + 1) * bw - 1.5 * u * SS, by + bh]
        if i == 0:
            d.rounded_rectangle(b, radius=3 * SS, fill=AMBER)
        else:
            d.rounded_rectangle(b, radius=3 * SS, outline=(70, 80, 92), width=SS)
        d.text(((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), str(i + 1), font=font(9 * u, True), fill=(30, 20, 10) if i == 0 else TEXT, anchor="mm")
    small = im.resize((w, h), Image.LANCZOS)
    return small, tuple(round(v / SS) for v in eq), tuple(round(v / SS) for v in live)


def cluster_frame(w, h, temp):
    """The cluster's centre display: the station, the band, and the water temperature as a bar from C to H."""
    W, H = w * SS, h * SS
    im = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(im)
    u = min(w / 90, h / 76)              # layout unit: the grand tourer's display is about 80x70 px
    d.text((W / 2, 10 * u * SS), fit(d, STATION, font(8 * u, True), W * 0.92), font=font(8 * u, True), fill=CYAN, anchor="mm")
    d.text((W / 2, 21 * u * SS), "FM", font=font(7 * u), fill=MUTED, anchor="mm")
    by = H - 22 * u * SS
    d.text((8 * u * SS, by), "C", font=font(8 * u, True), fill=MUTED, anchor="mm")
    d.text((W - 8 * u * SS, by), "H", font=font(8 * u, True), fill=MUTED, anchor="mm")
    n, x0, x1 = 8, 15 * u * SS, W - 15 * u * SS
    sw = (x1 - x0) / n
    for i in range(n):
        lit = i < round(temp * n)
        d.rectangle([x0 + i * sw + SS, by - 4 * u * SS, x0 + (i + 1) * sw - SS, by + 4 * u * SS], fill=(232, 236, 240) if lit else (48, 54, 62))
    d.text((W / 2, H - 9 * u * SS), "TEMP", font=font(6 * u), fill=MUTED, anchor="mm")
    return im.resize((w, h), Image.LANCZOS)


def levels(t, cols, rng_state={}):
    """Equalizer levels 0..1 per column at time t: a beat at 96 bpm, slow per-band swells and fast flicker, so the
    lights look like music without any audio. Deterministic in t."""
    beat = max(0.0, 1 - ((t * 96 / 60) % 1) * 3)
    out = []
    for c in range(cols):
        low = 1 - c / cols
        swell = 0.5 + 0.25 * math.sin(t * (0.7 + 0.13 * c) + c * 1.7) + 0.15 * math.sin(t * (2.3 + 0.21 * c) + c)
        flick = 0.12 * math.sin(t * (11 + c * 1.9) + c * 3.1)
        out.append(min(1, max(0.05, swell * (0.65 + 0.35 * low) + flick + 0.3 * beat * low)))
    return out, beat


def encode(path, w, h):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS),
                             "-i", "-", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv444p", path], stdin=subprocess.PIPE)


os.makedirs(out, exist_ok=True)
n = int(round(T * FPS))
cx, cy, cw, ch = screens["console"]
bases = [(start, console_base(cw, ch, a, t)) for start, a, t in SONGS]
con = encode(f"{out}/console.mp4", cw, ch)
COLS, ROWS = 16, 7
for k in range(n):
    t = k / FPS
    base, eq, live = [b for s, b in bases if s <= t][-1]
    im = base.copy()
    d = ImageDraw.Draw(im)
    lv, beat = levels(t, COLS)
    gw, gh = (eq[2] - eq[0]) / COLS, (eq[3] - eq[1]) / ROWS
    for c in range(COLS):
        on = round(lv[c] * ROWS)
        for r in range(ROWS):
            x0, y0 = eq[0] + c * gw, eq[1] + r * gh
            d.rectangle([round(x0 + 1), round(y0 + 1), round(x0 + gw - 2), round(y0 + gh - 2)], fill=AMBER if r >= ROWS - on else AMBER_DIM)
    a = 0.65 + 0.35 * beat
    d.ellipse(live, fill=tuple(round(v * a) for v in RED))
    con.stdin.write(im.tobytes())
con.stdin.close(); con.wait()

kx, ky, kw, kh = screens["cluster"]
clu = encode(f"{out}/cluster.mp4", kw, kh)
frames = {}
for k in range(n):
    t = k / FPS
    temp = 0.5 * min(1, 0.25 + 0.75 * t / WARMUP) if WARMUP > 0 else 0.5   # 8 segments: 1 lit when cold, 4 when warm
    key = round(temp * 8)
    if key not in frames:
        frames[key] = cluster_frame(kw, kh, temp).tobytes()
    clu.stdin.write(frames[key])
clu.stdin.close(); clu.wait()
print(f"headunit: {n} frames, console {cw}x{ch}, cluster {kw}x{kh}")
