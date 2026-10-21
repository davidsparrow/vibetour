"""spray.py <in.mp4> <out.mp4> <mist.csv> [car dir]: sea spray carried onto the car, after the composite (1280x720).

Where the waves throw spray up beside the road, the wind carries it across as a mist you feel more than see. mist.csv
gives its strength per frame (frame,mist, 0..1; session.sh writes it from MIST). The mist:
- settles on the windshield as very fine droplets that build up into a faint veil, brighter where the light behind is
  bright; when they have built up, the wipers make one sweep and clear them, and once more after the spray has gone;
- beads on the front of the door mirror's silver housing (found in the cabin still: the low-saturation, bright shell
  beside the mirror glass), where nothing wipes it, drying off slowly;
- speckles the door mirror's glass a little.
The wipers are the car's (car.json "wipers"), drawn through the windshield only. Rain is rain.py's job; this is mist.
"""
import json, os, sys
import cv2
import numpy as np
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from vwrite import Reader, Writer

src, out, csv = sys.argv[1], sys.argv[2], sys.argv[3]
car = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else os.environ.get("CAR", os.path.join(os.path.dirname(__file__), "../../cars/grand-tourer"))
cfg = json.load(open(os.path.join(car, "car.json")))
W, H, S = 1280, 720, 1280 / 1200                       # the composite: cockpit scaled by 16/15, top 675 rows
RATE = float(os.environ.get("MISTRATE", 2600))         # droplets a second on the windshield at full mist
mist = [float(l.split(",")[1]) for l in open(csv).read().split("\n")[1:] if l]


def to_out(img, interp=cv2.INTER_LINEAR):
    return cv2.resize(img, (W, round(896 * S)), interpolation=interp)[:H]


glass = to_out(cv2.imread(os.path.join(car, "glass-mask.png"), cv2.IMREAD_GRAYSCALE)) > 128
cabin = cv2.imread(os.path.join(car, "cabin.png"))
hsv = cv2.cvtColor(cabin, cv2.COLOR_BGR2HSV)
green = (hsv[..., 0] > 45) & (hsv[..., 0] < 75) & (hsv[..., 1] > 120)
sx, sy, sw, sh = cfg["mirrors"]["side"]
region = np.zeros(green.shape, bool)
region[max(sy - 30, 0): sy + sh + 40, 0: sx + sw + 120] = True
silver = (~green & (hsv[..., 1] < 60) & (hsv[..., 2] > 70) & region).astype(np.uint8)
n_, lab, st, _ = cv2.connectedComponentsWithStats(silver)
housing_c = (lab == 1 + np.argmax(st[1:, 4])) if n_ > 1 else np.zeros_like(region)
housing = to_out(cv2.morphologyEx(housing_c.astype(np.uint8) * 255, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))) > 128
mglass = to_out(cv2.imread(os.path.join(car, "mirror-mask.png"), cv2.IMREAD_GRAYSCALE)) > 128
mglass &= np.arange(W)[None, :] < (sx + sw) * S + 4      # the door mirror only, not the rear-view
wip = cfg["wipers"]
pivots = [(x * S, y * S) for x, y in wip["pivots"]]
reach = wip["reach"] * S
park, sweep = np.radians(wip.get("park", 6)), np.radians(wip.get("sweep", 150))
CYCLE = 1.6

gy, gx = np.nonzero(glass)
# The wipers' reach, worked out once: each pixel's distance and angle from each pivot.
yy_, xx_ = np.mgrid[:H, :W].astype(np.float32)
POLAR = [(np.hypot(xx_ - px, py - yy_), np.arctan2(py - yy_, xx_ - px)) for px, py in pivots]
del yy_, xx_
hy, hx = np.nonzero(housing)
my_, mx_ = np.nonzero(mglass)
rng = np.random.default_rng(11)
# Persistent layers: droplet cover (alpha), their highlights and their dark lower rims.
A, HL, RIM = (np.zeros((H, W), np.float32) for _ in range(3))
BA, BHL, BRIM = (np.zeros((H, W), np.float32) for _ in range(3))     # beads on the housing and the mirror glass


def stamp(LA, LH, LR, xs, ys, rs):
    for x, y, r in zip(xs, ys, rs):
        n = int(np.ceil(r)) + 1
        x0, y0 = int(x) - n, int(y) - n
        if x0 < 0 or y0 < 0 or x0 + 2 * n + 1 > W or y0 + 2 * n + 1 > H:
            continue
        yy, xx = np.mgrid[-n:n + 1, -n:n + 1].astype(np.float32)
        yy += int(y) - y; xx += int(x) - x
        d = np.hypot(xx, yy) / r
        al = np.clip(1.2 - d, 0, 1) * 0.85
        hl = np.exp(-((xx + 0.35 * r) ** 2 + (yy + 0.35 * r) ** 2) / (0.12 * r * r + 0.15))
        rim = np.clip((d - 0.4) / 0.6, 0, 1) * (yy > 0) * al
        sl = (slice(y0, y0 + 2 * n + 1), slice(x0, x0 + 2 * n + 1))
        LA[sl] = np.maximum(LA[sl], al); LH[sl] = np.maximum(LH[sl], hl * al); LR[sl] = np.maximum(LR[sl], rim)


def blade_angle(u):
    s = u / 0.4 if u < 0.4 else (1 - (u - 0.4) / 0.4 if u < 0.8 else 0)
    return park + sweep * (0.5 - 0.5 * np.cos(np.pi * np.clip(s, 0, 1)))


ys, xs = np.nonzero(housing | mglass)
BOX = (max(ys.min() - 6, 0), min(ys.max() + 6, H), max(xs.min() - 6, 0), min(xs.max() + 6, W)) if len(ys) else (0, 1, 0, 1)
cap = Reader(src)
fps = cap.fps
vw = Writer(out, fps, (W, H))
since, wipe_t, quiet, f = 0, None, 0.0, 0
prev_a = park
while True:
    ok, frame = cap.read()
    if not ok:
        break
    t = f / fps
    m = mist[min(f, len(mist) - 1)] if mist else 0.0
    if m > 0.01:
        n = rng.poisson(RATE * m / fps)
        i = rng.integers(0, len(gx), n)
        heavy = 1 + 0.5 * max(m - 1, 0)                    # MIST=<clip>:heavy drenches the glass: more and bigger droplets
        stamp(A, HL, RIM, gx[i] + rng.random(n), gy[i] + rng.random(n), np.clip(rng.lognormal(0.0, 0.35, n) * heavy, 0.7, 3.2))
        since += n
        nb = rng.poisson(40 * m / fps)                      # the housing faces the wind: it collects beads quickly
        if len(hx) and nb:
            j = rng.integers(0, len(hx), nb)
            stamp(BA, BHL, BRIM, hx[j] + rng.random(nb), hy[j] + rng.random(nb), np.clip(rng.lognormal(0.4, 0.35, nb), 0.8, 2.8))
        nm = rng.poisson(25 * m / fps)
        if len(mx_) and nm:
            j = rng.integers(0, len(mx_), nm)
            stamp(BA, BHL, BRIM, mx_[j] + rng.random(nm), my_[j] + rng.random(nm), np.clip(rng.lognormal(-0.3, 0.3, nm), 0.5, 1.4))
        quiet = 0.0
    else:
        quiet += 1 / fps
    # One sweep when the mist has built up, and one to clear the last of it once the spray has gone.
    if wipe_t is None and (since > RATE * 7 or (since > RATE * 0.8 and abs(quiet - 2.5) < 0.5 / fps)):     # let the mist build before a sweep
        wipe_t, since = t, 0
    a = park
    if wipe_t is not None:
        u = (t - wipe_t) / CYCLE
        if u >= 1:
            wipe_t = None
        else:
            a = blade_angle(u)
            lo, hi = min(prev_a, a) - 0.02, max(prev_a, a) + 0.02
            for r, ang in POLAR:
                hit = (r > reach * 0.28) & (r < reach) & (ang >= lo) & (ang <= hi)
                A[hit] = 0; HL[hit] = 0; RIM[hit] = 0
    # Once the spray has gone, the mist the wipers don't reach dries off over about twenty seconds, and the beads over a minute.
    if quiet > 2:
        A *= 0.996; HL *= 0.996; RIM *= 0.996
        A[A < 0.02] = 0; HL[A == 0] = 0; RIM[A == 0] = 0
    if quiet > 4:
        BA *= 0.999; BHL *= 0.999; BRIM *= 0.999
    wet, beads = A.max() > 0.01, BA.max() > 0.01
    if not wet and not beads and wipe_t is None:            # nothing on the car: the frame goes through untouched
        vw.write(frame); prev_a = a; f += 1
        continue
    img = frame.astype(np.float32)
    if wet:
        blur = cv2.GaussianBlur(frame, (0, 0), 2.0).astype(np.float32)
        veil = np.clip(cv2.GaussianBlur(A, (0, 0), 5) * 1.7, 0, 0.8)     # a milky film the wipers' arc cuts a clear window into
        small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (W // 8, H // 8), interpolation=cv2.INTER_AREA).astype(np.float32)
        bright = cv2.resize(cv2.GaussianBlur(small, (0, 0), 3), (W, H)) / 255.0
        g = glass[..., None]
        img = np.where(g, img * (1 - veil[..., None]) + (blur * 1.02 + 22 + 60 * bright[..., None]) * veil[..., None], img)
        a3 = (A * g[..., 0])[..., None]
        img = img * (1 - a3 * 0.35) + blur * a3 * 0.35
        img *= (1 - 0.35 * RIM * glass)[..., None]
        img += (HL * glass * (30 + 60 * bright))[..., None]
    if beads:
        # Beads: a bright point and a dark edge each, on the silver and on the mirror glass (only that corner of the frame).
        y0, y1, x0, x1 = BOX
        sub = img[y0:y1, x0:x1]
        bl = cv2.GaussianBlur(frame[y0:y1, x0:x1], (0, 0), 2.0).astype(np.float32)
        ba = BA[y0:y1, x0:x1, None]
        sub *= (1 - 0.45 * BRIM[y0:y1, x0:x1])[..., None]
        sub += (BHL[y0:y1, x0:x1] * 70)[..., None]
        img[y0:y1, x0:x1] = sub * (1 - ba * 0.2) + bl * ba * 0.2
    if wipe_t is not None:
        blades = np.zeros((H, W), np.float32)
        for px, py in pivots:
            p0 = (int(px + np.cos(a) * reach * 0.28), int(py - np.sin(a) * reach * 0.28))
            p1 = (int(px + np.cos(a) * reach * 0.98), int(py - np.sin(a) * reach * 0.98))
            cv2.line(blades, p0, p1, 1.0, 7, cv2.LINE_AA)
            cv2.line(blades, (int(px), int(py)), p0, 1.0, 4, cv2.LINE_AA)
        blades = (blades * glass)[..., None]
        img = img * (1 - blades * 0.92) + 18 * blades * 0.92
    vw.write(np.clip(img, 0, 255).astype(np.uint8))
    prev_a = a
    f += 1
vw.release()
print(f"{out}: {f} frames, sea spray mist")
