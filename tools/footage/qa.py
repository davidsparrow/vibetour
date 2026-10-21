"""qa.py <clip.mp4>… : the automated checks on a tour's clips, as a table.

For every clip:
- freeze: the longest span where frame-to-frame difference stays near zero (under FREEZE, 1.5 of 255 at 336 px wide) for
  more than 0.5 s while the clip is meant to be moving (a hold, or a span where the clip's .speed.csv is below 0.05, is
  allowed to stand still). A plate that opens still and then jumps reads as stopping on the highway for no reason.
- cut: a hard cut inside the clip: ffmpeg's scene score above CUT (0.3) more than 0.3 s from either end.
- drift: drift.py's verdict (the vanishing point off centre: warn at 12%, fail at 20% of the width); not for a hold,
  whose road runs beside the parked car.
- height: for a stop still or hold (a clip named *hold*, or HEIGHT=1): the seated-height test. From a driver's eye about
  1.1 m up, a standing adult's head is above the horizon at any distance. People are found with YOLOX-S (traffic.py's
  model, the COCO person class) in the first frame; the horizon is the frame's vertical centre, where the stop stills put
  it (vp.py CENTRE=1), unless a sea line stands out as the strongest long horizontal edge in the middle band.
  Pass: every head above the horizon. Borderline: a head within 2% of the height below it. Fail: lower.
Exits 1 if any check fails. Writes <clip>.qa.json beside each clip and prints one row per clip."""
import json, os, subprocess, sys
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vp import find_vp
import traffic

FREEZE, CUT = float(os.environ.get("FREEZE", 1.5)), float(os.environ.get("CUT", 0.3))
PERSON = 0


def speeds(clip, n):
    csv = clip + ".speed.csv"
    if os.path.exists(csv):
        rows = [float(l.split(",")[1]) for l in open(csv).read().split("\n")[1:] if l]
        return [rows[min(k, len(rows) - 1)] for k in range(n)]
    name = os.path.basename(clip)
    return [0.0] * n if "hold" in name and "checkpoint" not in name else [1.0] * n


def freeze(clip):
    cap = cv2.VideoCapture(clip); fps = cap.get(cv2.CAP_PROP_FPS) or 24; prev = None; d = []
    while True:
        ok, f = cap.read()
        if not ok: break
        g = cv2.cvtColor(cv2.resize(f, (336, 192)), cv2.COLOR_BGR2GRAY).astype(np.float32)
        if prev is not None: d.append(float(np.abs(g - prev).mean()))
        prev = g
    sp = speeds(clip, len(d) + 1)
    best, run, start = (0.0, 0.0), 0, 0
    for k, x in enumerate(d):
        if x < FREEZE and sp[k] > 0.05:
            run += 1
            if run / fps > best[0]: best = (run / fps, (k - run + 1) / fps)
        else: run = 0
    return best, fps, len(d) + 1


def cuts(clip, fps, n):
    out = subprocess.run(["ffmpeg", "-v", "info", "-i", clip, "-vf", "select='gt(scene,0)',metadata=print", "-an", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    times, scores = [], []
    for line in out.split("\n"):
        if "pts_time" in line: times.append(float(line.split("pts_time:")[1].split()[0]))
        if "lavfi.scene_score" in line: scores.append(float(line.split("=")[-1]))
    length = n / fps
    hits = [(t, s) for t, s in zip(times, scores) if s > CUT and 0.3 < t < length - 0.3]
    return hits


def drift(clip):
    r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "drift.py"), clip], capture_output=True, text=True).stdout.strip().split("\n")[0]
    v = "none" if "no lane lines" in r else r.split(": ")[1].split(",")[0]
    return v, r


def horizon(frame):
    """The sea line: the row of the strongest long horizontal edge in the middle band; else the vertical centre."""
    h, w = frame.shape[:2]; g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
    band = g[int(h * 0.3):int(h * 0.65), int(w * 0.25):int(w * 0.75)]
    dy = np.abs(np.diff(band, axis=0)).mean(1)
    dy = cv2.GaussianBlur(dy.reshape(-1, 1), (0, 0), 1.5).ravel()
    k = int(np.argmax(dy))
    if dy[k] < 4 * np.median(dy): return h * 0.5, "centre"
    return int(h * 0.3) + k, "sea line"


def height(clip):
    cap = cv2.VideoCapture(clip); ok, f = cap.read()
    if not ok: return "?", "no frame"
    det = height.det = getattr(height, "det", None) or traffic.detector()
    traffic.VEHICLES[PERSON] = "person"           # borrow the detector for people
    people = [b for b, kind, s in det(f) if kind == "person" and s > 0.4]
    del traffic.VEHICLES[PERSON]
    hz, how = horizon(f); h = f.shape[0]
    if not people: return "none", f"no people found; horizon at {hz / h:.0%} ({how})"
    heads = [b[1] * h for b in people]            # the top of each box
    worst = max(heads) - hz                       # positive: below the horizon
    v = "pass" if worst <= 0 else "borderline" if worst < 0.02 * h else "FAIL"
    return v, f"{len(people)} people, lowest head {-worst / h * 100:+.1f}% of the height from the horizon ({how})"


rows, bad = [], False
for clip in sys.argv[1:]:
    name = os.path.basename(clip)
    (fz, fz_t), fps, n = freeze(clip)
    ct = cuts(clip, fps, n)
    ishold = ("hold" in name and "checkpoint" not in name) or os.environ.get("HEIGHT") == "1"
    dv, dline = ("hold", "parked: the road runs beside the car, so its vanishing point is off centre by design") if ishold else drift(clip)
    hv, hline = height(clip) if ishold else ("-", "")
    fail = fz > 0.5 or bool(ct) or dv == "FAIL" or hv == "FAIL"
    bad |= fail
    rows.append({"clip": name, "freeze_s": round(fz, 2), "freeze_at": round(fz_t, 2), "cuts": [(round(t, 2), round(s, 2)) for t, s in ct],
                 "drift": dv, "drift_detail": dline, "height": hv, "height_detail": hline, "verdict": "FAIL" if fail else "ok"})
    json.dump(rows[-1], open(clip + ".qa.json", "w"), indent=1)
print(f"{'clip':45s} {'freeze':>8s} {'cuts':>6s} {'drift':>6s} {'height':>10s}  verdict")
for r in rows:
    fz = f"{r['freeze_s']:.1f}s@{r['freeze_at']:.0f}" if r["freeze_s"] > 0.5 else "-"
    print(f"{r['clip']:45s} {fz:>8s} {str(len(r['cuts'])) if r['cuts'] else '-':>6s} {r['drift']:>6s} {r['height']:>10s}  {r['verdict']}" + (f"   {r['height_detail']}" if r["height"] not in ("-",) else ""))
sys.exit(1 if bad else 0)
