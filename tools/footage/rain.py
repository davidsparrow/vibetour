"""rain.py <plate.mp4> <out.mp4> [car dir]: rain on the windshield and the wipers clearing it, drawn into a 1280x720 plate.

The reference for the renderer's windshield-rain layer (the standard puts rain on the glass in VibeTour, never in the
footage). Drops land on the windshield at RAIN drops a second (900, steady rain). Each one is a little lens that shows
the scene behind it upside down and blurred, with a dark rim and a highlight. Big drops run down the glass and leave
a trail of small ones. The two wipers, from the car's "wipers" in car.json, sweep every WIPE seconds (1.6) and clear
every drop in their path. Drops and wipers are placed in cockpit coordinates and mapped into the plate the way
composite.sh maps the plate into the cockpit (scale 1.125, offset 120,119), so they sit on the car's glass."""
import json, os, sys, cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]
car = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else os.environ.get("CAR", os.path.join(os.path.dirname(__file__), "../../cars/touring-sedan"))
RATE = float(os.environ.get("RAIN", 900)); WIPE = float(os.environ.get("WIPE", 1.6))
cfg = json.load(open(os.path.join(car, "car.json")))
wip = cfg["wipers"]; S, OX, OY = 1.125, 120, 119            # composite.sh: plate scaled 1.125, cropped at (120, 119)
to_plate = lambda x, y: ((x + OX) / S, (y + OY) / S)
pivots = [to_plate(*p) for p in wip["pivots"]]; reach = wip["reach"] / S
park, sweep = np.radians(wip.get("park", 6)), np.radians(wip.get("sweep", 150))
W, H = 1280, 720
gm = cv2.imread(os.path.join(car, "glass-mask.png"), cv2.IMREAD_GRAYSCALE)
glass = cv2.warpAffine(gm, np.float32([[S, 0, -OX], [0, S, -OY]]), (W, H), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR) > 128
gy, gx = np.nonzero(glass)
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 24
vw = cv2.VideoWriter(out + ".tmp.mp4", cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
rng = np.random.default_rng(3)
# Drops: x, y, radius, fall speed (px/s, 0 = clinging), wobble phase.
D = np.zeros((0, 5), np.float32)
yy0, xx0 = np.mgrid[:H, :W].astype(np.float32)

def angle(t):
    """Wiper angle above the parked position: up over 40% of the cycle, back over 40%, parked for the rest."""
    u = (t % WIPE) / WIPE
    s = u / 0.4 if u < 0.4 else (1 - (u - 0.4) / 0.4 if u < 0.8 else 0)
    return park + sweep * (0.5 - 0.5 * np.cos(np.pi * np.clip(s, 0, 1)))

def wiped(D, a0, a1):
    """Which drops a blade passed over between angles a0 and a1 (the blade covers 28-100% of the arm's reach)."""
    lo, hi = min(a0, a1) - 0.02, max(a0, a1) + 0.02; hit = np.zeros(len(D), bool)
    for px, py in pivots:
        dx, dy = D[:, 0] - px, py - D[:, 1]; r = np.hypot(dx, dy); a = np.arctan2(dy, dx)
        hit |= (r > reach * 0.28) & (r < reach) & (a >= lo) & (a <= hi)
    return hit

stamps = {}
def stamp(r):
    """Per-pixel offsets, alpha, rim and highlight for a drop of radius r (rounded to 0.5 px)."""
    k = round(r * 2) / 2
    if k not in stamps:
        n = int(np.ceil(k)) + 1; yy, xx = np.mgrid[-n:n + 1, -n:n + 1].astype(np.float32); d = np.hypot(xx, yy) / k
        alpha = np.clip((1.0 - d) * k * 1.5, 0, 1)
        rim = np.clip((d - 0.55) / 0.45, 0, 1) ** 2 * (yy > -0.3 * k)      # darker at the lower edge
        hl = np.exp(-(((xx + 0.35 * k) ** 2 + (yy + 0.4 * k) ** 2) / (0.09 * k * k + 0.3)))
        stamps[k] = (n, xx, yy, alpha, rim, hl)
    return stamps[k]

prev_a = angle(0); f = 0
while True:
    ok, frame = cap.read()
    if not ok: break
    frame = cv2.resize(frame, (W, H)); t = f / fps
    # New drops, landing anywhere on the glass.
    n = rng.poisson(RATE / fps); i = rng.integers(0, len(gx), n)
    r = np.clip(rng.lognormal(0.95, 0.45, n), 1.2, 8.0)
    new = np.stack([gx[i] + rng.random(n), gy[i] + rng.random(n), r, np.zeros(n), rng.uniform(0, 6, n)], 1).astype(np.float32)
    D = np.vstack([D, new])
    # Big drops start to run down the glass; running drops leave small ones behind them.
    start = (D[:, 2] > 4.5) & (D[:, 3] == 0) & (rng.random(len(D)) < 0.04)
    D[start, 3] = rng.uniform(35, 110, start.sum())
    run = D[:, 3] > 0
    if run.any():
        trail = D[run & (rng.random(len(D)) < 0.35)].copy()
        trail[:, 2] = rng.uniform(1.0, 2.0, len(trail)); trail[:, 3] = 0
        D[run, 1] += D[run, 3] / fps
        D[run, 0] += np.sin(t * 3 + D[run, 4]) * 0.35
        D[run, 2] = np.minimum(D[run, 2] + 0.01, 9.0)
        D = np.vstack([D, trail])
    # The wipers clear what they pass over.
    a = angle(t); D = D[~wiped(D, prev_a, a)]
    # Off the glass, or too many: drop the oldest.
    xi, yi = D[:, 0].astype(int), D[:, 1].astype(int)
    keep = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
    keep[keep] &= glass[yi[keep], xi[keep]]
    D = D[keep][-3500:]
    # Render: each drop shows the blurred scene behind it, upside down and widened, with a rim and a highlight.
    blur = cv2.GaussianBlur(frame, (0, 0), 2.2).astype(np.float32)
    mx, my = xx0.copy(), yy0.copy(); A = np.zeros((H, W), np.float32); RIM = np.zeros((H, W), np.float32); HL = np.zeros((H, W), np.float32)
    for x, y, rr, vy, _ in D:
        n_, sx, sy, al, rim, hl = stamp(rr)
        cx, cy = int(x), int(y); x0, y0, x1, y1 = cx - n_, cy - n_, cx + n_ + 1, cy + n_ + 1
        if x0 < 0 or y0 < 0 or x1 > W or y1 > H: continue
        stretch = 1.0 + min(vy / 60, 1.2) * (sy < 0)                    # a running drop has a tail above it
        sel = np.maximum(A[y0:y1, x0:x1], al) == al
        mx[y0:y1, x0:x1] = np.where(sel, x - sx * 2.6, mx[y0:y1, x0:x1])
        my[y0:y1, x0:x1] = np.where(sel, y - sy * 2.6 * stretch - rr * 3, my[y0:y1, x0:x1])
        A[y0:y1, x0:x1] = np.maximum(A[y0:y1, x0:x1], al)
        RIM[y0:y1, x0:x1] = np.maximum(RIM[y0:y1, x0:x1], rim * al)
        HL[y0:y1, x0:x1] = np.maximum(HL[y0:y1, x0:x1], hl * al)
    lens = cv2.remap(blur, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    img = frame.astype(np.float32) * (1 - A[..., None]) + (lens * 1.05 + 6) * A[..., None]
    img *= (1 - 0.5 * RIM)[..., None]; img += (HL * 55)[..., None]
    # A faint wet sheen over the whole glass between wipes: the scene softens a little as water builds up.
    film = min(((t % WIPE) / WIPE), 1.0) * 0.12
    img = np.where(glass[..., None], img * (1 - film) + blur * film, img)
    # The wiper blades: dark rubber on a thin arm. A moving blade smears into a translucent band over the angle it
    # swept this frame, as a camera's shutter sees it; a parked or turning blade is solid.
    blades = np.zeros((H, W), np.float32)
    lo, hi = min(prev_a, a), max(prev_a, a)
    for px, py in pivots:
        if hi - lo > 0.01:
            arc = np.linspace(lo, hi, 12)
            outer = [(px + np.cos(q) * reach * 0.98, py - np.sin(q) * reach * 0.98) for q in arc]
            inner = [(px + np.cos(q) * reach * 0.28, py - np.sin(q) * reach * 0.28) for q in arc[::-1]]
            band = np.zeros((H, W), np.float32)
            cv2.fillPoly(band, [np.int32(outer + inner)], 1.0, cv2.LINE_AA)
            blades = np.maximum(blades, band * float(np.clip(7 / (reach * 0.6 * (hi - lo)), 0.12, 0.9)))
        p0 = (int(px + np.cos(a) * reach * 0.28), int(py - np.sin(a) * reach * 0.28))
        p1 = (int(px + np.cos(a) * reach * 0.98), int(py - np.sin(a) * reach * 0.98))
        line = np.zeros((H, W), np.float32)
        cv2.line(line, p0, p1, 1.0, 7, cv2.LINE_AA); cv2.line(line, (int(px), int(py)), p0, 1.0, 4, cv2.LINE_AA)
        blades = np.maximum(blades, line * (0.55 if hi - lo > 0.01 else 1.0))
    blades = blades[..., None]
    img = img * (1 - blades * 0.92) + 18 * blades * 0.92
    vw.write(np.clip(img, 0, 255).astype(np.uint8)); prev_a = a; f += 1
vw.release()
os.system(f'ffmpeg -v error -y -i "{out}.tmp.mp4" -c:v libx264 -crf 18 -pix_fmt yuv420p "{out}" && rm "{out}.tmp.mp4"')
print(f"{out}: {f} frames, rain {RATE:.0f}/s, wipe every {WIPE} s")
