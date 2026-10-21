"""pace.py <in.mp4> <out.mp4> [target]   retime a plate so the road passes at a steady pace
   pace.py measure <clip.mp4>…           print each clip's road pace (start / middle / end, and the median)

The dials cruise at one speed through every cruise clip, but the video models drive each plate at their own pace, and
some speed up or slow down inside a clip, so a dissolve into a slower plate reads as the car braking for no reason
(the user, 20 October: "it always starts each new scene really slow"). This measures the apparent speed of each frame as
the optical flow in the road band (the bottom part of the frame, where the asphalt and the verges stream past) in px per
frame at 336 px wide, smooths it over a second, and plays the plate back at a varying rate so the flow is steady at the
target: the pack's cruise pace, 3.5 (the median of the California Coast cruise clips). A slow plate gets shorter, a surge
is flattened. Frames are picked, never blended (a blend of two frames ten pixels apart is a double image): a plate played
faster than the source picks the nearest source frame, and a plate slowed anywhere is first motion-interpolated to UP (3)
times its frame rate with ffmpeg's minterpolate, and the picks come from that. The rate is clamped (RATE_MIN 0.35 to
RATE_MAX 3) so a plate that nearly stands still (a hold, a traffic light) is not rushed into a blur; where the clamp bites,
<out>.speed.csv carries the residual (the apparent speed over the target), and session.sh turns it into the dials.
Everywhere else it is 1.

Pace a plate before ramping it (ramp.py multiplies the pace by its own crawl). A repainted sign (sign.py fix) survives
pacing: the picks are whole frames, and the interpolation keeps a flat face flat. Holds are not paced. Env: TARGET (3.5),
BAND (0.55:0.92, the rows of the frame measured), SMOOTH (24 frames), RATE_MIN, RATE_MAX, UP, MINLEN (3 s: refuse a
result shorter than this, since a dissolve takes 1 s at each end).

The flow measure is good up to about 4 px per frame and under-reads above it (a plate played at 3x its speed reads 5.6
where 8.7 is true), so `measure` on a paced clip that was sped up more than about 1.5x reads low; the pacing itself is
measured on consecutive source frames, where it holds."""
import os, subprocess, sys, tempfile
import cv2
import numpy as np

TARGET = float(os.environ.get("TARGET", 3.5))
BAND = [float(x) for x in os.environ.get("BAND", "0.55:0.92").split(":")]
SMOOTH = int(os.environ.get("SMOOTH", 24))
RATE_MIN, RATE_MAX = float(os.environ.get("RATE_MIN", 0.35)), float(os.environ.get("RATE_MAX", 3))
MINLEN = float(os.environ.get("MINLEN", 3))
UP = int(os.environ.get("UP", 3))
MW = 336


def read(src):
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    return frames, fps


def flow(frames):
    """Road-band flow per frame (px per frame at 336 px wide), smoothed over SMOOTH frames. Entry k is the motion
    between frames k and k+1; the last repeats the one before."""
    h, w = frames[0].shape[:2]
    mh = int(round(h * MW / w))
    y0, y1 = int(mh * BAND[0]), int(mh * BAND[1])
    small = [cv2.cvtColor(cv2.resize(f, (MW, mh), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY) for f in frames]
    raw = []
    for a, b in zip(small, small[1:]):
        fl = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0)[y0:y1]
        mag = np.hypot(fl[..., 0], fl[..., 1])
        raw.append(float(mag.mean()))
    raw.append(raw[-1] if raw else 0.0)
    raw = np.array(raw)
    if SMOOTH > 1 and len(raw) > SMOOTH:
        k = np.ones(SMOOTH) / SMOOTH
        pad = np.pad(raw, (SMOOTH // 2, SMOOTH - 1 - SMOOTH // 2), mode="edge")
        sm = np.convolve(pad, k, mode="valid")
    else:
        sm = raw
    return sm, raw


def measure(clips):
    print(f"{'clip':42s} {'start':>6s} {'mid':>6s} {'end':>6s} {'median':>7s} {'min':>6s} {'max':>6s}   s")
    for c in clips:
        frames, fps = read(c)
        sm, _ = flow(frames)
        n = len(sm)
        s, m, e = sm[: n // 6].mean(), sm[n // 2 - n // 12: n // 2 + n // 12].mean(), sm[-n // 6:].mean()
        print(f"{os.path.basename(c):42s} {s:6.1f} {m:6.1f} {e:6.1f} {np.median(sm):7.1f} {sm.min():6.1f} {sm.max():6.1f}   {n / fps:.1f}")


def pace(src, out, target):
    frames, fps = read(src)
    n = len(frames)
    sm, raw = flow(frames)
    rate = np.clip(target / np.maximum(sm, 1e-3), RATE_MIN, RATE_MAX)
    pos, picks, speeds = 0.0, [], []
    while pos < n - 1:
        i = min(int(pos), n - 1)
        r = rate[i]
        picks.append(pos)
        speeds.append(float(sm[i] * r / target))             # 1 where the clamp did not bite
        pos += r
    if len(picks) / fps < MINLEN:
        sys.exit(f"{src}: paced to {target} it would run {len(picks) / fps:.1f} s (under {MINLEN} s); retake it at a higher stated speed or lower the target")
    h, w = frames[0].shape[:2]
    up = UP if rate.min() < 0.999 else 1                      # slowed anywhere: pick from motion-interpolated frames
    with tempfile.TemporaryDirectory() as tmp:
        rawp = os.path.join(tmp, "raw.mp4")
        wr = cv2.VideoWriter(rawp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        if up == 1:
            for p in picks:
                i = min(int(round(p)), n - 1)                 # the nearest frame, crisp
                wr.write(frames[i])
        else:
            del frames
            # ffmpeg's motion-compensated interpolation at UP times the frame rate (about a minute per 12 s plate), read
            # as a stream: the picks are in order, so each interpolated frame is written as many times as it is picked.
            interp = os.path.join(tmp, "up.mp4")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf",
                            f"minterpolate=fps={fps * up:g}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1",
                            "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", interp], check=True)
            want = [int(round(p * up)) for p in picks]
            cap = cv2.VideoCapture(interp)
            m, k, last = 0, 0, None
            while k < len(want):
                ok, f = cap.read()
                if not ok:
                    f = last                                  # past the end: hold the last frame
                    if f is None:
                        break
                last = f
                while k < len(want) and want[k] <= m:
                    wr.write(f)
                    k += 1
                m += 1
        wr.release()
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", rawp, "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out], check=True)
    with open(out + ".speed.csv", "w") as f:
        f.write("frame,speed\n")
        f.writelines(f"{k},{v:.3f}\n" for k, v in enumerate(speeds))
    clamped = int(((rate <= RATE_MIN + 1e-6) | (rate >= RATE_MAX - 1e-6)).sum())
    print(f"{out}: {len(picks) / fps:.1f} s from {n / fps:.1f} s of plate; pace {sm[:n // 6].mean():.1f}/{sm[n // 2 - n // 12:n // 2 + n // 12].mean():.1f}/{sm[-n // 6:].mean():.1f} -> {target}; "
          f"rate {rate.min():.2f}..{rate.max():.2f}" + (f", clamped on {clamped} source frames" if clamped else ""))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "measure":
        measure(sys.argv[2:])
    elif len(sys.argv) >= 3:
        pace(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else TARGET)
    else:
        sys.exit(__doc__)
