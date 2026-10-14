"""masks.py <transparent.png> <glass-out.png> <mirrors-out.png>: split a keyed cockpit's glass into the windshield
(the largest transparent region) and the mirrors (the other regions of 800-30000 px² not touching the top or left edge)."""
import sys, cv2, numpy as np
src, glass_out, mirror_out = sys.argv[1:4]
t = cv2.imread(src, cv2.IMREAD_GRAYSCALE)
_, bw = cv2.threshold(t, 127, 255, cv2.THRESH_BINARY)
n, lab, stats, _ = cv2.connectedComponentsWithStats(bw, 8)
areas = stats[1:, cv2.CC_STAT_AREA]; largest = 1 + int(np.argmax(areas))
mirror = np.zeros_like(bw)
for i in range(1, n):
    x, y, w, h, a = stats[i]
    if i == largest or a < 800 or a > 30000 or x == 0 or y == 0: continue
    print(f"mirror region {i}: x={x} y={y} w={w} h={h} area={a}")
    mirror[lab == i] = 255
cv2.imwrite(mirror_out, cv2.GaussianBlur(mirror, (3, 3), 0))
glass = np.zeros_like(bw); glass[lab == largest] = 255
cv2.imwrite(glass_out, glass)
