"""Derive a steering track from a forward plate: camera yaw per frame from dense optical flow.
Writes <out>.cmd (ffmpeg sendcmd for rotate's angle) and <out>.csv (t, dx, angle_deg)."""
import os, sys, cv2, numpy as np
src, out, max_deg = sys.argv[1], sys.argv[2], float(sys.argv[3])
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 24
W, H = 320, 180
ok, prev = cap.read(); prev = cv2.cvtColor(cv2.resize(prev, (W, H)), cv2.COLOR_BGR2GRAY)
dxs = []
while True:
    ok, fr = cap.read()
    if not ok: break
    g = cv2.cvtColor(cv2.resize(fr, (W, H)), cv2.COLOR_BGR2GRAY)
    flow = cv2.calcOpticalFlowFarneback(prev, g, None, 0.5, 3, 21, 3, 5, 1.2, 0)
    # Yaw shows as the same horizontal shift everywhere; driving forward adds an outward flow that grows with distance
    # from the vanishing point and with nearness. A median over the whole horizon band was pulled by whichever side was
    # nearer: on the Big Sur cliffs the hillside on the left streamed past while the sea on the right stood still, and
    # a left-hand curve read as a hard right. So measure only near the vanishing point (the middle 30% of the width,
    # 30-56% down, with the horizon at 45%), where forward flow is small, and only on textured pixels: flat sky and sea
    # report no motion whatever the camera does.
    y0, y1, x0, x1 = int(H*0.30), int(H*0.56), int(W*0.35), int(W*0.65)
    band = flow[y0:y1, x0:x1, 0]
    gx = np.abs(cv2.Sobel(g[y0:y1, x0:x1], cv2.CV_32F, 1, 0, ksize=3))
    tex = gx > 12
    dxs.append(float(np.median(band[tex])) if tex.sum() > 40 else float(np.median(band)))
    prev = g
dx = np.array(dxs)
# A car passing through the window (a camper van, a tow truck) makes a spike of a few frames: a running median over
# 0.4 s removes it before the smoothing.
r = max(1, int(fps * 0.2)); dx = np.array([np.median(dx[max(0, i - r):i + r + 1]) for i in range(len(dx))])
# smooth: a steering input lags and smooths the road; ~0.5 s box then ~0.3 s exponential
k = max(1, int(fps*0.5)); dx_s = np.convolve(dx, np.ones(k)/k, mode="same")
ema = np.zeros_like(dx_s); a = 1/(fps*0.3)
for i in range(len(dx_s)): ema[i] = dx_s[i] if i == 0 else ema[i-1] + a*(dx_s[i]-ema[i-1])
# scene moving left (dx<0) means the car is turning right: wheel clockwise (positive angle in ffmpeg)
# A fixed gain, not one scaled to each clip's peak: full lock at 0.25 px/frame of yaw (at 320 px wide), so a straight road
# keeps the wheel near centre, a gentle curve turns it a few degrees and a hairpin turns it to max_deg. LOCK overrides.
lock = float(os.environ.get("LOCK", 0.25))
ang = np.clip(-ema/lock*max_deg, -max_deg, max_deg)
with open(out + ".cmd", "w") as f, open(out + ".csv", "w") as c:
    c.write("t,dx,angle\n")
    for i, (d, a_) in enumerate(zip(ema, ang)):
        t = (i+1)/fps
        f.write(f"{t:.4f} rotate a {a_*np.pi/180:.5f};\n")
        c.write(f"{t:.3f},{d:.3f},{a_:.2f}\n")
print(f"frames {len(dx)} fps {fps:.0f} dx range {dx.min():.2f}..{dx.max():.2f} px  angle range {ang.min():.1f}..{ang.max():.1f} deg")
