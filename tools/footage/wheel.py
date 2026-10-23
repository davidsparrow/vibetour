"""wheel.py <cockpit.png> <cabin.png> <hx> <hy> <radius> <out-mask.png>: the wheel-and-hands matte for car-build.sh.

The matte is where the two stills differ (CIE Lab distance), so it follows the hands and forearms wherever they go: a
low threshold inside the wheel's disc, where the black rim sits over a dark cluster, and a higher one outside it, kept
only where it touches the wheel. Islands elsewhere (an edit that moved a seat belt) are dropped, holes smaller than the
hub's centre are filled, and the edge is feathered by a pixel. An earlier matte clipped everything to the disc and two
forearm bands, which cut the backs of the hands off and let the cabin's vents show through them."""
import os, sys, cv2, numpy as np
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
# Gloved hands and sleeves are not skin-coloured: HANDS=<mask.png> (from handpaste.py) says where they are instead.
if os.environ.get("HANDS"):
    skin = cv2.dilate(cv2.imread(os.environ["HANDS"], cv2.IMREAD_GRAYSCALE), np.ones((7, 7), np.uint8)) > 64
m = np.where(disc, d > 7, (d > 12) & skin).astype(np.uint8)
# Inside the instrument cluster (CLUSTER=x:y:w:h from car.json) the cabin edit re-draws the dials a little differently,
# and a bezel that differs by a few units would turn with the wheel: there only clear differences count for bright
# pixels. The rim and hands over the cluster differ clearly.
# A black rim over a dark cluster differs only a little, so dark pixels keep the low threshold; the bright bezels and
# numerals need the clear one.
if os.environ.get("CLUSTER"):
    kx, ky, kw, kh = (int(v) for v in os.environ["CLUSTER"].split(":"))
    bright = a[ky:ky + kh, kx:kx + kw].max(axis=2) > 110
    m[ky:ky + kh, kx:kx + kw] &= (d[ky:ky + kh, kx:kx + kw] > 20) | ~bright
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
# near the top of the rim, so the rim stays round when the wheel is moved up in front of the glass (car.json "wheel.offset").
xs = [x for x in range(int(hx - r * 0.85), int(hx + r * 0.85)) if abs(x - hx) > r * 0.3 and m[:hy, x].any()]
edge = np.array([(x, int(np.argmax(m[:hy, x]))) for x in xs], np.float32)
if len(edge) >= 20:
    (ex, ey), (ea, eb), ang = cv2.fitEllipse(edge)
    inside = np.zeros_like(m); cv2.ellipse(inside, ((ex, ey), (ea + 2, eb + 2), ang), 1, -1)
    top = int(hy - r * 0.6)                  # the top of the rim only: the hands at 9 and 3 reach outside the rim
    m[:top] &= inside[:top]
# The rim itself can go missing where it lies over something as dark as itself in the cabin still (the touring sedan's
# black rim over the dark binnacle at 2 o'clock), and the bite only shows when the wheel turns and the dash appears
# through it. The cockpit still has the rim there, so fill it by geometry. On each ray from the hub, the rim is the
# outermost stretch of matte pixels with no gap over 3 px (so perforated leather doesn't end it). Rays that end
# on a hand or a forearm (outer end off the fitted ellipse) or run down a spoke are left alone. Where the rim's inner edge
# jumps outward and stays out until it jumps back, or runs into a hand, within 40 degrees, a piece of the rim is missing:
# those rays are filled in to the inner edge they jumped from.
def ray(th):
    rs = np.arange(int(r * 0.5), int(r * 1.3)); xs_ = np.clip((hx + rs * np.cos(th)).astype(int), 0, w - 1); ys_ = np.clip((hy + rs * np.sin(th)).astype(int), 0, h - 1)
    return rs, m[ys_, xs_] > 0
pts = []
for th in np.radians(np.arange(0, 360, 1.0)):
    rs, on = ray(th)
    if not on.any(): continue
    o = int(np.nonzero(on)[0][-1]); i = o
    while i > 0 and on[max(0, i - 4):i].any(): i -= 1          # a gap of up to 3 px (perforations) doesn't end the rim
    pts.append((th, rs[o], rs[i]))
pts = np.array(pts)
if len(pts) >= 60:
    th, ro, ri = pts[:, 0], pts[:, 1], pts[:, 2]
    ok = np.abs(ro - np.median(ro)) < 0.08 * r
    for _ in range(2):
        (ex, ey), (ea, eb), ang = cv2.fitEllipse(np.array([(hx + a_ * np.cos(t_), hy + a_ * np.sin(t_)) for t_, a_ in zip(th[ok], ro[ok])], np.float32))
        ca, sa = np.cos(np.radians(ang)), np.sin(np.radians(ang))
        px, py = hx + ro * np.cos(th) - ex, hy + ro * np.sin(th) - ey
        ok = np.abs(np.sqrt(((px * ca + py * sa) / (ea / 2)) ** 2 + ((-px * sa + py * ca) / (eb / 2)) ** 2) - 1) < 0.05
    thick = ro - ri; rim = ok & (thick < 0.35 * r)
    dang = lambda a_, b_: np.abs((a_ - b_ + np.pi) % (2 * np.pi) - np.pi)
    # A bite shows as the inner edge jumping outward from one rim ray to the next and staying out until it jumps back
    # or the rays run into a hand, all within 40 degrees. The rim's own shape (a thick grip, a thin lower rim) changes
    # gradually. Walked both ways round, so a bite on either side of a hand is found.
    fill = np.zeros_like(m); idx = np.nonzero(rim)[0]; bitten = []
    adj = lambda a_, b_: dang(th[a_], th[b_]) < np.radians(3)
    for order in (idx, idx[::-1]):
        for j_ in range(3, len(order)):
            k, base3 = order[j_], order[j_ - 3:j_]
            # The base: three adjacent rim rays, none down a spoke, with a steady inner edge.
            if not all(adj(base3[q], base3[q + 1]) for q in range(2)) or not adj(base3[-1], k): continue
            if (thick[base3] > 0.25 * r).any() or np.ptp(ri[base3]) > 0.04 * r: continue
            base = float(np.median(ri[base3]))
            if ri[k] - base <= 0.08 * r: continue
            run, q = [k], j_ + 1
            while q < len(order) and adj(order[q], order[q - 1]) and ri[order[q]] > base + 0.06 * r and dang(th[order[q]], th[k]) < np.radians(40): run.append(order[q]); q += 1
            if q < len(order) and dang(th[order[q]], th[k]) >= np.radians(40): continue      # too long to be a bite
            bitten += [(q_, base) for q_ in run]
    for k, r_in in bitten:
        for t_ in th[k] + np.radians(np.arange(-0.5, 0.5, 0.2)):
            rs = np.arange(int(r_in), int(ro[k]) + 1)
            fill[np.clip((hy + rs * np.sin(t_)).astype(int), 0, h - 1), np.clip((hx + rs * np.cos(t_)).astype(int), 0, w - 1)] = 1
    fill = cv2.morphologyEx(fill, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    added = int((fill & (m == 0)).sum()); m |= fill
    print(f"rim: outer edge {ea / 2:.0f}x{eb / 2:.0f} px about ({ex:.0f}, {ey:.0f}), {rim.sum()} of {len(th)} rays cross it, {len(set(k for k, _ in bitten))} bitten, filled {added} px")
    if added > 400: print(f"WARNING: the rim fill added {added} px: the matte had a bite out of the rim", file=sys.stderr)
# Guard: skin that differs between the two stills, near the wheel, belongs to the hands and arms. If much of it is
# missing from the matte the cabin's vents and dash show through the hands, which happened twice while this was tuned.
near = (xx - hx) ** 2 + (yy - hy) ** 2 < (r * 1.8) ** 2
lost = int(((d > 12) & skin & near & (m == 0)).sum())
if lost > 800: print(f"WARNING: {lost} px of hand or arm are missing from the wheel matte", file=sys.stderr)
alpha = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.0)
cv2.imwrite(out, np.clip(alpha * 255, 0, 255).astype(np.uint8))
print(f"{out}: {m.mean():.1%} of the frame")
