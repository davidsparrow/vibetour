"""buildspeed.py <build.mp4> <inputs.json> <out.csv> <out.png>: road speed per second through the windshield of a built tour
(pace.py's measure on the road just below the horizon that shows above the dash, BAND 0.50:0.59 of the 1280x720 frame;
its units are smaller than pace.py's on a plate, since the band's bottom row is nearer the horizon), joins ticked in red,
one row per 90 s, TOP (6) the top of the scale. The CSV is seconds and speed. A dip at a join that is not a stop, weather
or roadside people is a flaw (the user, 27 Oct 2026: a driver who "speeds up, then slows down" all tour is maddening)."""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("BAND", "0.50:0.59")
import pace, cv2, numpy as np
from PIL import Image, ImageDraw
build, inputs, out_csv, out_png = sys.argv[1:5]
clips = json.load(open(inputs)); starts = []; t = 0.0
for c in clips:
    starts.append((t, c["name"].replace(".mp4", ""))); t += c["duration"] - 1.0
cap = cv2.VideoCapture(build); fps = cap.get(cv2.CAP_PROP_FPS); frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(cv2.resize(f, (336, 189), interpolation=cv2.INTER_AREA))
sm, raw = pace.flow(frames)
secs = np.arange(len(sm)) / fps
rows = []
for s in range(int(secs[-1]) + 1):
    i = (secs >= s) & (secs < s + 1); rows.append((s, float(sm[i].mean())))
with open(out_csv, "w") as fh:
    fh.write("t,speed\n"); fh.writelines(f"{s},{v:.2f}\n" for s, v in rows)
W, H = 1800, 1000; span = 90; rh = H // 4; TOP = float(os.environ.get("TOP", 30))
im = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(im)
def xy(t, v, r): return 40 + (t - r * span) / span * (W - 60), r * rh + rh - 20 - v / TOP * (rh - 40)
for r in range(4):
    y0 = r * rh + 20
    for g in (10, 17, 20): d.line([(40, xy(0, g, r)[1]), (W - 20, xy(0, g, r)[1])], fill=(120, 120, 120) if g == 17 else (210, 210, 210))
    for s in range(r * span, (r + 1) * span + 1, 5):
        x = xy(s, 0, r)[0]; d.line([(x, r * rh + rh - 20), (x, r * rh + rh - 16)], fill="black"); d.text((x - 10, r * rh + rh - 14), f"{s // 60}:{s % 60:02d}", fill="black")
    pts = [xy(t, v, r) for t, v in rows if r * span <= t < (r + 1) * span]
    if len(pts) > 1: d.line(pts, fill=(0, 0, 200), width=2)
    for st, name in starts:
        if r * span <= st < (r + 1) * span:
            x = xy(st, 0, r)[0]; d.line([(x, y0), (x, r * rh + rh - 20)], fill=(220, 0, 0)); d.text((x + 2, y0), name[:22], fill=(150, 0, 0))
im.save(out_png); print(out_png)
vals = np.array([v for _, v in rows[:-12]]); print(f"seconds measured {len(vals)}, median {np.median(vals):.1f}, under 60% of median: {int((vals < 0.6 * np.median(vals)).sum())}")
