"""regress.py <build.mp4> [<previous build.mp4>] : prove that a rebuilt tour changed only where it was meant to.

A tour is rebuilt from thirty-odd clips, and a fix to one of them must not touch the others. Two checks, both from the
build's input list (<build>.inputs.json, which build_trip.sh writes beside each build: every clip in order, its md5 and
its duration):
1. The changed list: every clip whose md5 differs from the previous build's, or is new, or has gone. It must equal the
   list of clips meant to change (EXPECT=<names, comma-separated, or parts of them>; a name matches any clip whose file name
   contains it). Anything else that changed is a regression.
2. The frames: for every clip that is unchanged in both builds, the windshield region (the car's glass mask) of a few
   frames of the new build is compared with the same frames of the previous build, shifted by the clip's new start time.
   The mean absolute difference, taken at a quarter size so the per-build film grain averages out, must be at encode-noise
   level (NOISE, 6 of 255; about 3-4 was measured between fx-20 and fx-22 on a held clip). More than that means the plate, the steering or the dissolve changed under an untouched clip.
CARRY=<names> marks unchanged clips expected to carry an effect from the clip before (the mist drying off, the wipers' last
sweep), reported but not failed. Exits 1 on any regression. CAR picks the car whose glass mask is used (default cars/grand-tourer)."""
import hashlib, json, os, subprocess, sys
import cv2
import numpy as np

new, old = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
NOISE = float(os.environ.get("NOISE", 6)); EXPECT = [x for x in os.environ.get("EXPECT", "").split(",") if x]
CARRY = [x for x in os.environ.get("CARRY", "").split(",") if x]      # unchanged clips that carry an effect from a changed neighbour (mist drying, the wipers' last sweep)
car = os.environ.get("CAR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../cars/grand-tourer"))


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def duration(c):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", c], capture_output=True, text=True).stdout)


def inputs(build):
    return json.load(open(build[:-4] + ".inputs.json" if build.endswith(".mp4") else build + ".inputs.json"))


def timeline(items):
    """Each clip's start in the build: the dissolves overlap by 1 s."""
    t, out = 0.0, []
    for it in items:
        out.append(t); t += it["duration"] - 1.0
    return out


if len(sys.argv) > 1 and sys.argv[1] == "write":        # regress.py write <build.mp4> <clip…>: the inputs list, for build scripts
    build, clips = sys.argv[2], sys.argv[3:]
    items = [{"name": os.path.basename(c), "path": os.path.abspath(c), "md5": md5(c), "duration": duration(c)} for c in clips]
    json.dump(items, open(build[:-4] + ".inputs.json", "w"), indent=1); print(f"{build}: {len(items)} inputs listed"); sys.exit(0)

A = inputs(new); print(f"{os.path.basename(new)}: {len(A)} clips")
if not old: sys.exit(0)
B = inputs(old); bmap = {b["name"]: b for b in B}; amap = {a["name"]: a for a in A}
changed = [a["name"] for a in A if a["name"] not in bmap or bmap[a["name"]]["md5"] != a["md5"]]
gone = [b["name"] for b in B if b["name"] not in amap]
bad = [n for n in changed + gone if not any(e in n for e in EXPECT)]
print("changed or new:", ", ".join(changed) or "none"); print("gone:", ", ".join(gone) or "none")
print("unexpected:", ", ".join(bad) or "none")
# The frames of every unchanged clip, through the windshield.
mask = cv2.imread(os.path.join(car, "glass-mask.png"), cv2.IMREAD_GRAYSCALE)
mask = cv2.resize(mask[:675], (1280, 720), interpolation=cv2.INTER_AREA) > 128
small = cv2.resize(mask.astype(np.uint8) * 255, (320, 180), interpolation=cv2.INTER_AREA) > 128
ta, tb = timeline(A), timeline(B)
capa, capb = cv2.VideoCapture(new), cv2.VideoCapture(old)
fps = capa.get(cv2.CAP_PROP_FPS) or 24


def frame(cap, t):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps))); ok, f = cap.read()
    return cv2.resize(f, (1280, 720)) if ok else None


worst, rows = 0.0, []
for i, a in enumerate(A):
    if a["name"] in changed or a["name"] not in bmap: continue
    j = [k for k, b in enumerate(B) if b["name"] == a["name"]][0]
    diffs = []
    for frac in (0.3, 0.5, 0.7):                       # inside the clip, clear of both dissolves
        t = frac * a["duration"]
        fa, fb = frame(capa, ta[i] + t), frame(capb, tb[j] + t)
        if fa is None or fb is None: continue
        # Compared at a quarter size: the composite's film grain is random per build and would read as 8 of 255 on its own.
        sa, sb = (cv2.resize(x, (320, 180), interpolation=cv2.INTER_AREA).astype(np.float32) for x in (fa, fb))
        d = np.abs(sa - sb).mean(2); diffs.append(float(d[small].mean()))
    m = max(diffs) if diffs else float("nan"); worst = max(worst, m)
    rows.append((a["name"], m))
carry = lambda n: any(c in n for c in CARRY)
for n, m in rows: print(f"  {n:45s} windshield diff {m:5.1f} {'carry (an effect from the clip before)' if m > NOISE and carry(n) else 'REGRESSION' if m > NOISE else 'ok'}")
regress = [n for n, m in rows if m > NOISE and not carry(n)]
print(f"frames: {len(rows)} unchanged clips compared, worst {worst:.1f} of 255 (limit {NOISE:.0f}); " + ("ALL OK" if not regress and not bad else "REGRESSION in " + ", ".join(regress + bad)))
sys.exit(1 if regress or bad else 0)
