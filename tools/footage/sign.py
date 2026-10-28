"""sign.py: roadside signs and billboards whose text we set, for plates where a sign must read right.

  sign.py paste <in.png> <out.png> <x> <y> <w> <h> <ground>   draw the sign on a still: a face w x h at (x, y), on posts
                                                               (or a pole) that reach down to ground_y
  sign.py quad <in.png> <out.png> <x0,y0> <x1,y1> <x2,y2> <x3,y3>
                                                               draw the face alone into four corners (top left, top right,
                                                               bottom right, bottom left): a billboard's blank face
  sign.py fix <in.mp4> <out.mp4> [x y w h [frame [first [last]]]]
                                                               find the sign's face in every frame of a clip made from that
                                                               still and redraw it with crisp text; x y w h is where it is
                                                               in frame 0 (or in frame), and nothing is drawn before first
                                                               or after last (a cut in the clip)
  sign.py place <in.mp4> <out.mp4> <x> <y> <w> <h> <ground>    put the sign into a clip that was made without it: drawn on
                                                               the first frame and carried by the scene around its foot
  sign.py face <out.png> <w> <h>                               the face alone, to look at

Video models garble text that grows as it comes closer: a sign that starts far enough away to be read in time starts too
small for the model to keep its letters. So the still carries our sign, the model drives up to it, and `fix` repaints
the face over the model's, following its four corners. Given a box (clip pixels, in frame 0 or in `frame`), `fix` follows
the sign forwards and backwards from there: it matches the sign as the clip draws it (refreshed as it grows) at a few
sizes round where it should be, then fits its corners (ECC). Without a box it looks for a Caltrans-green face anywhere
(the first distance sign). It paints only the pixels that look like sign (face colour or white), so a cyclist or a car
passing in front stays in front. It also repaints a sign the model drew itself, when its text came out garbled.

`place` is for clips that are not remade: holds, and slow moves such as a gas station's pull-in. The sign is drawn in
the first frame at (x, y) and moved with the features tracked around its foot. A vehicle that traffic.py tracked in the
clip (<clip>.traffic.json) and that stands nearer than the sign's foot passes in front of it. It prints where the sign
stands in the last frame, so the next clip can start it there (run a clip reversed to carry a sign back from its end).

TRACK=colour follows a plain board (a shop's blank sign board, which gives a template nothing to hold) as the patch of
its own colour, from the start frame on; GROW=<factor> paints the face that much bigger, so a slip never shows the
model's board beside it. ERASE_UNTIL=<frame> paints the sign out (filled from its surroundings, post and all) instead of
redrawing it on the frames before that one, -1 on every frame: for a far sign that stands in front of a nearer one until
the nearer one has passed, or a repaint that will not sit still.

KIND picks the sign and SIGN sets its text (lines joined by ";"):
  distance  Caltrans green, "place|miles" lines (the default: "Big Sur|19;San Simeon|85")
  guide     Caltrans green, centred lines ("CARMEL-BY-THE-SEA;CITY LIMIT", "VISTA POINT;1/2 MILE")
  park      Caltrans brown, white letters, for parks and landmarks ("GARRAPATA;STATE PARK")
  services  Caltrans blue, white letters ("GAS · FOOD · LODGING;NEXT RIGHT")
  regulatory  white, black letters and border ("SPEED;LIMIT;25")
  shop      a painted shop board: green letters on cream ("HIGHLANDS;GAS · MARKET")
  gas       a gas station's pole sign: the name over a price board ("HIGHLANDS|GAS · MARKET;Regular|5.89;Plus|6.09")
  lawyer    billboard: an accident lawyer (SIGN "NAME;KIND OF LAW;phone")
  tourism   billboard: a county tourism board (SIGN "WELCOME TO;MONTEREY COUNTY;tagline")
Billboard faces are our own artwork, drawn here, never generated: fictional names and 555 numbers only.
"""
import itertools, json, os, sys
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

KIND = os.environ.get("KIND", "distance")
SIGN = os.environ.get("SIGN", "Big Sur|19;San Simeon|85")
GREEN, BROWN, BLUE, WHITE = (0, 106, 74), (92, 58, 36), (0, 72, 150), (248, 248, 242)
FACE = {"distance": GREEN, "guide": GREEN, "park": BROWN, "services": BLUE, "regulatory": WHITE, "gas": (24, 92, 70),
        "lawyer": (250, 196, 0), "tourism": (232, 96, 52), "shop": (238, 233, 218)}
SUP = "/System/Library/Fonts/Supplemental/"
HIGHWAY = [SUP + "DIN Condensed Bold.ttf", SUP + "Arial Narrow Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"]
BOLD = [SUP + "Arial Bold.ttf", SUP + "DIN Alternate Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
HEAVY = [SUP + "Impact.ttf", SUP + "Arial Black.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def font(names, size):
    path = next((f for f in names if os.path.exists(f)), None)
    return ImageFont.truetype(path, max(4, int(size))) if path else ImageFont.load_default()


def fit(d, text, names, size, width):
    """The largest font no bigger than size that fits text into width."""
    f = font(names, size)
    while size > 6 and d.textlength(text, font=f) > width:
        size *= 0.94
        f = font(names, size)
    return f


def caltrans(W, H, colour, lines, mode, ink=WHITE):
    """A Caltrans sign: ink letters and an ink rounded border on colour (white on green, brown or blue; black on white)."""
    im = Image.new("RGB", (W, H), colour)
    d = ImageDraw.Draw(im)
    b = max(1, round(min(W, H) * 0.045))
    d.rounded_rectangle([b, b, W - 1 - b, H - 1 - b], radius=b * 3, outline=ink, width=max(1, round(b * 0.9)))
    lh = (H - 4 * b) / len(lines)
    if mode == "regulatory":                              # a speed limit: two small lines over a big number
        rows = [0.17, 0.17, 0.5] if len(lines) == 3 else [1 / len(lines)] * len(lines)
        y = 2.5 * b
        for line, r in zip(lines, rows):
            hh = (H - 5 * b) * r
            f = fit(d, line, HIGHWAY, hh * (0.95 if r > 0.3 else 1.1), W - 6 * b)
            d.text((W / 2, y + hh / 2 + (0.1 * hh if r > 0.3 else 0)), line, font=f, fill=ink, anchor="mm")
            y += hh + (0.08 * (H - 5 * b) if r < 0.3 else 0)
        return im
    for i, line in enumerate(lines):
        cy = 2 * b + lh * (i + 0.5)
        if mode == "distance":
            place, miles = line.split("|")
            f = font(HIGHWAY, lh * 0.78)
            d.text((b * 4, cy), place, font=f, fill=ink, anchor="lm")
            d.text((W - b * 4, cy), miles, font=f, fill=ink, anchor="rm")
        else:
            f = fit(d, line, HIGHWAY, lh * 0.8, W - 8 * b)
            d.text((W / 2, cy), line, font=f, fill=ink, anchor="mm")
    return im


def gas(W, H, lines):
    """A small station's pole sign: the name on a green panel, and a white price board under it with red digits."""
    im = Image.new("RGB", (W, H), (40, 40, 38))
    d = ImageDraw.Draw(im)
    b = max(2, round(W * 0.03))
    name, prices = lines[0].split("|"), [l.split("|") for l in lines[1:]]
    nh = round(H * 0.34)
    d.rectangle([b, b, W - 1 - b, nh], fill=FACE["gas"])
    f = fit(d, name[0], HIGHWAY, nh * 0.55, W - 6 * b)
    d.text((W / 2, b + nh * 0.36), name[0], font=f, fill=WHITE, anchor="mm")
    if len(name) > 1:
        f = fit(d, name[1], HIGHWAY, nh * 0.3, W - 6 * b)
        d.text((W / 2, b + nh * 0.76), name[1], font=f, fill=(250, 214, 92), anchor="mm")
    top = nh + b
    d.rectangle([b, top, W - 1 - b, H - 1 - b], fill=(244, 243, 236))
    rh = (H - 1 - b - top) / max(1, len(prices))
    for i, (grade, price) in enumerate(prices):
        cy = top + rh * (i + 0.5)
        if i:
            d.line([2 * b, top + rh * i, W - 2 * b, top + rh * i], fill=(200, 198, 190), width=max(1, b // 2))
        f = fit(d, grade.upper(), HIGHWAY, rh * 0.36, W * 0.36)
        d.text((3 * b, cy), grade.upper(), font=f, fill=(40, 40, 40), anchor="lm")
        f = font(HIGHWAY, rh * 0.8)
        x9 = W - 3 * b - rh * 0.28
        d.text((x9 - b, cy + rh * 0.04), price, font=f, fill=(196, 28, 32), anchor="rm")
        s = font(HIGHWAY, rh * 0.3)                       # the 9/10 of a cent, stacked
        d.text((x9 + rh * 0.12, cy - rh * 0.14), "9", font=s, fill=(196, 28, 32), anchor="mm")
        d.line([x9, cy, x9 + rh * 0.25, cy], fill=(196, 28, 32), width=max(1, round(rh * 0.03)))
        d.text((x9 + rh * 0.12, cy + rh * 0.16), "10", font=s, fill=(196, 28, 32), anchor="mm")
    return im


def lawyer(W, H, lines):
    """An accident lawyer's billboard, in the yellow and navy of the genre: the question, the name, the number."""
    navy, yellow = (16, 32, 84), FACE["lawyer"]
    name, law, phone = (lines + ["", "", ""])[:3]
    im = Image.new("RGB", (W, H), yellow)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W - 1, round(H * 0.24)], fill=navy)
    f = fit(d, "HURT IN A CRASH?", HEAVY, H * 0.17, W * 0.9)
    d.text((W / 2, H * 0.12), "HURT IN A CRASH?", font=f, fill=(255, 255, 255), anchor="mm")
    f = fit(d, name, HEAVY, H * 0.27, W * 0.92)
    d.text((W / 2, H * 0.42), name, font=f, fill=navy, anchor="mm")
    f = fit(d, law, BOLD, H * 0.13, W * 0.8)
    d.text((W / 2, H * 0.6), law, font=f, fill=navy, anchor="mm")
    d.rounded_rectangle([W * 0.18, H * 0.7, W * 0.82, H * 0.94], radius=H * 0.04, fill=(196, 28, 32))
    f = fit(d, phone, HEAVY, H * 0.19, W * 0.6)
    d.text((W / 2, H * 0.82), phone, font=f, fill=(255, 255, 255), anchor="mm")
    return im


def tourism(W, H, lines):
    """A county tourism board: a coral field, a sunset over the sea beside a headland, the welcome in white."""
    welcome, county, tag = (lines + ["", "", ""])[:3]
    im = Image.new("RGB", (W, H), FACE["tourism"])
    d = ImageDraw.Draw(im)
    s = H * 0.9                                           # the picture: a square panel on the left
    x0, y0 = H * 0.05, H * 0.05
    for k in range(int(s * 0.62)):                        # sky from gold to coral
        t = k / (s * 0.62)
        c = tuple(int(a + (b - a) * t) for a, b in zip((255, 200, 90), (240, 110, 70)))
        d.line([x0, y0 + k, x0 + s, y0 + k], fill=c)
    d.ellipse([x0 + s * 0.42, y0 + s * 0.38, x0 + s * 0.74, y0 + s * 0.7], fill=(255, 236, 170))
    d.rectangle([x0, y0 + s * 0.62, x0 + s, y0 + s], fill=(20, 92, 140))
    for k in range(4):                                    # swells
        yy = y0 + s * (0.68 + 0.08 * k)
        d.line([x0 + s * 0.08, yy, x0 + s * 0.92, yy], fill=(170, 220, 235), width=max(1, round(s * 0.012)))
    d.polygon([(x0, y0 + s * 0.62), (x0, y0 + s * 0.44), (x0 + s * 0.2, y0 + s * 0.5), (x0 + s * 0.38, y0 + s * 0.62)],
              fill=(58, 70, 92))                          # a headland, far off; no cypress (the Lone Cypress is a trademark)
    left = x0 + s + H * 0.07
    f = fit(d, welcome, BOLD, H * 0.15, W - left - H * 0.06)
    d.text((left, H * 0.2), welcome, font=f, fill=(255, 255, 255), anchor="lm")
    f = fit(d, county, HEAVY, H * 0.3, W - left - H * 0.06)
    d.text((left, H * 0.48), county, font=f, fill=(255, 255, 255), anchor="lm")
    d.rectangle([left, H * 0.68, max(left, W - H * 0.06), H * 0.69], fill=(255, 255, 255))
    f = fit(d, tag, BOLD, H * 0.12, W - left - H * 0.06)
    d.text((left, H * 0.82), tag, font=f, fill=(255, 244, 220), anchor="lm")
    return im


KEYCOL = (255, 0, 255)                                        # outside a diamond's face: made transparent by sprite()


def warning(W, H, which="right"):
    """A warning sign: a yellow diamond with a black border and a curve arrow (SIGN "left" or "right"; "winding" for a
    winding road). Drawn on KEYCOL, which sprite() keys out."""
    im = Image.new("RGB", (W, H), KEYCOL)
    d = ImageDraw.Draw(im)
    bw = max(2, int(W * 0.045))
    d.polygon([(W / 2, 0), (W - 1, H / 2), (W / 2, H - 1), (0, H / 2)], fill=(255, 204, 0), outline=(20, 20, 20), width=bw)
    d.polygon([(W / 2, bw * 1.4), (W - 1 - bw * 1.4, H / 2), (W / 2, H - 1 - bw * 1.4), (bw * 1.4, H / 2)], outline=(20, 20, 20), width=max(1, bw // 2))
    s = W * 0.012                                             # the arrow: a stem that bends to one side, with a head
    pts = [(0, 22), (0, 8), (1, 2), (4, -3), (8, -6)] if which != "winding" else [(0, 22), (0, 14), (-5, 8), (-5, 2), (0, -3), (0, -6)]
    sgn = -1 if which == "left" else 1
    line = [(W / 2 + sgn * px * s, H / 2 + py * s) for px, py in pts]
    d.line(line, fill=(20, 20, 20), width=max(2, int(s * 3.2)), joint="curve")
    tip = line[-1]
    dx, dy = tip[0] - line[-2][0], tip[1] - line[-2][1]
    L = max(np.hypot(dx, dy), 1e-3)
    ux, uy = dx / L, dy / L
    hl = s * 5
    d.polygon([(tip[0] + ux * hl, tip[1] + uy * hl), (tip[0] - uy * hl * 0.6, tip[1] + ux * hl * 0.6), (tip[0] + uy * hl * 0.6, tip[1] - ux * hl * 0.6)], fill=(20, 20, 20))
    return im


def face(w, h, kind=None, text=None):
    """The sign's face, w x h, as an RGB array (drawn large and reduced, so small faces stay clean)."""
    kind, lines = kind or KIND, (text or SIGN).split(";")
    S = int(np.clip(np.ceil(1200 / max(w, 1)), 1, 15))
    W, H = max(w, 8) * S, max(h, 4) * S
    if kind in ("distance", "guide"):
        im = caltrans(W, H, GREEN, lines, kind)
    elif kind in ("park", "services"):
        im = caltrans(W, H, FACE[kind], lines, kind)
    elif kind == "regulatory":
        im = caltrans(W, H, WHITE, lines, kind, ink=(20, 20, 20))
    elif kind == "shop":
        im = caltrans(W, H, FACE["shop"], lines, kind, ink=FACE["gas"])
    elif kind == "warning":
        im = warning(W, H, lines[0])
    else:
        im = {"gas": gas, "lawyer": lawyer, "tourism": tourism}[kind](W, H, lines)
    return np.asarray(im.resize((max(w, 1), max(h, 1)), Image.LANCZOS))


def sprite(w, h, ground_dy, kind=None):
    """The face on its posts (two for a guide sign, one for a gas sign), as RGBA, h + ground_dy tall."""
    kind = kind or KIND
    H = max(h, h + int(ground_dy))
    im = Image.new("RGBA", (w, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pw = max(2, round(w * (0.07 if kind == "gas" else 0.035)))
    for px in ((w * 0.5,) if kind in ("gas", "warning") else (w * 0.22, w * 0.78)):   # galvanised posts, a little darker in shade
        d.rectangle([px - pw / 2, h - 2, px + pw / 2, H - 1], fill=(118, 116, 110, 255))
        d.rectangle([px + pw * 0.1, h - 2, px + pw / 2, H - 1], fill=(92, 90, 86, 255))
    fc = face(w, h, kind)
    if kind == "warning":                                     # a diamond: only the face itself, keyed off KEYCOL
        a = 255 - np.clip(255 - np.abs(fc.astype(np.int16) - np.int16(KEYCOL)).sum(2) * 2, 0, 255).astype(np.uint8)
        a = 255 - a
        fcim = Image.fromarray(np.dstack([fc, a]).astype(np.uint8), "RGBA")
        im.alpha_composite(fcim, (0, 0))
    else:
        im.paste(Image.fromarray(fc), (0, 0))
    return im


def paste(src, out, x, y, w, h, ground):
    im = Image.open(src).convert("RGBA")
    im.alpha_composite(sprite(w, h, ground - y - h), (x, y))
    im.convert("RGB").save(out)


def quad(src, out, pts):
    im = cv2.cvtColor(np.asarray(Image.open(src).convert("RGB")), cv2.COLOR_RGB2BGR)
    q = np.float32(pts)
    w = int(max(np.hypot(*(q[1] - q[0])), np.hypot(*(q[2] - q[3])))) + 1
    h = int(max(np.hypot(*(q[3] - q[0])), np.hypot(*(q[2] - q[1])))) + 1
    im = draw(im, q, w, h, None)
    Image.fromarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)).save(out)


def order(box):
    """Four points as top left, top right, bottom right, bottom left."""
    box = np.float32(box)
    box = box[np.argsort(box[:, 1])]
    top, bot = box[:2][np.argsort(box[:2, 0])], box[2:][np.argsort(box[2:, 0])]
    return np.float32([top[0], top[1], bot[1], bot[0]])


def quadrilateral(c):
    """The four corners of a contour: its polygon if it simplifies to four points, else its rotated rectangle."""
    hull = cv2.convexHull(c)
    peri = cv2.arcLength(hull, True)
    for eps in (0.02, 0.04, 0.06, 0.08):
        p = cv2.approxPolyDP(hull, eps * peri, True)
        if len(p) == 4:
            return order(p[:, 0, :])
    return order(cv2.boxPoints(cv2.minAreaRect(c)))


def find(frame, prev):
    """The first distance sign's finder: the most rectangular saturated-green patch of sign shape, anywhere."""
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
    return order(box)


TEMPLATES = {}
OWN = []                                                      # TRACK=self: the clip's own sign, as last seen


def template(w, h, own=True):
    """What to look for, w x h, grey float32: the sign as the clip itself draws it (TRACK=self, the default: it follows
    a sign the model drew, or one it redrew differently, far better), or our face (cached)."""
    if OWN and own:
        return cv2.resize(OWN[0], (w, h), interpolation=cv2.INTER_AREA)
    if (w, h) not in TEMPLATES:
        TEMPLATES[(w, h)] = cv2.cvtColor(face(w, h), cv2.COLOR_RGB2GRAY).astype(np.float32)
    return TEMPLATES[(w, h)]


def straighten(grey, q, w, h):
    """The quadrilateral q of the frame, straightened to w x h."""
    M = cv2.getPerspectiveTransform(np.float32(q), np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
    return cv2.warpPerspective(grey, M, (w, h), flags=cv2.INTER_AREA).astype(np.float32)


def locate(grey, pred):
    """The face near where it should be. Coarse: the face matched at a few sizes round pred (normalised correlation);
    while it leaves the frame, only the part still inside is matched. Fine: an ECC homography for the corners, when the
    whole face is in view. Returns (corners, score) or (None, score)."""
    H, W = grey.shape
    x0, y0 = pred.min(0)
    x1, y1 = pred.max(0)
    w0, h0 = x1 - x0, y1 - y0
    best = None
    for s in (0.95, 0.975, 1.0, 1.025, 1.05):
        tw, th = int(round(w0 * s)), int(round(h0 * s))
        if tw < 10 or th < 5:
            continue
        bx0, by0 = x0 + (w0 - tw) / 2, y0 + (h0 - th) / 2
        cx0, cy0 = int(max(0, np.ceil(2 - bx0))), int(max(0, np.ceil(2 - by0)))       # the part inside the frame
        cx1, cy1 = int(min(tw, np.floor(W - 2 - bx0))), int(min(th, np.floor(H - 2 - by0)))
        if cx1 - cx0 < max(10, 0.35 * tw) or cy1 - cy0 < max(5, 0.35 * th):
            continue
        m = int(0.4 * max(tw, th) + 6)
        X0, Y0 = int(bx0 + cx0 - m), int(by0 + cy0 - m)
        X1, Y1 = X0 + (cx1 - cx0) + 2 * m, Y0 + (cy1 - cy0) + 2 * m
        X0, Y0, X1, Y1 = max(0, X0), max(0, Y0), min(W, X1), min(H, Y1)
        if X1 - X0 <= cx1 - cx0 or Y1 - Y0 <= cy1 - cy0:
            continue
        region = grey[Y0:Y1, X0:X1].astype(np.float32)
        for own in ((True, False) if OWN else (False,)):      # the sign as the clip draws it, and as we drew it
            res = cv2.matchTemplate(region, template(tw, th, own)[cy0:cy1, cx0:cx1], cv2.TM_CCOEFF_NORMED)
            _, sc, _, loc = cv2.minMaxLoc(res)
            if best is None or sc > best[0]:
                best = (sc, X0 + loc[0] - cx0, Y0 + loc[1] - cy0, tw, th, (cx0, cy0, cx1, cy1) != (0, 0, tw, th), own)
    if best is None:
        return None, 0.0
    sc, bx, by, tw, th, partial, own = best
    box = np.float32([[bx, by], [bx + tw, by], [bx + tw, by + th], [bx, by + th]])
    if sc < 0.3:
        return None, sc
    if partial:
        return box, sc
    m = int(0.25 * max(tw, th) + 4)
    X0, Y0, X1, Y1 = max(0, bx - m), max(0, by - m), min(W, bx + tw + m), min(H, by + th + m)
    persp = KIND in ("lawyer", "tourism")                     # billboards stand at an angle; road signs face us
    try:
        init = np.float32([[1, 0, bx - X0], [0, 1, by - Y0], [0, 0, 1]])
        cc, Hm = cv2.findTransformECC(template(tw, th, own), grey[Y0:Y1, X0:X1].astype(np.float32), init if persp else init[:2],
                                      cv2.MOTION_HOMOGRAPHY if persp else cv2.MOTION_AFFINE,
                                      (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-4), None, 3)
        corners = np.float32([[[0, 0], [tw, 0], [tw, th], [0, th]]])
        q = (cv2.perspectiveTransform(corners, Hm) if persp else cv2.transform(corners, Hm))[0] + np.float32([X0, Y0])
        if cc > 0.4 and np.abs(q - box).max() < 0.2 * tw + 2 and sane(q, tw / th):
            return q, sc
    except cv2.error:
        pass
    return box, sc


def draw(f, q, w, h, gamut):
    """Paint the face into the corners q. With gamut (face colour, white, in Lab), only pixels that look like sign are
    painted, so whatever passes in front of the sign stays in front."""
    H, W = f.shape[:2]
    fc = cv2.cvtColor(face(w * 2, h * 2), cv2.COLOR_RGB2BGR)
    src_q = np.float32([[0, 0], [w * 2, 0], [w * 2, h * 2], [0, h * 2]])
    M = cv2.getPerspectiveTransform(src_q, np.float32(q))
    warped = cv2.warpPerspective(fc, M, (W, H), flags=cv2.INTER_AREA)
    mask = cv2.warpPerspective(np.full((h * 2, w * 2), 255, np.uint8), M, (W, H))
    if gamut is not None:
        lab = cv2.cvtColor(f, cv2.COLOR_BGR2LAB).astype(np.float32)
        a, b = gamut
        near = lab[mask > 128]
        near = near[np.linalg.norm(near - a, axis=1) < 60]
        if len(near) > 20:                                    # the face's colour here: in sun or in shade, as it is now
            a = np.median(near, axis=0)
        t = np.clip(((lab - a) @ (b - a)) / max(float((b - a) @ (b - a)), 1), 0, 1)
        dist = np.linalg.norm(lab - (a + t[..., None] * (b - a)), axis=2)
        keep = (dist > 46).astype(np.uint8) * 255             # an occluder: not face colour, not white, not between
        keep = cv2.morphologyEx(keep, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        # A ring just outside the corners: whatever the model left of its own lettering there turns face colour.
        c = np.float32(q).mean(0)
        big = cv2.warpPerspective(np.full((h * 2, w * 2), 255, np.uint8),
                                  cv2.getPerspectiveTransform(src_q, (np.float32(q) - c) * 1.08 + c), (W, H))
        ring = cv2.min(cv2.min(big, 255 - mask), 255 - keep).astype(np.float32)[..., None] / 255.0
        fill = cv2.cvtColor(np.uint8([[np.clip(a, 0, 255)]]), cv2.COLOR_LAB2BGR)[0, 0].astype(np.float32)
        f = (f * (1 - ring) + fill * ring).astype(np.uint8)
        mask = cv2.min(mask, 255 - keep)
    mask = cv2.GaussianBlur(mask, (3, 3), 0)[..., None] / 255.0
    inside = mask[..., 0] > 0.9
    g = f[inside]
    # Keep the scene's light on the face: match its brightness to the model's.
    gain = float(np.clip(g.mean() / max(warped[inside].mean(), 1), 0.6, 1.4)) if len(g) else 1.0
    return (f * (1 - mask) + np.clip(warped * gain, 0, 255) * mask).astype(np.uint8)


def frames(src):
    """The clip's frames one at a time, and its frame rate: a whole clip in memory (about a gigabyte) does not fit
    beside a browser and an editor on a 24 GB machine, and the swapping made a minute's work take most of an hour."""
    cap = cv2.VideoCapture(src)

    def gen():
        while True:
            ok, f = cap.read()
            if not ok:
                return
            yield f
    return gen(), cap.get(cv2.CAP_PROP_FPS) or 24


class Writer:
    """Frames out to an H.264 mp4 (via a temporary mp4v file)."""
    def __init__(self, out, fps):
        self.out, self.fps, self.vw = out, fps, None

    def write(self, f):
        if self.vw is None:
            self.vw = cv2.VideoWriter(self.out + ".tmp.mp4", cv2.VideoWriter_fourcc(*"mp4v"), self.fps, (f.shape[1], f.shape[0]))
        self.vw.write(f)

    def close(self):
        if self.vw is None:
            sys.exit(f"{self.out}: no frames read")
        self.vw.release()
        os.system(f'ffmpeg -v error -y -i "{self.out}.tmp.mp4" -c:v libx264 -crf 16 -pix_fmt yuv420p "{self.out}" && rm "{self.out}.tmp.mp4"')


def step_on(g_prev, q_prev, grey, pred):
    """The sign as it was a frame ago, aligned onto this frame (ECC, affine, from pred): consecutive frames look alike
    even when the model has redrawn the sign beyond any stored template. For the whole face in view only."""
    H, W = grey.shape
    tw = int(np.hypot(*(q_prev[1] - q_prev[0])))
    th = int(np.hypot(*(q_prev[3] - q_prev[0])))
    x0, y0 = pred.min(0)
    x1, y1 = pred.max(0)
    if tw < 16 or th < 8 or x0 < 1 or y0 < 1 or x1 > W - 2 or y1 > H - 2:
        return None, 0.0
    T = straighten(g_prev, q_prev, tw, th)
    m = int(0.2 * max(tw, th) + 4)
    X0, Y0, X1, Y1 = int(max(0, x0 - m)), int(max(0, y0 - m)), int(min(W, x1 + m)), int(min(H, y1 + m))
    A = cv2.getAffineTransform(np.float32([[0, 0], [tw, 0], [0, th]]), np.float32([pred[0], pred[1], pred[3]]) - np.float32([X0, Y0]))
    try:
        cc, A = cv2.findTransformECC(T, grey[Y0:Y1, X0:X1].astype(np.float32), A.astype(np.float32), cv2.MOTION_AFFINE,
                                     (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-4), None, 3)
    except cv2.error:
        return None, 0.0
    q = cv2.transform(np.float32([[[0, 0], [tw, 0], [tw, th], [0, th]]]), A)[0] + np.float32([X0, Y0])
    return q, cc


def colour_track(src, q0, start=0):
    """TRACK=colour: a plain board (a shop's blank sign board) followed as the patch of its own colour, from start on.
    A blank board gives a template nothing to hold, but its light face against sky and trees is a clean patch. When it
    leaves the frame, the part still in view and its last whole shape give the whole board."""
    fr, _ = frames(src)
    quads, prev, ref, aspect, lost = {}, q0.copy(), None, None, 0
    for k, f in enumerate(fr):
        if k < start:
            continue
        H, W = f.shape[:2]
        if ref is None:
            x0, y0 = q0.min(0)
            x1, y1 = q0.max(0)
            lab = cv2.cvtColor(f, cv2.COLOR_BGR2LAB).astype(np.float32)
            ref = np.median(lab[int(y0 + 0.2 * (y1 - y0)):int(y1 - 0.2 * (y1 - y0)), int(x0 + 0.15 * (x1 - x0)):int(x1 - 0.15 * (x1 - x0))].reshape(-1, 3), 0)
        x0, y0 = prev.min(0)
        x1, y1 = prev.max(0)
        m = 0.25 * (x1 - x0) + 8
        X0, Y0, X1, Y1 = int(max(0, x0 - m)), int(max(0, y0 - m)), int(min(W, x1 + m)), int(min(H, y1 + m))
        if X1 - X0 < 8 or Y1 - Y0 < 8:
            break
        lab = cv2.cvtColor(f[Y0:Y1, X0:X1], cv2.COLOR_BGR2LAB).astype(np.float32)
        mask = cv2.morphologyEx((np.linalg.norm(lab - ref, axis=2) < 22).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best, score = None, 0.3
        for c in cnts:
            if cv2.contourArea(c) < 50:
                continue
            q = quadrilateral(c) + np.float32([X0, Y0])
            inter, _ = cv2.intersectConvexConvex(q, prev)
            iou = inter / max(cv2.contourArea(q) + cv2.contourArea(prev) - inter, 1)
            if iou > score:
                best, score = q, iou
        if best is None:
            lost += 1
            if lost > 6:
                break
            continue
        lost = 0
        hgt = np.hypot(*(best[3] - best[0]))
        cut = best[:, 0].max() >= W - 2, best[:, 0].min() <= 1
        if not any(cut):
            aspect = np.hypot(*(best[1] - best[0])) / max(hgt, 1)
        elif aspect:                                          # leaving the frame: rebuild the side beyond the edge
            u = (best[1] - best[0]) / max(np.hypot(*(best[1] - best[0])), 1)
            if cut[0]:
                best = np.float32([best[0], best[0] + u * hgt * aspect, best[3] + u * hgt * aspect, best[3]])
            else:
                best = np.float32([best[1] - u * hgt * aspect, best[1], best[2], best[2] - u * hgt * aspect])
            if np.hypot(*(best[1] - best[0])) * 0.15 > (min(best[:, 0].max(), W) - max(best[:, 0].min(), 0)):
                break                                         # all but gone
        quads[k] = best
        prev = best
    return quads


def ahead(hist):
    """Where the sign will be next frame, from how it has moved. Driving forward, a sign grows away from the focus of
    expansion, and the inverse of its width falls in a straight line with time (it is its distance). So: fit 1/width
    against frame, and the centre against width (whose intercept is the focus), and scale the last corners about the
    focus by the growth. A sign that hardly grows (a hold) just keeps drifting as it did."""
    hs = hist[-24:]
    n = len(hs)
    if n < 4:
        return hist[-1]
    t = np.arange(n, dtype=np.float64)
    wd = np.array([np.hypot(*(q[1] - q[0])) for q in hs])
    c = np.array([q.mean(0) for q in hs], dtype=np.float64)
    last = hs[-1]
    if wd.max() / max(wd.min(), 1) < 1.05:
        return last + (c[-1] - c[max(0, n - 4)]) / min(3, n - 1)
    inv = np.polyfit(t, 1 / wd, 1)
    nxt = np.polyval(inv, n)
    if nxt <= 0:
        return last
    g = float(np.clip((1 / nxt) / wd[-1], 0.9, 1.15))
    A = np.vstack([np.ones(n), wd]).T
    foe = np.linalg.lstsq(A, c, rcond=None)[0][0]
    return (foe + (last - foe) * g).astype(np.float32)


def sane(q, aspect):
    """A sign face: about its own shape, square-cornered, opposite edges about equal."""
    e = [np.hypot(*(q[(i + 1) % 4] - q[i])) for i in range(4)]
    if min(e) < 2 or not 0.8 < e[0] / e[2] < 1.25 or not 0.8 < e[1] / e[3] < 1.25:
        return False
    if not 0.7 < (e[0] + e[2]) / (e[1] + e[3]) / aspect < 1.4:
        return False
    u, v = q[1] - q[0], q[3] - q[0]
    return abs(float(u @ v)) / (np.hypot(*u) * np.hypot(*v)) < 0.12          # within about 7 degrees of square


def level(q):
    """The quad re-levelled about its centre: the same centre, width and height, square to the frame. The ECC fit lets a
    face rotate as it grows (the Carmel city-limit sign leaned over the model's level face, 20 October); a road sign on
    its posts stays level however the posts lean in perspective."""
    c = q.mean(0)
    w = (np.hypot(*(q[1] - q[0])) + np.hypot(*(q[2] - q[3]))) / 2
    h = (np.hypot(*(q[3] - q[0])) + np.hypot(*(q[2] - q[1]))) / 2
    return np.float32([[c[0] - w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] + h / 2], [c[0] - w / 2, c[1] + h / 2]])


def smooth(quads, n):
    """The tracked corners steadied over time: in each run of consecutive frames, a median over n frames throws out a
    frame whose fit jumped (a corner more than a few px, or 8% of the width, from the median track), then a moving
    average over n. A repainted face that jitters while its post stands still (the Big Sur distance sign, 20 October)
    is the per-frame fit's noise, not the sign's motion."""
    if n < 3 or len(quads) < 3:
        return quads
    keys = sorted(quads)
    runs, run = [], [keys[0]]
    for a, b in zip(keys, keys[1:]):
        if b == a + 1:
            run.append(b)
        else:
            runs.append(run)
            run = [b]
    runs.append(run)
    out = dict(quads)
    half = n // 2
    for run in runs:
        if len(run) < 3:
            continue
        arr = np.stack([quads[k] for k in run]).reshape(len(run), 8)
        med = np.stack([np.median(arr[max(0, i - half):i + half + 1], axis=0) for i in range(len(run))])
        width = np.maximum(np.abs(arr[:, 2] - arr[:, 0]), 1)
        jump = np.abs(arr - med).max(1) > np.maximum(3, 0.08 * width)
        arr = np.where(jump[:, None], med, arr)
        sm = np.stack([arr[max(0, i - half):i + half + 1].mean(0) for i in range(len(arr))])
        for k, q in zip(run, sm):
            out[k] = q.reshape(4, 2).astype(np.float32)
    return out


ERASE_UNTIL = int(os.environ.get("ERASE_UNTIL", 0))   # frames before this get the sign painted out instead (ERASE_UNTIL=-1: all)
if ERASE_UNTIL < 0:
    ERASE_UNTIL = 10 ** 9


def erase(f, q):
    """Paint the sign out: its face (grown a quarter) and the post below it are filled from their surroundings. For a
    far sign that would stand in front of a nearer one, or a repaint that will not sit still; while it is small the fill
    is invisible, so erase a sign that grows large only until it matters (ERASE_UNTIL)."""
    H, W = f.shape[:2]
    q = np.float32(q); c = q.mean(0); big = (q - c) * 1.25 + c
    mask = np.zeros((H, W), np.uint8)
    cv2.fillPoly(mask, [np.int32(np.round(big))], 255)
    w = float(np.ptp(q[:, 0])); h = float(np.ptp(q[:, 1]))
    x0, x1 = int(c[0] - 0.2 * w), int(c[0] + 0.2 * w)
    cv2.rectangle(mask, (max(x0, 0), int(q[:, 1].max())), (min(x1, W - 1), min(int(q[:, 1].max() + 1.3 * h), H - 1)), 255, -1)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8))
    return cv2.inpaint(f, mask, 5, cv2.INPAINT_TELEA)


def fix(src, out, box=None, start=0, first=0, last=None):
    fr, fps = frames(src)
    wr, n, done = Writer(out, fps), 0, 0
    if box is None:                                           # the first distance sign: green, found anywhere
        prev, quads = None, {}
        for k, f in enumerate(fr):                            # pass 1: find it in every frame
            q = find(f, prev)
            if q is not None and prev is not None and np.abs(q - prev).max() < 30:
                q = 0.6 * q + 0.4 * prev                       # steady the corners
            if q is not None:
                prev = q
                quads[k] = q
            n += 1
        if os.environ.get("LEVEL"):
            quads = {k: level(q) for k, q in quads.items()}
        quads = smooth(quads, int(os.environ.get("SMOOTH", 7)))
        fr, _ = frames(src)                                   # pass 2: paint
        for k, f in enumerate(fr):
            q = quads.get(k)
            if q is not None:
                w, h = int(np.hypot(*(q[1] - q[0]))) + 1, int(np.hypot(*(q[3] - q[0]))) + 1
                f = draw(f, q, w, h, None)
                done += 1
            wr.write(f)
    else:
        x, y, w, h = box
        q0 = np.float32([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
        grey, at_start = [], None                             # pass 1: grey frames to track in
        for k, f in enumerate(fr):
            grey.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))
            if k == start:
                at_start = f
        n = len(grey)
        lab = cv2.cvtColor(at_start, cv2.COLOR_BGR2LAB).astype(np.float32)
        patch = lab[int(y + h * 0.15):int(y + h * 0.85), int(x + w * 0.1):int(x + w * 0.9)].reshape(-1, 3)
        base = cv2.cvtColor(np.uint8([[FACE.get(KIND, GREEN)[::-1]]]), cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
        near = patch[np.linalg.norm(patch - base, axis=1) < 60]
        ref = np.median(near if len(near) > 8 else patch, axis=0)   # the face's colour as the model rendered it
        white = cv2.cvtColor(np.uint8([[WHITE[::-1]]]), cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
        gamut = None if KIND in ("lawyer", "tourism", "gas", "regulatory", "shop") else (ref, white)
        self_track = os.environ.get("TRACK", "self") == "self"
        H0, W0 = grey[0].shape
        quads = colour_track(src, q0, start) if os.environ.get("TRACK") == "colour" else {}
        for step in (() if os.environ.get("TRACK") == "colour" else (1, -1)):   # forwards from start, then backwards
            prev, hist, lost, k = q0.copy(), [], 0, start
            if self_track:
                OWN[:] = [straighten(grey[start], q0, int(w * 3), int(h * 3))]
            while first <= k < (n if last is None else min(n, last + 1)):   # a sign the model drew starts at first, ends at last
                pred = ahead(hist) if hist else prev
                # The model's signs do not always move smoothly: near the end they jump. A plain guess (as fast as it
                # just moved, growing as it just grew) is the second opinion on where it should be.
                plain = pred if len(hist) < 2 else (hist[-1] - hist[-1].mean(0)) * np.clip(
                    np.ptp(hist[-1][:, 0]) / max(np.ptp(hist[-2][:, 0]), 1), 0.95, 1.12) + 2 * hist[-1].mean(0) - hist[-2].mean(0)
                q, sc = locate(grey[k], pred)
                whole = q is not None and q[:, 0].min() > 1 and q[:, 1].min() > 1 and q[:, 0].max() < W0 - 2 and q[:, 1].max() < H0 - 2
                off = None if q is None else min(np.hypot(*(q.mean(0) - pred.mean(0))), np.hypot(*(q.mean(0) - plain.mean(0))))
                if q is not None and (not sane(q, w / h) or off > 0.3 * np.ptp(pred[:, 0]) + 4 or not whole and sc < float(os.environ.get("MINPART", 0.6))):
                    q = None                                  # not the sign's shape, not where it should be, or too unsure
                if (q is None or sc < 0.6) and k - step in quads:   # late and large: follow it from the frame before
                    q2, cc = step_on(grey[k - step], quads[k - step], grey[k], pred)
                    if q2 is not None and cc > 0.75 and sane(q2, w / h) and np.hypot(*(q2.mean(0) - pred.mean(0))) < 0.2 * np.ptp(pred[:, 0]) + 4:
                        q, sc, whole = q2, cc, False          # not a fresh view of the sign: no template refresh from it
                if os.environ.get("DEBUG") == "2":
                    why = "" if q is not None else "lost" if sc < 0.3 else "rejected"
                    print("track", k, round(float(sc), 2), None if q is None else np.round(q.mean(0)).tolist(), why)
                if q is not None:
                    if np.abs(q - pred).max() < max(4, 0.15 * np.ptp(pred[:, 0])):
                        q = 0.6 * q + 0.4 * pred               # steady the corners
                    lost = 0
                    quads.setdefault(k, q)
                    if self_track and whole and sc > 0.75 and abs(k - start) % 6 == 0:   # keep up with the model's redrawing
                        OWN[:] = [straighten(grey[k], q, int(w * 3), int(h * 3))]
                elif len(hist) >= 6 and lost < 8:
                    q, lost = pred, lost + 1                  # lost a moment: look on where it should be, draw nothing
                else:
                    break
                hist.append(q)
                prev = q
                k += step
        if os.environ.get("LEVEL"):                           # a road sign faces us level: no rotation in the fit
            quads = {k: level(q) for k, q in quads.items()}
        quads = smooth(quads, int(os.environ.get("SMOOTH", 7)))
        found = sorted(quads)                                 # short gaps between found frames: in between, corners eased
        for i, j in zip(found, found[1:]):
            for k in range(i + 1, j) if 1 < j - i <= 9 else ():
                t = (k - i) / (j - i)
                quads[k] = quads[i] * (1 - t) + quads[j] * t
        del grey
        fr, _ = frames(src)                                   # pass 2: paint
        for k, f in enumerate(fr):
            q = quads.get(k)
            if q is not None and os.environ.get("GROW"):         # a board a little bigger than the model's covers its edges
                q = (q - q.mean(0)) * float(os.environ["GROW"]) + q.mean(0)
            if q is not None:
                w = int(np.hypot(*(q[1] - q[0]))) + 1
                h = int(np.hypot(*(q[3] - q[0]))) + 1
                if os.environ.get("DEBUG"):
                    print(k, np.round(q.mean(0)).tolist(), w, h)
                if 4 <= w < W0 and 2 <= h < H0:
                    f = erase(f, q) if k < ERASE_UNTIL else draw(f, q, w, h, gamut)
                    done += 1
            wr.write(f)
    wr.close()
    print(f"{out}: sign face redrawn on {done} of {n} frames")


def place(src, out, x, y, w, h, ground):
    """Draw the sign on the first frame and carry it with the scene round its foot (KLT features, similarity fit)."""
    fr, fps = frames(src)
    f0 = next(fr)
    H, W = f0.shape[:2]
    spr = np.asarray(sprite(w, h, ground - y - h))
    rgb = cv2.cvtColor(spr[..., :3], cv2.COLOR_RGB2BGR).astype(np.float32)
    alpha = spr[..., 3].astype(np.float32) / 255
    foot = np.float32([x + w / 2, ground])
    reach = max(w, h, ground - y) * 1.6
    T = np.eye(3, dtype=np.float32)

    tj = src + ".traffic.json"                                # vehicles tracked by traffic.py ([x, y, w, h] in 0..1)
    boxes = json.load(open(tj))["boxes"] if os.path.exists(tj) else []

    def vehicles(k):
        """Integer boxes of the vehicles in frame k, each with its bottom edge (where it meets the road)."""
        out = []
        for bx, by, bw, bh in (boxes[k] if k < len(boxes) else []):
            out.append((int(bx * W) - 2, int(by * H) - 2, int((bx + bw) * W) + 2, int((by + bh) * H) + 2))
        return out

    def region(T, k=0):
        c = (T @ np.float32([*foot, 1]))[:2]
        s = np.sqrt(abs(np.linalg.det(T[:2, :2])))
        m = np.zeros((H, W), np.uint8)
        r = reach * s
        cv2.rectangle(m, (int(c[0] - r), int(c[1] - r * 1.2)), (int(c[0] + r), int(c[1] + r * 0.6)), 255, -1)
        for x0, y0, x1, y1 in vehicles(k):                    # moving vehicles carry no scene
            cv2.rectangle(m, (x0, y0), (x1, y1), 0, -1)
        return m

    g0 = cv2.cvtColor(f0, cv2.COLOR_BGR2GRAY)
    pts = prevp = cv2.goodFeaturesToTrack(g0, 400, 0.01, 4, mask=region(T))
    light = float(os.environ.get("LIGHT", 0.92))                # a painted sign in daylight, a touch under the sky's white
    wr, n, steps, coast = Writer(out, fps), 0, [], False
    for k, f in enumerate(itertools.chain([f0], fr)):
        n += 1
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        fx = (T @ np.float32([*foot, 1]))[0]
        if k > 24 and not coast and not os.environ.get("NOCOAST") and len(steps) >= 5 and (fx > W * 0.85 or fx < W * 0.15 or pts is not None and len(pts) < 100):
            coast = True                                      # the scene round its foot is leaving: carry on as it moved
        if coast:
            T = np.mean(steps[-5:], axis=0).astype(np.float32) @ T
        elif k and pts is not None and len(pts):
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(g0, g, pts, None, winSize=(21, 21), maxLevel=3)
            ok = st[:, 0] == 1
            pts = nxt[ok].reshape(-1, 1, 2)
            if len(pts) >= 6:
                M, inl = cv2.estimateAffinePartial2D(prevp[ok], pts, method=cv2.RANSAC, ransacReprojThreshold=1.5)
                if M is not None:
                    M3 = np.vstack([M, [0, 0, 1]]).astype(np.float32)
                    T = M3 @ T
                    steps.append(M3)
                    pts = pts[inl[:, 0] == 1]
        if k and not coast and (pts is None or len(pts) < 60):
            more = cv2.goodFeaturesToTrack(g, 400, 0.01, 4, mask=region(T, k))
            if more is not None:
                pts = more if pts is None or not len(pts) else np.vstack([pts, more]).astype(np.float32)
        g0, prevp = g, pts
        if os.environ.get("DEBUG"):
            print("place", k, np.round(T @ np.float32([*foot, 1]))[:2].tolist(), round(float(np.sqrt(abs(np.linalg.det(T[:2, :2])))), 3),
                  0 if pts is None else len(pts), "coast" if coast else "")
        A = T @ np.float32([[1, 0, x], [0, 1, y], [0, 0, 1]])
        col = cv2.warpAffine(rgb, A[:2], (W, H), flags=cv2.INTER_AREA)
        a = cv2.warpAffine(alpha, A[:2], (W, H), flags=cv2.INTER_LINEAR)
        fy = (T @ np.float32([*foot, 1]))[1]
        for x0, y0, x1, y1 in vehicles(k):                    # a vehicle nearer than the sign's foot passes in front
            if y1 > fy:
                a[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 0
        a = a[..., None]
        wr.write((f * (1 - a) + np.clip(col * light, 0, 255) * a).astype(np.uint8))
    wr.close()
    sc = float(np.sqrt(abs(np.linalg.det(T[:2, :2]))))
    fx, fy = (T @ np.float32([*foot, 1]))[:2]
    print(f"{out}: sign placed on {n} frames, foot carried by the scene; in the last frame it stands at "
          f"{round(fx - w * sc / 2)} {round(fy - (ground - y) * sc)} {round(w * sc)} {round(h * sc)} {round(fy)} (x y w h ground)")


if __name__ == "__main__":
    cmd, a = sys.argv[1], sys.argv[2:]
    if cmd == "paste":
        paste(a[0], a[1], *(int(v) for v in a[2:7]))
    elif cmd == "quad":
        quad(a[0], a[1], [[float(v) for v in p.split(",")] for p in a[2:6]])
    elif cmd == "fix":
        fix(a[0], a[1], tuple(float(v) for v in a[2:6]) if len(a) >= 6 else None, *(int(v) for v in a[6:9]))
    elif cmd == "place":
        place(a[0], a[1], *(int(v) for v in a[2:7]))
    elif cmd == "face":
        Image.fromarray(face(int(a[1]), int(a[2]))).save(a[0])
