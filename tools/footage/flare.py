"""Lens-flare layer for the cockpit composite. Reads the plate, applies the composite's plate transform
(1440x810 -> crop 1200x675 at 240,119 -> pad to 1200x896), finds the sun as the brightest blob in the sky,
and renders a flare on black: bloom, anamorphic streak and ghost spots on the line through frame centre.
Usage: flare.py <plate.mp4> <out.mp4> [strength]"""
import sys, cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]; strength = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 24
W, H = 1200, 896; cx, cy = W/2, 0.42*675
wr = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
sun = None; inten = 0.0
def ghost(img, x, y, r, color, a):
    g = np.zeros_like(img); cv2.circle(g, (int(x), int(y)), int(r), color, -1, cv2.LINE_AA)
    g = cv2.GaussianBlur(g, (0, 0), max(1, r*0.25)); return cv2.add(img, (g*a).astype(np.uint8))
while True:
    ok, fr = cap.read()
    if not ok: break
    p = cv2.resize(fr, (1440, 810))[119:119+675, 120:120+1200]
    lum = cv2.cvtColor(p, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sky = cv2.GaussianBlur(lum[:int(675*0.65)], (0, 0), 6)
    m = sky.max(); target = 0.0
    hotmask = sky > 250; hot = int(hotmask.sum())
    if m >= 253 and hot > 40:
        hy, hx = np.where(hotmask); bw, bh = hx.max()-hx.min()+1, hy.max()-hy.min()+1
        fill = hot / float(bw*bh); aspect = max(bw, bh) / float(min(bw, bh))
        # a sun is one round clipping blob; cloud banks are irregular, elongated or spread out
        if fill > 0.45 and aspect < 1.8 and max(bw, bh) < 520:
            ys, xs = np.where(sky > m - 3); x, y = xs.mean(), ys.mean()
            target = min(1.0, hot / 3000.0)
            sun = (x, y) if sun is None else (sun[0]*0.8 + x*0.2, sun[1]*0.8 + y*0.2)
    inten += (target - inten) * 0.1
    f = np.zeros((H, W, 3), np.uint8)
    if sun is not None and inten > 0.02:
        x, y = sun; a = inten * strength
        f = ghost(f, x, y, 140, (200, 230, 255), 0.9*a)          # bloom (BGR: warm white)
        f = ghost(f, x, y, 60, (230, 245, 255), 1.0*a)
        s = np.zeros_like(f); cv2.line(s, (0, int(y)), (W, int(y)), (255, 210, 160), 3, cv2.LINE_AA)
        s = cv2.GaussianBlur(s, (0, 0), 9); f = cv2.add(f, (s*0.55*a).astype(np.uint8))   # anamorphic streak (bluish)
        dx, dy = cx - x, cy - y
        for k, r, col, al in [(0.45, 26, (90, 170, 255), 0.35), (0.8, 40, (255, 190, 120), 0.25), (1.15, 18, (120, 255, 190), 0.3), (1.5, 58, (255, 160, 200), 0.18), (1.9, 30, (90, 200, 255), 0.25)]:
            f = ghost(f, x + dx*k, y + dy*k, r, col, al*a)
    wr.write(f)
wr.release(); print("flare written", out, "final intensity", round(inten, 2))
