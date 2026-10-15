"""mirror.py <cockpit.png> <out.png> [visible]: hang a generated cockpit's rear-view mirror from the top edge of the frame.

Image models draw the rear-view mirror well down the windshield, often on a big overhead console, and it takes a large
piece of the view that people pay to see. The mirror sits on flat chroma-key green, so it cuts cleanly: this finds the
mirror's glass (a keyed region that isn't the windshield, in the upper right), takes the mirror with its bezel, paints
its old place and its stalk green, and pastes it so that only `visible` (0.5) of its height is in frame, hanging from
the top edge with no stalk or console. Run before the cabin edit, so both stills match."""
import sys, cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]; visible = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
im = cv2.imread(src); h, w = im.shape[:2]
b, g, r = (im[:, :, i].astype(int) for i in range(3))
green = ((g > 150) & (r < 120) & (b < 120)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(green, 8)
big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
cands = [i for i in range(1, n) if i != big and st[i, cv2.CC_STAT_AREA] > 0.001 * w * h and st[i, cv2.CC_STAT_LEFT] > 0.5 * w and st[i, cv2.CC_STAT_TOP] < 0.4 * h]
if not cands: sys.exit("no mirror glass found: a keyed region in the upper right that isn't the windshield")
mi = max(cands, key=lambda i: st[i, cv2.CC_STAT_AREA]); gx, gy, gw, gh, _ = st[mi]
# The mirror body: the non-green pixels connected to the glass's surround, within a margin of the glass.
mg = int(0.035 * w)
x0, y0, x1, y1 = max(0, gx - mg), max(0, gy - mg), min(w, gx + gw + mg), min(h, gy + gh + mg)
body = (green[y0:y1, x0:x1] == 0).astype(np.uint8)
nb, lb, sb, _ = cv2.connectedComponentsWithStats(body, 8)
ring = cv2.dilate((lab[y0:y1, x0:x1] == mi).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
keep = np.isin(lb, [i for i in range(1, nb) if (ring & (lb == i)).any()])
ys, xs = np.nonzero(keep); by0, by1, bx0, bx1 = ys.min() + y0, ys.max() + y0 + 1, xs.min() + x0, xs.max() + x0 + 1
# Cut the mirror (glass and bezel) and the stalk above it, and fill their place with the key colour.
cut = im[by0:by1, bx0:bx1].copy(); mask = (keep[by0 - y0:by1 - y0, bx0 - x0:bx1 - x0] | (lab[by0:by1, bx0:bx1] == mi)).astype(np.uint8)
im[by0:by1, bx0:bx1][mask > 0] = (0, 255, 0)
# The stalk: non-green above the mirror, between it and the headliner, whose bottom edge is where the columns just
# outside the mirror turn green from the top.
def first_green(x): col = np.nonzero(green[:, x])[0]; return int(col[0]) if len(col) else 0
top = max(first_green(max(0, bx0 - 8)), first_green(min(w - 1, bx1 + 8)))
im[top:by0, bx0:bx1][green[top:by0, bx0:bx1] == 0] = (0, 255, 0)
# Paste the mirror hanging from the top edge, with `visible` of its height in frame; its top, with any stalk, is off frame.
H = by1 - by0; ny0 = -int(round(H * (1 - visible)))
src_rows = slice(-ny0, H); dst = im[0:H + ny0, bx0:bx1]
m3 = mask[src_rows][:, :, None] > 0
dst[:] = np.where(m3, cut[src_rows], dst)
cv2.imwrite(out, im)
vis = (lab[by0:by1, bx0:bx1] == mi)[src_rows]
yy, xx = np.nonzero(vis)
print(f"{out}: mirror {bx1 - bx0}x{H} px moved up {-ny0 + by0} px; visible glass box [{bx0 + xx.min()}, {yy.min()}, {xx.max() - xx.min() + 1}, {yy.max() - yy.min() + 1}]")
