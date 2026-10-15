"""mirrorfeed.py <out.mp4> <clip1> <clip2> ... : what the mirrors show for a session, 320x180 at 24 fps.

A mirror shows the road behind: what we have already passed, going away. The plates only look forward, so:
- The background is the road we have driven, run backwards: the footage from some way back (BACK, 60 m of road)
  played in reverse, at the pace we're driving now (a crawl barely moves it, a stop freezes it, HOLDBACK, 150 m back,
  and after a stop it carries on from there). Measured in metres, not seconds: ten seconds of a crawl and a stop is
  only a few metres, and the gas station we had stopped at showed in the mirror. It never shows the clip we're in,
  which held what was still ahead of us: the gas station, a parked van.
- Every vehicle in that footage is painted out (traffic.py's boxes): run backwards it would drive in reverse, face us,
  and show up long after it really passed.
- Each vehicle that passes us (traffic.py's passes) is drawn back in from behind, at the moment it passes: it appears
  big at the outer edge of the door mirror and shrinks away down the opposite lane, through the rear-view mirror,
  towards the vanishing point. Sprites are in tools/footage/traffic/, picked by kind and tinted to its colour.
The joins are 1 s dissolves, as in session.sh. Clips named *hold* stand still (checkpoint holds keep moving).
"""
import json, math, os, subprocess, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
out_path, clips = sys.argv[1], sys.argv[2:]
FPS, W, H = 24, 320, 180
BACK, HOLDBACK = float(os.environ.get("BACK", 60)), float(os.environ.get("HOLDBACK", 150))   # metres of road
CRUISE = float(os.environ.get("CRUISE", 55))           # km/h of a clip's speed factor 1, as in session.sh
F = 213.0                                              # focal length in feed pixels: the plates' 24 mm on a 4:3 still
VPX, VPY = W / 2, 0.45 * H
CAM_H, LANE = 1.1, 3.6                                 # camera height, lane width (m)
ONCOMING = 50 / 3.6                                    # m/s
SPRITES = {}
for n, (wm, _) in {"rv": (2.4, 0), "hatchback": (1.8, 0), "suv": (1.9, 0), "pickup": (2.0, 0), "boxtruck": (2.3, 0), "motorcycle": (0.9, 0)}.items():
    im = cv2.imread(os.path.join(HERE, "traffic", f"{n}.png"), cv2.IMREAD_UNCHANGED)
    SPRITES[n] = (im, wm)


def is_hold(c):
    n = os.path.basename(c)
    return "hold" in n and "checkpoint" not in n


def duration(c):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", c],
                                capture_output=True, text=True).stdout)


def speed_factor(c, tau):
    """The clip's speed as a factor of cruise at its local time tau: its .speed.csv, 0 in a hold, else 1."""
    if is_hold(c):
        return 0.0
    csv = c + ".speed.csv"
    if os.path.exists(csv):
        rows = speed_factor.cache.get(csv)
        if rows is None:
            rows = speed_factor.cache[csv] = [float(l.split(",")[1]) for l in open(csv).read().split("\n")[1:] if l]
        return rows[min(int(tau * FPS), len(rows) - 1)]
    return 1.0
speed_factor.cache = {}


class Frames:
    """Each clip decoded once at feed size, with its vehicles painted out; a few kept at a time."""
    def __init__(self):
        self.cache, self.order = {}, []

    def get(self, c, tau):
        if c not in self.cache:
            cap, fr = cv2.VideoCapture(c), []
            while True:
                ok, f = cap.read()
                if not ok:
                    break
                fr.append(cv2.resize(f, (W, H), interpolation=cv2.INTER_AREA))
            tj = json.load(open(c + ".traffic.json"))["boxes"] if os.path.exists(c + ".traffic.json") else []
            masks = []
            for k in range(len(fr)):
                m = np.zeros((H, W), np.uint8)
                for x, y, w, h in (tj[k] if k < len(tj) else []):
                    x0, y0 = int((x - w * 0.15) * W) - 2, int((y - h * 0.15) * H) - 2
                    x1, y1 = int((x + w * 1.15) * W) + 2, int((y + h * 1.1) * H) + 2
                    m[max(y0, 0):max(y1, 0), max(x0, 0):max(x1, 0)] = 255
                masks.append(m > 0)
            # Paint each vehicle out with the same place in a nearby frame where it isn't: real road and hillside, a
            # little out of step as the camera moves, which a mirror hides; Telea only for small leftovers.
            clean = []
            for k, f in enumerate(fr):
                m = masks[k]
                if not m.any():
                    clean.append(f)
                    continue
                fill, todo = f.copy(), m.copy()
                for dk in (8, -8, 16, -16, 24, -24, 36, -36, 48, -48):
                    j = k + dk
                    if not 0 <= j < len(fr):
                        continue
                    ok = todo & ~masks[j]
                    fill[ok] = fr[j][ok]
                    todo &= ~ok
                    if not todo.any():
                        break
                if todo.sum() > 60:
                    # No nearby frame shows what is behind it: it isn't moving (a pickup parked at the pump). Leave
                    # it be, as a parked car belongs in a mirror; painting it out only smeared it.
                    fill[todo] = f[todo]
                elif todo.any():
                    fill = cv2.inpaint(fill, todo.astype(np.uint8) * 255, 4, cv2.INPAINT_TELEA)
                a = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.5)[..., None]
                clean.append((f * (1 - a) + fill * a).astype(np.uint8))
            self.cache[c] = clean
            self.order.append(c)
            if len(self.order) > 4:
                self.cache.pop(self.order.pop(0), None)
        fr = self.cache[c]
        return fr[max(0, min(len(fr) - 1, int(round(tau * FPS))))]


durs = [duration(c) for c in clips]
offs = [0.0]
for d in durs[:-1]:
    offs.append(offs[-1] + d - 1.0)
total = offs[-1] + durs[-1]
n = int(total * FPS)
frames = Frames()


PASTS = {}


def past_road(i):
    """The footage behind the start of clip i, frame by frame going back (holds skipped), with the metres of road
    behind us at each: (clips, local times, metres). The first clip has no past, so it runs back over its own end."""
    if i in PASTS:
        return PASTS[i]
    cs, ts, ms, m = [], [], [], 0.0
    j = i - 1
    while j >= 0 and m < 3000:
        if not is_hold(clips[j]):
            k = int((durs[j] - 1.0) * FPS)                       # the last second of each clip is the dissolve
            while k >= 0:
                tau = k / FPS
                cs.append(clips[j]); ts.append(tau); ms.append(m)
                m += max(speed_factor(clips[j], tau), 0.02) * CRUISE / 3.6 / FPS
                k -= 1
        j -= 1
    if not cs:
        for k in range(int(durs[i] * FPS), -1, -1):
            cs.append(clips[i]); ts.append(k / FPS); ms.append(m); m += CRUISE / 3.6 / FPS
    PASTS[i] = (cs, ts, np.array(ms))
    return PASTS[i]


def past(i, metres):
    cs, ts, ms = past_road(i)
    k = min(int(np.searchsorted(ms, metres)), len(cs) - 1)
    return cs[k], ts[k]


# Each clip's background pointer, in metres back from its start, moving back as fast as we drive. After a stop it
# carries on from where the mirror stood (HOLDBACK), so what we stopped beside never shows up behind us.
pointers = []
for i, c in enumerate(clips):
    if is_hold(c):
        pointers.append(None)
        continue
    b, row = (HOLDBACK if i > 0 and is_hold(clips[i - 1]) else BACK), []
    for k in range(int(durs[i] * FPS) + 1):
        row.append(b)
        b += speed_factor(c, k / FPS) * CRUISE / 3.6 / FPS
    pointers.append(row)


def background(i, tau):
    if pointers[i] is None:
        return frames.get(*past(i, HOLDBACK))
    b = pointers[i][min(int(tau * FPS), len(pointers[i]) - 1)]
    return frames.get(*past(i, b))


def tint(sprite, colour):
    """The sprite's body pulled towards the vehicle's colour (lights, glass and tyres keep theirs)."""
    im = sprite[..., :3].astype(np.float32)
    hsv = cv2.cvtColor(sprite[..., :3], cv2.COLOR_BGR2HSV).astype(np.float32)
    lights = ((hsv[..., 0] < 10) | (hsv[..., 0] > 170)) & (hsv[..., 1] > 120)
    body = (hsv[..., 2] > 70) & ~lights
    target = np.array(colour[::-1], np.float32)
    lum = im.mean(2, keepdims=True)
    tl = max(target.mean(), 1)
    shaded = np.clip(target * (lum / max(float(lum[body].mean()) if body.any() else 128, 1)), 0, 255)
    im[body] = 0.35 * im[body] + 0.65 * shaded[body] * (tl / max(tl, 1))
    return np.dstack([im.clip(0, 255), sprite[..., 3:4]]).astype(np.uint8)


def pick(kind, colour):
    v = sum(colour) / 3
    if kind == "motorcycle":
        return "motorcycle"
    if kind == "bus":
        return "rv"
    if kind == "truck":
        return "rv" if v > 170 else "pickup"
    return "hatchback" if v > 120 else "suv"


# Passes, on the session clock, each with our speed for the trip back.
events = []
for i, c in enumerate(clips):
    tj = c + ".traffic.json"
    if not os.path.exists(tj):                                 # holds too: a car can pass while we stand
        continue
    for p in json.load(open(tj))["passes"]:
        if p["t"] > durs[i] - 0.5:
            continue                                             # gone in the dissolve: the next clip doesn't show it
        if p["kind"] == "bicycle":
            continue
        name = pick(p["kind"], p["colour"])
        im, wm = SPRITES[name]
        events.append({"t": offs[i] + p["t"] + 0.15, "sprite": tint(im, p["colour"]) if name in ("hatchback", "suv", "pickup") else im,
                       "w": wm, "h": wm * im.shape[0] / im.shape[1]})


def our_speed(t):
    for i in range(len(clips) - 1, -1, -1):
        if t >= offs[i]:
            return speed_factor(clips[i], t - offs[i]) * CRUISE / 3.6
    return CRUISE / 3.6


# Where each passed vehicle is, metres behind us, on every frame.
for e in events:
    z, track = 6.0, {}
    k = int(e["t"] * FPS)
    while z < 300 and k < n:
        track[k] = z
        z += (our_speed(k / FPS) + ONCOMING) / FPS
        k += 1
    e["track"] = track

enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out_path], stdin=subprocess.PIPE)
for k in range(n):
    t = k / FPS
    i = max(j for j in range(len(clips)) if offs[j] <= t)
    img = background(i, t - offs[i]).astype(np.float32)
    if i + 1 < len(clips) and t >= offs[i + 1]:
        a = (t - offs[i + 1]) / 1.0
        img = img * (1 - a) + background(i + 1, t - offs[i + 1]).astype(np.float32) * a
    # A vehicle that just passed sits in the opposite lane at z metres behind us: draw it, nearest last.
    for e in sorted((e for e in events if k in e["track"]), key=lambda e: -e["track"][k]):
        z = e["track"][k]
        pw, ph = F * e["w"] / z, F * e["h"] / z
        if ph < 1.5:
            continue
        cx, by = VPX - F * LANE / z, VPY + F * CAM_H / z
        x0, y0 = int(round(cx - pw / 2)), int(round(by - ph))
        sw, sh = max(1, int(round(pw))), max(1, int(round(ph)))
        spr = cv2.GaussianBlur(cv2.resize(e["sprite"], (sw, sh), interpolation=cv2.INTER_AREA), (0, 0), 0.6).astype(np.float32)
        xa, ya, xb, yb = max(x0, 0), max(y0, 0), min(x0 + sw, W), min(y0 + sh, H)
        if xa >= xb or ya >= yb:
            continue
        s = spr[ya - y0: yb - y0, xa - x0: xb - x0]
        al = s[..., 3:4] / 255.0
        img[ya:yb, xa:xb] = img[ya:yb, xa:xb] * (1 - al) + s[..., :3] * 0.92 * al
    enc.stdin.write(img.clip(0, 255).astype(np.uint8).tobytes())
enc.stdin.close()
enc.wait()
print(f"mirror feed: {n} frames, {len(events)} passing vehicles drawn from behind")
