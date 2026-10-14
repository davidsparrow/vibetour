"""glass.py <composite.mp4> <out.mp4> [car dir]: water and light on the side glass, after composite.sh.

WET=1 (rain, or a wet road) puts water on every pane rain.py doesn't reach:
- the side window: drops land from the spray and the wind pushes them back and a little up, out of the frame on the
  left; water blown off the windshield streams round the A-pillar and gathers in a band of beads along the window's
  front and top edges; the view through it softens a little
- the door mirror: fine drops that the wind and gravity push down and out, collecting along the bottom of the rim
- the rear-view mirror: it shows the rear window, which is wet too, so a few soft, out-of-focus drops come and go

NIGHT=1 turns lamps seen through the side window into red taillights. The side window shows the far left of the
forward plate, which is still ahead of us, so a car that is level with the door mirror still showed its headlights
there; a car beside us has passed, and what we'd see is its back.

Works on the composite's 1280x720 frame: composite.sh crops the 1200x896 cockpit to 1200x675 and scales by 16/15."""
import json, os, sys, cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]
car = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else os.environ.get("CAR", os.path.join(os.path.dirname(__file__), "../../cars/grand-tourer"))
WET, NIGHT = os.environ.get("WET") == "1", os.environ.get("NIGHT") == "1"
cfg = json.load(open(os.path.join(car, "car.json")))
W, H, K = 1280, 720, 16 / 15
def mask(name, box=None):
    m = cv2.imread(os.path.join(car, name), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    if box:
        x, y, w, h = box; keep = np.zeros_like(m); keep[max(0, y - 4):y + h + 4, max(0, x - 4):x + w + 4] = 1; m *= keep
    return cv2.resize(m[:675], (W, H), interpolation=cv2.INTER_AREA)
side = mask("side-window-mask.png"); door = mask("mirror-mask.png", cfg["mirrors"]["side"]); rear = mask("mirror-mask.png", cfg["mirrors"]["rear"])
rng = np.random.default_rng(5)

class Pane:
    """Drops on one pane: they land at `rate` a second, move at `drift(r)` px/s and stick where the pane ends."""
    def __init__(s, m, rate, rsize, drift, cap, life=None, soft=0.0, where=None):
        s.m = m > 0.5; s.ys, s.xs = np.nonzero(s.m if where is None else where); s.rate, s.rsize, s.drift, s.cap, s.life, s.soft = rate, rsize, drift, cap, life, soft
        s.D = np.zeros((0, 6), np.float32)          # x, y, r, moving (0/1), age, lifetime
    def step(s, dt):
        n = rng.poisson(s.rate * dt)
        if n and len(s.xs):
            i = rng.integers(0, len(s.xs), n); r = np.clip(rng.lognormal(*s.rsize, n), 0.5, 6)
            life = rng.uniform(*s.life, n) if s.life else np.full(n, 1e9)
            s.D = np.vstack([s.D, np.stack([s.xs[i] + rng.random(n), s.ys[i] + rng.random(n), r, np.ones(n), np.zeros(n), life], 1)])
        mv = s.D[:, 3] > 0
        if mv.any():
            vx, vy = s.drift(s.D[mv, 2])
            nx = s.D[mv, 0] + (vx + rng.normal(0, 4, mv.sum())) * dt; ny = s.D[mv, 1] + (vy + rng.normal(0, 3, mv.sum())) * dt
            xi, yi = np.clip(nx.astype(int), 0, W - 1), np.clip(ny.astype(int), 0, H - 1)
            ok = s.m[yi, xi]
            idx = np.nonzero(mv)[0]
            gone = idx[~ok & ((nx < 1) | (ny < 1))]                  # blown off the edge of the frame
            s.D[gone, 4] = 1e10
            s.D[idx[ok], 0], s.D[idx[ok], 1] = nx[ok], ny[ok]
            s.D[idx[~ok], 3] = 0                        # reached the edge: it stays there and grows a little
            s.D[idx[~ok], 2] = np.minimum(s.D[idx[~ok], 2] * 1.15, 5)
        s.D[:, 4] += dt
        s.D = s.D[s.D[:, 4] < s.D[:, 5]][-s.cap:]

stamps = {}
def stamp(r, soft):
    k = (round(r * 2) / 2, soft)
    if k not in stamps:
        rr = k[0]; n = int(np.ceil(rr * (1 + soft))) + 1
        yy, xx = np.mgrid[-n:n + 1, -n:n + 1].astype(np.float32); d = np.hypot(xx, yy) / rr
        alpha = np.clip((1 - d) * rr * 1.5, 0, 1) if not soft else np.clip(1 - d / (1 + soft), 0, 1) ** 1.2 * 0.8
        rim = np.clip((d - 0.55) / 0.45, 0, 1) ** 2 * (yy > -0.3 * rr) * (0.35 if soft else 1)
        hl = np.exp(-(((xx + 0.35 * rr) ** 2 + (yy + 0.4 * rr) ** 2) / (0.09 * rr * rr + 0.3))) * (0.6 if soft else 1)
        stamps[k] = (n, xx, yy, alpha, rim, hl)
    return stamps[k]

panes = []
if WET:
    # The side window's front and top edges: where the A-pillar and the roof meet the glass.
    sm = side > 0.5
    xs_ = np.arange(W)[None, :].repeat(H, 0); right = np.where(sm, xs_, -1).max(1)
    front = np.zeros_like(sm); top = np.zeros_like(sm)
    for y in range(H):
        if right[y] > 0: front[y, max(0, right[y] - 14):right[y] + 1] = sm[y, max(0, right[y] - 14):right[y] + 1]
    first = np.argmax(sm, 0)
    for x in range(W):
        if sm[:, x].any(): top[first[x]:first[x] + 10, x] = sm[first[x]:first[x] + 10, x]
    panes = [Pane(side, 150, (0.85, 0.45), lambda r: (-(30 + 25 * r), -(5 + 4 * r)), 1400),
             Pane(side, 90, (1.1, 0.35), lambda r: (-(6 + 2 * r), -(3 + r)), 700, where=front | top),
             Pane(door, 70, (0.35, 0.4), lambda r: (-(3 + 3 * r), 3 + 5 * r), 450),        # wind and gravity: to the bottom rim
             Pane(rear, 22, (1.25, 0.3), lambda r: (0 * r, 0 * r), 110, life=(2.5, 7.0), soft=0.9)]
    for p in panes:                                     # start already wet
        for _ in range(int(4 * 24)): p.step(1 / 24)
yy0, xx0 = np.mgrid[:H, :W].astype(np.float32)
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 24
vw = cv2.VideoWriter(out + ".tmp.mp4", cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H)); f = 0
while True:
    ok, frame = cap.read()
    if not ok: break
    img = frame.astype(np.float32)
    if NIGHT:
        # Anything bright in the side window is a car beside or behind us. Its headlights now point behind us, so their
        # glare, and the road they lit, go dark; each lamp's core becomes a small red taillight.
        lum = img.mean(2); sat = img.max(2) - img.min(2)
        glare = cv2.GaussianBlur(np.clip((lum - 45) / 90, 0, 1) * np.clip(1.4 - sat / 110, 0, 1) * side, (0, 0), 2.0)
        img = img * (1 - 0.88 * glare[..., None])
        core = ((lum > 200) & (side > 0.5)).astype(np.uint8)
        n_, lab, st, cen = cv2.connectedComponentsWithStats(core, 8)
        tl = np.zeros((H, W), np.float32)
        for i in range(1, n_):
            w_, h_ = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
            if st[i, cv2.CC_STAT_AREA] < 3 or max(w_, h_) > 2.5 * max(min(w_, h_), 1): continue   # lane-line glints
            r = float(np.clip(np.sqrt(st[i, cv2.CC_STAT_AREA]) * 0.3, 1.5, 5.0))
            cv2.circle(tl, (int(cen[i][0] * 8), int(cen[i][1] * 8)), int(r * 8), 1.0, -1, cv2.LINE_AA, 3)
        tl = np.clip(tl + cv2.GaussianBlur(tl, (0, 0), 3.0) * 0.8, 0, 1) * side
        img = img * (1 - tl[..., None]) + tl[..., None] * np.float32([28, 22, 235])
    if WET:
        for p in panes: p.step(1 / fps)
        blur = cv2.GaussianBlur(img, (0, 0), 2.0); blur2 = cv2.GaussianBlur(img, (0, 0), 6.0)
        # Wet glass softens the view through it.
        film = side * 0.35 + door * 0.30 + rear * 0.18
        img = img * (1 - film[..., None]) + blur * film[..., None]
        mx, my = xx0.copy(), yy0.copy(); A = np.zeros((H, W), np.float32); RIM = np.zeros_like(A); HL = np.zeros_like(A); S = np.zeros_like(A)
        for p in panes:
            for x, y, r, *_ in p.D:
                n_, sx, sy, al, rim, hl = stamp(r, p.soft)
                cx, cy = int(x), int(y); x0, y0, x1, y1 = cx - n_, cy - n_, cx + n_ + 1, cy + n_ + 1
                if x0 < 0 or y0 < 0 or x1 > W or y1 > H: continue
                sel = al >= A[y0:y1, x0:x1]
                mx[y0:y1, x0:x1] = np.where(sel, x - sx * 2.4, mx[y0:y1, x0:x1])
                my[y0:y1, x0:x1] = np.where(sel, y - sy * 2.4 - r * 2, my[y0:y1, x0:x1])
                A[y0:y1, x0:x1] = np.maximum(A[y0:y1, x0:x1], al); S[y0:y1, x0:x1] = np.maximum(S[y0:y1, x0:x1], al * (p.soft > 0))
                RIM[y0:y1, x0:x1] = np.maximum(RIM[y0:y1, x0:x1], rim * al); HL[y0:y1, x0:x1] = np.maximum(HL[y0:y1, x0:x1], hl * al)
        src_ = blur * (1 - S[..., None]) + blur2 * S[..., None]
        lens = cv2.remap(src_, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        glassm = np.clip(side + door + rear, 0, 1)
        A *= glassm; RIM *= glassm; HL *= glassm
        light = cv2.GaussianBlur(img.mean(2), (0, 0), 8) / 255             # highlights are as bright as the light around
        img = img * (1 - A[..., None]) + (lens * 1.04 + 4) * A[..., None]
        img *= (1 - 0.45 * RIM)[..., None]; img += (HL * (25 + 110 * light))[..., None]
    vw.write(np.clip(img, 0, 255).astype(np.uint8)); f += 1
vw.release()
os.system(f'ffmpeg -v error -y -i "{out}.tmp.mp4" -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart "{out}" && rm "{out}.tmp.mp4"')
print(f"{out}: {f} frames" + (", wet side glass and mirrors" if WET else "") + (", side-window lamps as taillights" if NIGHT else ""))
