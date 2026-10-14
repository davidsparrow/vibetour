"""wheel.py <cockpit.png> <cabin.png> <hx> <hy> <radius> <out-mask.png>: the wheel-and-hands matte for car-build.sh.

The matte is where the two stills differ (CIE Lab distance), so it follows the hands and forearms wherever they go: a
low threshold inside the wheel's disc, where the black rim sits over a dark cluster, and a higher one outside it, kept
only where it touches the wheel. Islands elsewhere (an edit that moved a seat belt) are dropped, holes smaller than the
hub's centre are filled, and the edge is feathered by a pixel. An earlier matte clipped everything to the disc and two
forearm bands, which cut the backs of the hands off and let the cabin's vents show through them."""
import sys, cv2, numpy as np
cockpit, cabin, hx, hy, r, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
a = cv2.imread(cockpit); b = cv2.imread(cabin)
b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
la = cv2.cvtColor(a.astype(np.float32) / 255, cv2.COLOR_BGR2LAB); lb = cv2.cvtColor(b.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
d = cv2.GaussianBlur(np.linalg.norm(la - lb, axis=2), (0, 0), 1.2)
h, w = d.shape
yy, xx = np.mgrid[:h, :w]
disc = (xx - hx) ** 2 + (yy - hy) ** 2 < r * r
# Inside the disc the rim is black on black, so take small differences. Outside it, only clear differences that are
# skin-coloured: the forearms. The cabin edit also repainted part of the door panel beside the left arm, and that
# piece swung into view when the wheel turned.
ycc = cv2.cvtColor(a, cv2.COLOR_BGR2YCrCb)
skin = cv2.inRange(ycc, (40, 133, 77), (255, 180, 135))
skin = cv2.dilate(cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)), np.ones((7, 7), np.uint8)) > 0
m = np.where(disc, d > 7, (d > 12) & skin).astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
# Keep the big components that reach into the wheel's inner disc: the wheel itself and the arms holding it. Small ones
# there are cluster details (a needle) that would turn with the wheel.
n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
inner = (xx - hx) ** 2 + (yy - hy) ** 2 < (r * 0.85) ** 2
big = stats[1:, cv2.CC_STAT_AREA].max() if n > 1 else 0
keep = np.zeros(n, bool)
for i in range(1, n):
    keep[i] = stats[i, cv2.CC_STAT_AREA] > 0.05 * big and inner[lab == i].any()
m = keep[lab].astype(np.uint8)
# Fill enclosed holes smaller than the hub's centre; the openings that show the cluster are far bigger and stay open.
holes = (1 - m).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(holes, 4)
for i in range(1, n):
    x, y, bw, bh, area = stats[i]
    if area < 9000 and x > 0 and y > 0 and x + bw < w and y + bh < h:
        m[lab == i] = 1
# The top of the rim can touch the windshield's bottom seal in the still, and a sliver of the seal comes along as a
# flat top on the rim. Fit an ellipse to the rim's outer edge away from the top centre and drop what lies outside it
# above the hub, so the rim stays round when the wheel is moved up in front of the glass (car.json "wheel.offset").
xs = [x for x in range(int(hx - r * 0.85), int(hx + r * 0.85)) if abs(x - hx) > r * 0.3 and m[:hy, x].any()]
edge = np.array([(x, int(np.argmax(m[:hy, x]))) for x in xs], np.float32)
if len(edge) >= 20:
    (ex, ey), (ea, eb), ang = cv2.fitEllipse(edge)
    inside = np.zeros_like(m); cv2.ellipse(inside, ((ex, ey), (ea + 2, eb + 2), ang), 1, -1)
    m[:hy] &= inside[:hy]
alpha = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.0)
cv2.imwrite(out, np.clip(alpha * 255, 0, 255).astype(np.uint8))
print(f"{out}: {m.mean():.1%} of the frame")
