"""deorb.py <in.png> <out.png> <x,y,r> [<x,y,r>…]: paint lens-flare orbs out of a still's sky before it is animated.

Each orb is a disc at (x, y) of radius r in pixels. The sky in a ring around it is fitted with a smooth quadratic
gradient per channel, the disc is replaced with that gradient plus grain matched to the ring, and the edge is
feathered. Use it on clear sky only: anything else in the ring (a branch, a wire) gets smeared into the fit."""
import sys, cv2, numpy as np
img = cv2.imread(sys.argv[1]).astype(np.float32); out = img.copy(); h, w = img.shape[:2]
rng = np.random.default_rng(1)
for spec in sys.argv[3:]:
    x, y, r = map(int, spec.split(","))
    R = int(r * 1.8); x0, y0, x1, y1 = max(0, x - R), max(0, y - R), min(w, x + R), min(h, y + R)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32); d = np.hypot(xx - x, yy - y)
    ring = (d > r * 1.15) & (d < R)
    u, v = (xx - x) / R, (yy - y) / R
    A = np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1)
    patch = out[y0:y1, x0:x1].copy(); fill = np.empty_like(patch)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A[ring], patch[..., c][ring], rcond=None)
        fit = A @ coef; noise = (patch[..., c][ring] - fit[ring]).std()
        fill[..., c] = fit + rng.normal(0, noise, fit.shape)
    a = np.clip((r * 1.15 - d) / (r * 0.3), 0, 1)[..., None]
    out[y0:y1, x0:x1] = patch * (1 - a) + fill * a
cv2.imwrite(sys.argv[2], np.clip(out, 0, 255).astype(np.uint8))
print(sys.argv[2])
