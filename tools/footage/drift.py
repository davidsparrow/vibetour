"""drift.py <clip.mp4>… : check that each clip's camera keeps pointing down the road.

Video models like to turn the camera towards the view: on the Big Sur cliffs HeyGen panned slowly towards the sea while
the road curved away left, until the road's vanishing point sat at the left edge of the frame. Through a cockpit that
looks like the car heading off the cliff, and no steering can hide it. This finds the vanishing point from the painted
lane lines every half second (vp.py's search) and reports how far it strays from the centre.

A point more than WARN (12%) of the frame's width from the centre is flagged; more than FAIL (20%) fails the clip. For a
failing clip it prints the longest stretch that passes, so the clip can be trimmed instead of retaken if that is long
enough (12 s clips need 8 s or more). Frames with too few lane lines (a town street full of cars) are skipped."""
import os, sys, cv2, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vp import find_vp
WARN, FAIL, STEP = float(os.environ.get("WARN", 0.12)), float(os.environ.get("FAIL", 0.20)), 0.5
worst = 0
for clip in sys.argv[1:]:
    cap = cv2.VideoCapture(clip); fps = cap.get(cv2.CAP_PROP_FPS) or 24; n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    samples = []
    for k in range(0, n, max(1, int(round(fps * STEP)))):
        cap.set(cv2.CAP_PROP_POS_FRAMES, k); ok, f = cap.read()
        if not ok: break
        vp, _, pairs, _ = find_vp(f)
        samples.append((k / fps, vp[0] / f.shape[1] - 0.5 if vp and pairs >= 3 else None))
    seen = [(t, d) for t, d in samples if d is not None]
    if not seen:
        print(f"{os.path.basename(clip)}: no lane lines found; check by eye"); continue
    peak = max(abs(d) for _, d in seen)
    verdict = "FAIL" if peak > FAIL else "warn" if peak > WARN else "ok"
    worst = max(worst, 2 if verdict == "FAIL" else 1 if verdict == "warn" else 0)
    # The longest run of samples within FAIL (skipped samples don't break a run).
    best, start, prev_ok = (0, 0, 0), None, False
    for t, d in samples:
        if d is None or abs(d) <= FAIL:
            start = t if start is None else start
            if t - start > best[0]: best = (t - start, start, t)
        else: start = None
    track = " ".join("  ." if d is None else f"{d * 100:+3.0f}" for _, d in samples[::2])
    print(f"{os.path.basename(clip)}: {verdict}, peak {peak:.0%} off centre; per second: {track}")
    if verdict == "FAIL": print(f"   longest passing stretch {best[1]:.1f}-{best[2]:.1f} s ({best[0]:.1f} s)")
sys.exit(2 if worst == 2 else 0)
