"""speed.py <clip.mp4> <metres> [cruise km/h]: the speed track of a generated straight move at a stop (the creep to the pump).

Measures how fast the ground in front of the car streams past (dense optical flow, the lower middle of the frame), scales it
so the clip covers <metres>, and writes <clip>.speed.csv as a factor of the cruise speed (55 km/h), the format ramp.py
writes, so session.sh's dials crawl with the car. Without it a clip that is neither ramped nor a hold reads as cruising.
"""
import sys
import cv2
import numpy as np

clip, metres = sys.argv[1], float(sys.argv[2])
cruise = float(sys.argv[3]) if len(sys.argv) > 3 else 55.0
cap = cv2.VideoCapture(clip)
fps = cap.get(cv2.CAP_PROP_FPS) or 24
prev, mags = None, []
while True:
    ok, f = cap.read()
    if not ok:
        break
    g = cv2.cvtColor(cv2.resize(f, (320, 180)), cv2.COLOR_BGR2GRAY)
    if prev is not None:
        fl = cv2.calcOpticalFlowFarneback(prev, g, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        mags.append(float(np.median(np.linalg.norm(fl[90:180, 40:280], axis=2))))
    prev = g
m = np.array([mags[0]] + mags)
s = np.convolve(np.pad(m, 4, mode="edge"), np.ones(9) / 9, mode="valid")
s = np.clip(s - np.percentile(s, 5), 0, None)            # a parked car's jitter reads as zero
avg_kmh = metres / (len(s) / fps) * 3.6
f = s / max(s.mean(), 1e-6) * avg_kmh / cruise
f[:2] = 0
f[-2:] = 0
open(clip + ".speed.csv", "w").write("frame,speed\n" + "".join(f"{i},{v:.3f}\n" for i, v in enumerate(f)))
print(f"{clip}.speed.csv: {len(f)} frames, peak {f.max() * cruise:.1f} km/h, average {f.mean() * cruise:.1f} km/h")
