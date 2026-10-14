"""sign.py: a highway guide sign whose text we set, for plates where the sign must read right.

  sign.py paste <in.png> <out.png> <x> <y> <w> <h> <ground_y>   draw the sign on a still: a face w x h at (x, y) on two
                                                                 posts that reach down to ground_y
  sign.py fix <in.mp4> <out.mp4>                                 find the sign's green face in every frame of a clip
                                                                 made from that still, and redraw it with crisp text

Video models garble text that grows as it comes closer: a sign that starts far enough away to be read in time starts too
small for the model to keep its letters. So the still carries our sign, the model drives up to it, and `fix` repaints
the face over the model's, following its four corners. SIGN sets the text as lines of "place|miles" joined by ";"
(default "Big Sur|19;San Simeon|85"). Caltrans green, white border, a condensed highway face.
"""
import os, sys
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

LINES = [l.split("|") for l in os.environ.get("SIGN", "Big Sur|19;San Simeon|85").split(";")]
GREEN = (0, 106, 74)
FONTS = ["/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"]


def face(w, h):
    """The sign's face, w x h, as an RGB array (drawn at 4x and reduced, so small faces stay clean)."""
    S = 4
    W, H = max(w, 8) * S, max(h, 4) * S
    im = Image.new("RGB", (W, H), GREEN)
    d = ImageDraw.Draw(im)
    b = max(1, round(H * 0.045))
    d.rounded_rectangle([b, b, W - 1 - b, H - 1 - b], radius=b * 3, outline=(245, 245, 240), width=max(1, round(b * 0.9)))
    path = next((f for f in FONTS if os.path.exists(f)), None)
    lh = (H - 4 * b) / len(LINES)
    size = int(lh * 0.78)
    font = ImageFont.truetype(path, size) if path else ImageFont.load_default()
    for i, (place, miles) in enumerate(LINES):
        cy = 2 * b + lh * (i + 0.5)
        d.text((b * 4, cy), place, font=font, fill=(250, 250, 245), anchor="lm")
        d.text((W - b * 4, cy), miles, font=font, fill=(250, 250, 245), anchor="rm")
    return np.asarray(im.resize((max(w, 1), max(h, 1)), Image.LANCZOS))


def paste(src, out, x, y, w, h, ground):
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    pw = max(2, round(w * 0.035))
    for px in (x + w * 0.22, x + w * 0.78):                  # two galvanised posts, a little darker in shade
        d.rectangle([px - pw / 2, y + h - 2, px + pw / 2, ground], fill=(118, 116, 110))
        d.rectangle([px + pw * 0.1, y + h - 2, px + pw / 2, ground], fill=(92, 90, 86))
    im.paste(Image.fromarray(face(w, h)), (x, y))
    im.save(out)


def find(frame, prev):
    """The four corners of the sign's green face, or None: the most rectangular saturated-green patch of sign shape."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    m = ((hsv[..., 0] >= 62) & (hsv[..., 0] <= 92) & (hsv[..., 1] > 110) & (hsv[..., 2] > 35) & (hsv[..., 2] < 210)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best, score = None, 0
    H, W = m.shape
    for c in cnts:
        a = cv2.contourArea(c)
        if a < 40:
            continue
        (cx, cy), (rw, rh), ang = cv2.minAreaRect(c)
        if rw < rh:
            rw, rh = rh, rw
        rect = a / max(rw * rh, 1)
        aspect = rw / max(rh, 1)
        x, y, bw, bh = cv2.boundingRect(c)
        if rect < 0.75 or not 1.8 < aspect < 4.5 or x <= 1 or y <= 1 or x + bw >= W - 1 or y + bh >= H - 1:
            continue
        s = a * rect
        if prev is not None:                                  # stay with the sign we were following
            px, py = prev.mean(0)
            s /= 1 + np.hypot(cx - px, cy - py) / 40
        if s > score:
            best, score = c, s
    if best is None:
        return None
    box = cv2.boxPoints(cv2.minAreaRect(best))
    box = box[np.argsort(box[:, 1])]
    top, bot = box[:2][np.argsort(box[:2, 0])], box[2:][np.argsort(box[2:, 0])]
    return np.float32([top[0], top[1], bot[1], bot[0]])


def fix(src, out):
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    vw = cv2.VideoWriter(out + ".tmp.mp4", cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
    prev, k, done = None, 0, 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        q = find(f, prev)
        if q is not None and prev is not None and np.abs(q - prev).max() < 30:
            q = 0.6 * q + 0.4 * prev                           # steady the corners
        if q is not None:
            prev = q
            w = int(np.hypot(*(q[1] - q[0]))) + 1
            h = int(np.hypot(*(q[3] - q[0]))) + 1
            fc = cv2.cvtColor(face(w * 2, h * 2), cv2.COLOR_RGB2BGR)
            src_q = np.float32([[0, 0], [w * 2, 0], [w * 2, h * 2], [0, h * 2]])
            M = cv2.getPerspectiveTransform(src_q, q)
            warped = cv2.warpPerspective(fc, M, (W, H), flags=cv2.INTER_AREA)
            mask = cv2.warpPerspective(np.full((h * 2, w * 2), 255, np.uint8), M, (W, H))
            mask = cv2.GaussianBlur(mask, (3, 3), 0)[..., None] / 255.0
            # Keep the scene's light on the face: match its brightness to the model's green.
            g = f[mask[..., 0] > 0.9]
            gain = float(np.clip(g.mean() / max(warped[mask[..., 0] > 0.9].mean(), 1), 0.6, 1.4)) if len(g) else 1.0
            f = (f * (1 - mask) + np.clip(warped * gain, 0, 255) * mask).astype(np.uint8)
            done += 1
        vw.write(f)
        k += 1
    vw.release()
    os.system(f'ffmpeg -v error -y -i "{out}.tmp.mp4" -c:v libx264 -crf 16 -pix_fmt yuv420p "{out}" && rm "{out}.tmp.mp4"')
    print(f"{out}: sign face redrawn on {done} of {k} frames")


if __name__ == "__main__":
    if sys.argv[1] == "paste":
        a = sys.argv[2:]
        paste(a[0], a[1], *(int(v) for v in a[2:7]))
    elif sys.argv[1] == "fix":
        fix(sys.argv[2], sys.argv[3])
