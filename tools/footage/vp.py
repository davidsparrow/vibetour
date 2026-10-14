"""vp.py <still.png> [<out.png> [<width>x<height> [<at>]]]: find the road's vanishing point from its lane and edge lines,
and optionally crop a 16:9 band (as wide as fits) that puts it at the horizontal centre and <at> of the way down (default
0.45, the standard's 43-47%), scaled to the size given (default 1280x720). Prints the vanishing point and the crop, and
writes <out>-check.png to show what it found. A still with no lane lines (a stop facing the view) is taken to have its
horizon at the centre, as the anchor prompts ask; set CENTRE=1 to assume that for any stop still, whose forecourt or
parking lines would mislead the search."""
import os, sys, cv2, numpy as np


def find_vp(img):
    """The road's vanishing point (x, y) in pixels from its painted lane lines, the line segments used, and the number
    of left-right line pairs that agreed; None for the point if there are no lines. drift.py uses it on video frames."""
    h, w = img.shape[:2]
    # Lane lines are long, straight and painted white or yellow: look for them in the lower 55% of the frame, on a mask
    # of paint-coloured pixels, so tar-sealed cracks, shadows and guardrails don't count.
    y0 = int(h * 0.45)
    hsv = cv2.cvtColor(cv2.GaussianBlur(img[y0:], (5, 5), 0), cv2.COLOR_BGR2HSV)
    H_, S_, V_ = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    white = (V_ > np.percentile(V_, 90)) & (S_ < 60)
    yellow = (H_ >= 12) & (H_ <= 38) & (S_ > 90) & (V_ > 110)
    paint = ((white | yellow) * 255).astype(np.uint8)
    edges = cv2.Canny(cv2.morphologyEx(paint, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)), 60, 160)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 80, minLineLength=int(h * 0.12), maxLineGap=20)
    segs = []
    for x1, y1, x2, y2 in (lines.reshape(-1, 4) if lines is not None else []):
        if x1 == x2: continue
        m = (y2 - y1) / (x2 - x1)
        if 0.25 < abs(m) < 4: segs.append((x1, y1 + y0, x2, y2 + y0, m))
    left = [s for s in segs if s[4] < 0]; right = [s for s in segs if s[4] > 0]
    pts = []
    for a in left:
        for b in right:
            (x1, y1, _, _, m1), (x3, y3, _, _, m2) = a, b
            x = (y3 - y1 + m1 * x1 - m2 * x3) / (m1 - m2); y = y1 + m1 * (x - x1)
            if 0 <= x < w and h * 0.2 < y < h * 0.8: pts.append((x, y))
    vp = tuple(np.median(np.array(pts), axis=0)) if pts else None
    return vp, segs, len(pts), (len(left), len(right))


if __name__ == "__main__":
    src = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else None
    W, H = map(int, (sys.argv[3] if len(sys.argv) > 3 else "1280x720").split("x"))
    AT = float(sys.argv[4]) if len(sys.argv) > 4 else 0.45
    img = cv2.imread(src); h, w = img.shape[:2]
    vp, segs, n, (nl, nr) = find_vp(img)
    if vp and not os.environ.get("CENTRE"):
        vx, vy = vp
        print(f"{src}: vanishing point x={vx:.0f} ({vx / w:.0%}) y={vy:.0f} ({vy / h:.0%}) from {n} line pairs")
    else:
        vx, vy = w / 2, h / 2
        why = "CENTRE=1" if os.environ.get("CENTRE") else f"no vanishing point found ({nl} left, {nr} right lines)"
        print(f"{src}: {why}; assuming the centre")
    if out:
        # The tallest 16:9 band with the point AT of the way down and centred, inside the frame.
        bh = min(h, w * 9 / 16, vy / AT, (h - vy) / (1 - AT), 2 * min(vx, w - vx) * 9 / 16)
        bw = bh * 16 / 9; x = vx - bw / 2; y = vy - AT * bh
        print(f"crop {bw:.0f}x{bh:.0f} at {x:.0f},{y:.0f} -> {W}x{H}" + (" (upscaled)" if bw < W else ""))
        band = img[int(round(y)):int(round(y + bh)), int(round(x)):int(round(x + bw))]
        cv2.imwrite(out, cv2.resize(band, (W, H), interpolation=cv2.INTER_LANCZOS4))
        chk = img.copy()
        for x1, y1, x2, y2, _ in segs: cv2.line(chk, (int(x1), int(y1)), (int(x2), int(y2)), (0, 0, 255), 2)
        cv2.circle(chk, (int(vx), int(vy)), 12, (255, 0, 255), 3)
        cv2.rectangle(chk, (int(x), int(y)), (int(x + bw), int(y + bh)), (0, 255, 255), 3)
        cv2.imwrite(out.rsplit(".", 1)[0] + "-check.png", chk)
