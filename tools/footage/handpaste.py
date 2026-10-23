"""handpaste.py <cockpit.png> <edit.png> <out-cockpit.png> <out-hands-mask.png>: take new hands and forearms from an
image edit of the cockpit still (gloves, sleeves) and paste only them into the still.

An image model's edit re-renders the whole picture a little (dial numerals, wood grain), so the edit is not used as the
still: only the pixels of the hands and arms come across. The hands in the original are found as skin (YCrCb), grown
a little; everything in the edit that differs clearly from the original and touches that region (a glove's cuff and
strap, a sleeve that is wider than the bare arm) comes with them. The mask is feathered and written out, so wheel.py
can use it instead of its skin test (HANDS=<mask>): gloves and sleeves are not skin-coloured.
The edit is resized to the still's size if it is larger (edits are made at 2K from the 1200 px still)."""
import sys
import cv2
import numpy as np

src, edit, out, out_mask = sys.argv[1:5]
a = cv2.imread(src)
b = cv2.imread(edit)
if b.shape[:2] != a.shape[:2]:
    b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
ycc = cv2.cvtColor(a, cv2.COLOR_BGR2YCrCb)
skin = cv2.inRange(ycc, (40, 133, 77), (255, 180, 135))
skin = cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(skin, 8)
big = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 1500]            # the hands and forearms, not wood highlights
skin = np.isin(lab, big).astype(np.uint8) * 255
skin = cv2.dilate(skin, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
la = cv2.cvtColor(a.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
lb = cv2.cvtColor(b.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
d = cv2.GaussianBlur(np.linalg.norm(la - lb, axis=2), (0, 0), 1.5)
diff = (d > 10).astype(np.uint8) * 255
diff = cv2.morphologyEx(diff, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
# Differences that touch the grown skin region come along; islands elsewhere (a redrawn numeral) do not.
n, lab, st, _ = cv2.connectedComponentsWithStats(diff, 8)
touch = [i for i in range(1, n) if (skin[lab == i] > 0).any()]
near = np.isin(lab, touch).astype(np.uint8) * 255
mask = cv2.max(skin, near)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
# Fill holes and feather the edge.
n, lab, st, _ = cv2.connectedComponentsWithStats(255 - mask, 8)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 4000 and st[i, cv2.CC_STAT_TOP] > 0:
        mask[lab == i] = 255
soft = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 2.0)[..., None]
res = (a * (1 - soft) + b * soft).astype(np.uint8)
cv2.imwrite(out, res)
cv2.imwrite(out_mask, (soft[..., 0] * 255).astype(np.uint8))
print(f"{out}: {int((mask > 0).sum())} px of hands and arms pasted from the edit; mask {out_mask}")
