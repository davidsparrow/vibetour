"""mirrorlights.py <mirror.mp4> <out.mp4> [dark]: turn a mirror feed's car lights round, for night, dusk and rain.

The mirrors show the forward plate run backwards, so a car that has passed us still shows its headlights as it goes
away, and the car ahead shows its taillights as if it were following us. Behind a real car it's the other way round.
This pass recolours the lights at road level by where they are on the road, as seen in the mirror:

- in the opposite lane (left of the centre line), cars are driving away: red taillights
- in our lane, a car is following us: white headlights
- beyond our edge line, reflector posts catch our own taillights: a dim red

Lamps are found as small, very bright, roundish spots, so lane lines, reflector posts and glare don't count. Lights
above the horizon (house windows, street lamps, the moon) keep their colour. `dark` (default 1) also darkens the rest
of the mirror for night, and turns the road behind red, since it is lit only by the glow of our own taillights; use about 0.35
at night and 1 for dusk or rain, when cars have their lights on but the road behind is still visible.

The feed must be the 16:9 plate's geometry, with the vanishing point at the centre, 45% down (session.sh makes it)."""
import os, sys, cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]
DARK = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
AT = float(os.environ.get("VP_AT", 0.45))
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 24
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
vx, vy = W / 2, H * AT
yy, xx = np.mgrid[:H, :W].astype(np.float32)
down = np.clip((yy - vy) / (H - vy), 0, 1)
# The centre line meets the bottom of the frame about 30% across, and our edge line about 97% across.
centre = vx - down * (vx - 0.30 * W)
edge = vx + down * (0.97 * W - vx)
soft = 2.0 + 6.0 * down                                       # the boundaries blur with distance from the horizon
w_opp = np.clip((centre - xx) / soft + 0.5, 0, 1)             # 1 in the opposite lane
w_sh = np.clip((xx - edge) / soft + 0.5, 0, 1)                 # 1 beyond our edge line
w_own = np.clip(1 - w_opp - w_sh, 0, 1)
road = np.clip((yy - (vy - 0.04 * H)) / (0.04 * H), 0, 1)      # lights at road level only
tail = np.float32([30, 22, 255]); head = np.float32([238, 246, 255])   # BGR
glow_bottom = (np.clip((yy - 0.72 * H) / (0.28 * H), 0, 1) ** 2)[..., None] * np.float32([4, 4, 38])
vw = cv2.VideoWriter(out + ".tmp.mp4", cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
n = 0
while True:
    ok, f = cap.read()
    if not ok: break
    img = f.astype(np.float32)
    b, g, r = img[..., 0], img[..., 1], img[..., 2]
    lum = 0.114 * b + 0.587 * g + 0.299 * r
    # Lamps are small, very bright and compact: bright cores that stand out from their surroundings, kept only as
    # roundish spots, so lane lines, reflector posts and the glow on the road don't count.
    core = ((lum > 215) | ((r > 170) & (r > 1.6 * np.maximum(g, b)))) & (lum - cv2.GaussianBlur(lum, (0, 0), 4) > 25)
    n_, lab, st, cen = cv2.connectedComponentsWithStats(core.astype(np.uint8), 8)
    # Each lamp is redrawn as a clean round light at its centre: smaller and dimmer as a taillight than as a headlight.
    # A lane-line fragment or a glare streak is long in some direction, so its rotated box is thin; it is skipped.
    lamp_t = np.zeros((H, W), np.float32); lamp_h = np.zeros((H, W), np.float32); keep = np.zeros(n_, bool)
    for i in range(1, n_):
        a_ = st[i, cv2.CC_STAT_AREA]; cx, cy = cen[i]
        if a_ > 0.004 * W * H or road[int(cy), int(cx)] < 0.5: continue
        if a_ >= 4:
            ys_, xs_ = np.nonzero(lab == i); (_, _), (rw, rh), _ = cv2.minAreaRect(np.column_stack([xs_, ys_]).astype(np.float32))
            if max(rw, rh) > 2.2 * max(min(rw, rh), 1.0): continue
        rad = np.sqrt(a_ / np.pi)
        if w_opp[int(cy), int(cx)] > 0.5 or w_own[int(cy), int(cx)] > 0.5: keep[i] = True
        if w_opp[int(cy), int(cx)] > 0.5: cv2.circle(lamp_t, (int(cx * 8), int(cy * 8)), int(max(rad * 0.6, 0.6) * 8), 1.0, -1, cv2.LINE_AA, 3)
        elif w_own[int(cy), int(cx)] > 0.5: cv2.circle(lamp_h, (int(cx * 8), int(cy * 8)), int(max(rad * 0.85, 0.7) * 8), 1.0, -1, cv2.LINE_AA, 3)
    lamp = np.clip(lamp_t + lamp_h, 0, 1)
    # The glare of the original lamps goes too: whatever the lamps lit at road level is cut back to the road's level.
    glare = cv2.GaussianBlur(keep[lab].astype(np.float32), (0, 0), 3.0) * road
    lights = lamp_t[..., None] * tail * 0.9 + lamp_h[..., None] * head
    glow = cv2.GaussianBlur(lights, (0, 0), 1.8) * 1.4
    if DARK < 1:
        # At night the road behind is lit only by our own taillights: dim and red. The sky and what's above the
        # horizon keep their colour, darkened.
        red_road = lum[..., None] * np.float32([0.22, 0.2, 0.7]) * DARK + glow_bottom * (1 - DARK)
        bg = (img * DARK) * (1 - road[..., None]) + red_road * road[..., None]
    else:
        bg = img
    bg = bg * (1 - np.clip(lamp + glare * 0.7, 0, 1)[..., None])
    out_f = bg + lights + glow
    vw.write(np.clip(out_f, 0, 255).astype(np.uint8)); n += 1
vw.release()
os.system(f'ffmpeg -v error -y -i "{out}.tmp.mp4" -c:v libx264 -crf 18 -pix_fmt yuv420p "{out}" && rm "{out}.tmp.mp4"')
print(f"{out}: {n} frames, lights turned round, background x{DARK}")
