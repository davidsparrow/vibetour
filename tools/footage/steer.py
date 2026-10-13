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
    # yaw shows as a common horizontal shift across the whole frame; forward motion cancels left/right.
    # Use the band around the horizon (25-60% down), where forward-motion flow is smallest.
    band = flow[int(H*0.25):int(H*0.60), :, 0]
    dxs.append(float(np.median(band)))
    prev = g
dx = np.array(dxs)
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
