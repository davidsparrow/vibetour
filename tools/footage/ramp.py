"""ramp.py <in.mp4> <out.mp4> stop|start <seconds> [floor]: slow a plate to a crawl, or bring it up from one.

Video models cannot drive a car through a turn into a stop: asked to, they swing the camera round on the spot and the
car seems to float. So a stop is cut the way a travel video cuts it: the car slows on the road as the stop comes up
(`stop`), a short dissolve lands it parked and facing the view, and after the hold a dissolve picks the road up from
a crawl (`start`). This makes those two clips by re-timing a plate: `stop` plays the plate at full speed and then, over
the last <seconds> of the output, slows it evenly to <floor> (0.15) of its speed; `start` begins at <floor> and comes up
to full speed over <seconds>, then plays on. Frames between two source frames are blended. Beside the output it writes
<out>.speed.csv with each output frame's speed factor, which session.sh turns into the speedometer."""
import os, subprocess, sys, tempfile, cv2, numpy as np
src, out, mode, D = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]); floor = float(sys.argv[5]) if len(sys.argv) > 5 else 0.15
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 24; frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
n = len(frames); length = n / fps; used = D * (1 + floor) / 2          # plate seconds the ramp consumes
if used > length: sys.exit(f"{src} is {length:.1f} s; a {D} s ramp to {floor} needs {used:.1f} s of plate")
def v_stop(t, t0): return 1 - (1 - floor) * min(max((t - t0) / D, 0), 1)
def v_start(t): return floor + (1 - floor) * min(t / D, 1)
dt = 1 / fps; pos, t, out_frames, speeds = 0.0, 0.0, [], []
if mode == "stop":
    t0 = length - used; 
    while pos < length - dt:
        v = v_stop(t, t0) if t >= t0 else 1.0
        out_frames.append(pos); speeds.append(v); pos += v * dt; t += dt
elif mode == "start":
    while pos < length - dt:
        v = v_start(t); out_frames.append(pos); speeds.append(v); pos += v * dt; t += dt
else: sys.exit("mode is stop or start")
h, w = frames[0].shape[:2]
with tempfile.TemporaryDirectory() as tmp:
    raw = os.path.join(tmp, "raw.mp4"); wr = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    for p in out_frames:
        i = min(int(p * fps), n - 1); a = p * fps - i; j = min(i + 1, n - 1)
        wr.write(frames[i] if a < 0.02 else cv2.addWeighted(frames[i], 1 - a, frames[j], a, 0))
    wr.release()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", out], check=True)
with open(out + ".speed.csv", "w") as f:
    f.write("frame,speed\n"); f.writelines(f"{k},{v:.3f}\n" for k, v in enumerate(speeds))
print(f"{out}: {len(out_frames) / fps:.1f} s from {length:.1f} s of plate, {mode} ramp {D} s to {floor:.2f}")
