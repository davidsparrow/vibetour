"""dirt.py <glass-mask.png> <out.png> [seed]: the dust, smudges and wiper arcs on a car's windshield, for car-build.sh.

The texture is dark almost everywhere. The composite multiplies it by the plate's blurred highlights and adds it, so it
only shows where bright light is behind the glass: the sun, a white sky, oncoming headlights. That is how a real
windshield looks, and it is what makes "the sun flares off the windshield". The two wipers sweep arcs from pivots
below the glass; inside the arcs the glass is cleaner, with fine streaks along the sweep, and dirt collects at the
arcs' outer edges. Outside them there is more dust."""
import sys, cv2, numpy as np
mask = cv2.imread(sys.argv[1], cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 7)
h, w = mask.shape
ys, xs = np.nonzero(mask > 0.5); bottom = ys.max(); left, right = xs.min(), xs.max(); top = ys.min()
gw, gh = right - left, bottom - top
yy, xx = np.mgrid[:h, :w].astype(np.float32)
# Wiper pivots just below the glass, a third and two thirds of the way across; each sweeps about 0.55 of the width.
pivots = [(left + gw * 0.30, bottom + gh * 0.08), (left + gw * 0.68, bottom + gh * 0.08)]
reach = gw * 0.42
def noise(scale, octaves=3):
    """Smooth value noise in 0..1, from blurred random fields."""
    n = np.zeros((h, w), np.float32)
    for o in range(octaves):
        s = scale / 2 ** o
        f = cv2.resize(rng.random((max(2, int(h / s)), max(2, int(w / s)))).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
        n += f / 2 ** o
    n -= n.min(); return n / n.max()
swept = np.zeros((h, w), np.float32); streaks = np.zeros((h, w), np.float32); edge = np.zeros((h, w), np.float32)
for px, py in pivots:
    r = np.hypot(xx - px, yy - py); th = np.arctan2(yy - py, xx - px)
    swept = np.maximum(swept, (r < reach).astype(np.float32))
    # Fine streaks along the sweep: faint partial arcs at random radii, each fading in and out along its length.
    for _ in range(45):
        r0 = rng.uniform(reach * 0.25, reach * 0.98); t0 = rng.uniform(-np.pi, 0); span = rng.uniform(0.15, 0.9)
        along = np.clip(1 - np.abs(((th - t0 + np.pi) % (2 * np.pi)) - np.pi) / span, 0, 1)
        streaks += np.exp(-((r - r0) / 0.7) ** 2) * along * rng.uniform(0.02, 0.07)
    # Dirt piles up in a ragged band where each wiper stops.
    rr = reach + (noise(40) - 0.5) * 14
    edge = np.maximum(edge, np.exp(-((r - rr) / 7.0) ** 2) * (0.03 + 0.08 * noise(25)))
# Dust: specks, denser where the wipers don't reach.
dust = np.zeros((h, w), np.float32)
n = int(w * h * 0.0035)
px = rng.integers(0, w, n); py = rng.integers(0, h, n)
keep = rng.random(n) < np.where(swept[py, px] > 0, 0.35, 1.0)
dust[py[keep], px[keep]] = rng.uniform(0.3, 1.0, keep.sum())
dust = cv2.GaussianBlur(dust, (0, 0), 0.8) * 2
# Smudges: a few large soft patches.
smudge = np.zeros((h, w), np.float32)
for _ in range(14):
    cx, cy = rng.uniform(left, right), rng.uniform(top, bottom)
    s = rng.uniform(25, 70)
    smudge += np.exp(-(((xx - cx) / s) ** 2 + ((yy - cy) / (s * rng.uniform(0.4, 1))) ** 2)) * rng.uniform(0.04, 0.12)
# Haze builds up towards the bottom of the glass, as it does on any car.
haze = np.clip((yy - top) / gh, 0, 1) ** 2 * 0.25
tex = np.clip(dust + smudge + streaks + edge + haze, 0, 1) * mask
cv2.imwrite(sys.argv[2], (tex * 255).astype(np.uint8))
print(sys.argv[2], f"mean {tex[mask > 0.5].mean():.3f}")
