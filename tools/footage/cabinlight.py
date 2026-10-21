"""cabinlight.py <composite.mp4> <out.mp4> <cabin.csv> [car dir]: the cabin's light level per frame, after composite.sh.

composite.sh lights the cabin at one level for the whole session (CABIN: 1 at midday, 0.6 in rain, 0.35 at night). A tour
that drives into fog or rain and out again needs the level to follow the clips: cabin.csv (frame,level; session.sh writes
it from CABINS=<clip:level,…>) gives the level each frame wants, and this pass scales everything that is not glass (the
dash, the pillars, the wheel and hands, the mirror housings) by level/BASE, where BASE (1) is the level the composite was
made at. As in composite.sh, the bright pixels of the instrument cluster and the car's "lit" boxes keep their backlight,
and the screens dim only to 55% + 45% of the level. Frames whose level equals BASE pass through untouched.

Works on the composite's 1280x720 frame: composite.sh crops the 1200x896 cockpit to 1200x675 and scales by 16/15."""
import json, os, sys, cv2, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vwrite import Reader, Writer
src, out, csv = sys.argv[1], sys.argv[2], sys.argv[3]
car = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else os.environ.get("CAR", os.path.join(os.path.dirname(__file__), "../../cars/grand-tourer"))
BASE = float(os.environ.get("BASE", 1))
cfg = json.load(open(os.path.join(car, "car.json")))
W, H, K = 1280, 720, 16 / 15
levels = [float(l.split(",")[1]) for l in open(csv).read().split("\n")[1:] if l]
def mask(name):
    m = cv2.imread(os.path.join(car, name), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    return cv2.resize(m[:675], (W, H), interpolation=cv2.INTER_AREA)
glass = np.clip(mask("glass-mask.png") + mask("mirror-mask.png") + (mask("side-window-mask.png") if os.path.exists(os.path.join(car, "side-window-mask.png")) else 0), 0, 1)
cabin = cv2.GaussianBlur(1 - glass, (0, 0), 1.0)[..., None]
def box_mask(boxes):
    m = np.zeros((H, W), np.float32)
    for x, y, w, h in boxes:
        m[int(y * K):int((y + h) * K), int(x * K):int((x + w) * K)] = 1
    return m[..., None]
lit = box_mask(([cfg["cluster"]] if "cluster" in cfg else []) + list(cfg.get("lit", [])))
screens = box_mask(list(cfg.get("screens", {}).values()))
cap = Reader(src); fps = cap.fps
vw = Writer(out, fps, (W, H)); f = 0; changed = 0
while True:
    ok, frame = cap.read()
    if not ok: break
    lv = levels[min(f, len(levels) - 1)] if levels else BASE
    k = lv / BASE
    if abs(k - 1) < 0.005:
        vw.write(frame)
    else:
        img = frame.astype(np.float32)
        plain = img * k
        kept = img * k + np.maximum(img - 90, 0) * (1 - k) * 1.4          # backlit numerals, needles, icons stay lit
        hb = min(1.0, 0.55 + 0.45 * lv) / min(1.0, 0.55 + 0.45 * BASE)   # a real screen dims less than the cabin
        dark = plain * (1 - lit) * (1 - screens) + kept * lit * (1 - screens) + img * hb * screens
        img = img * (1 - cabin) + dark * cabin
        vw.write(np.clip(img, 0, 255).astype(np.uint8)); changed += 1
    f += 1
vw.release()
print(f"{out}: {f} frames, cabin light changed in {changed}")
