"""traffic.py <clip.mp4> [more clips]: find the vehicles in a plate and the moments they pass us, for the mirrors.

Runs YOLOX-S (OpenCV's model zoo, COCO classes; MODEL, default docs/sample-videos/models/yolox_s.onnx) on every
other frame, links the boxes into tracks, and writes <clip>.traffic.json:
  "boxes":  per frame (at 24 fps, nearest detection), the vehicle boxes as [x, y, w, h] in 0..1 of the frame, so the
            mirror feed can paint the plate's traffic out (its cars face us, and they pass at the wrong moments);
  "passes": each vehicle that leaves the frame past our left side, close, as {t, kind, colour, lane}: an oncoming
            vehicle that has just gone by. mirrorfeed.py draws it in the mirrors from behind, driving away.
A clip that already has its .traffic.json is skipped (FORCE=1 redoes it).
"""
import json, os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("MODEL", os.path.join(HERE, "../../docs/sample-videos/models/yolox_s.onnx"))
VEHICLES = {1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
SIZE, CONF, NMS = 640, 0.35, 0.45
STEP = 2                                   # detect on every other frame


def detector():
    net = cv2.dnn.readNet(MODEL)
    grids, strides = [], []
    for s in (8, 16, 32):
        n = SIZE // s
        gy, gx = np.mgrid[:n, :n]
        grids.append(np.stack([gx, gy], -1).reshape(-1, 2))
        strides.append(np.full((n * n, 1), s))
    grids, strides = np.concatenate(grids).astype(np.float32), np.concatenate(strides).astype(np.float32)

    def detect(frame):
        h, w = frame.shape[:2]
        r = min(SIZE / h, SIZE / w)
        img = np.full((SIZE, SIZE, 3), 114, np.uint8)
        img[: round(h * r), : round(w * r)] = cv2.resize(frame, (round(w * r), round(h * r)))
        net.setInput(cv2.dnn.blobFromImage(img, 1.0, (SIZE, SIZE), swapRB=False))
        out = net.forward()[0]
        out[:, :2] = (out[:, :2] + grids) * strides
        out[:, 2:4] = np.exp(out[:, 2:4]) * strides
        cls = out[:, 5:].argmax(1)
        score = out[:, 4] * out[np.arange(len(out)), 5 + cls]
        keep = np.isin(cls, list(VEHICLES)) & (score > CONF)
        b, s, c = out[keep, :4], score[keep], cls[keep]
        boxes = np.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 2], b[:, 3]], 1) / r
        idx = cv2.dnn.NMSBoxes(boxes.tolist(), s.tolist(), CONF, NMS)
        idx = np.array(idx).reshape(-1)
        return [((boxes[i] / [w, h, w, h]).tolist(), VEHICLES[int(c[i])], float(s[i])) for i in idx]

    return detect


def iou(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9)


def run(clip, detect):
    out = clip + ".traffic.json"
    if os.path.exists(out) and not os.environ.get("FORCE"):
        return json.load(open(out))
    cap = cv2.VideoCapture(clip)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    frames = []
    k = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append((k, detect(f), f) if k % STEP == 0 else (k, None, None))
        k += 1
    n = k
    # Tracks: link each detection to the track whose last box overlaps it most (or is near, for small fast boxes).
    tracks = []
    for k, dets, img in frames:
        if dets is None:
            continue
        live = [t for t in tracks if k - t["last"] <= 3 * STEP]
        for box, kind, score in sorted(dets, key=lambda d: -d[0][2] * d[0][3]):
            best, bi = None, 0.1
            for t in live:
                o = iou(t["boxes"][-1][1], box)
                if o > bi:
                    best, bi = t, o
            if best is None:
                best = {"boxes": [], "kinds": [], "last": k, "colour": None}
                tracks.append(best)
            else:
                live = [t for t in live if t is not best]
            best["boxes"].append((k, box))
            best["kinds"].append(kind)
            best["last"] = k
            if 0.05 < box[3] < 0.3:                # a mid-sized view of the vehicle: its colour
                x, y, w, h = (np.array(box) * [img.shape[1], img.shape[0], img.shape[1], img.shape[0]]).astype(int)
                patch = img[max(y, 0) + h // 4: y + h * 3 // 4, max(x, 0) + w // 4: x + w * 3 // 4]
                if patch.size:
                    best["colour"] = [int(v) for v in np.median(patch.reshape(-1, 3), 0)[::-1]]
    passes = []
    for t in tracks:
        if len(t["boxes"]) < 3:
            continue
        k, (x, y, w, h) = t["boxes"][-1]
        k0, b0 = t["boxes"][0]
        grew = h > 1.6 * b0[3]
        kind = max(set(t["kinds"]), key=t["kinds"].count)
        # Gone past our left side: the box was last seen big at the left edge of the frame, and it grew on the way.
        if x < 0.04 and h > 0.12 and grew and x + w / 2 < 0.3:
            passes.append({"t": round(k / fps, 3), "kind": kind, "colour": t["colour"] or [150, 150, 150], "lane": "opposite"})
    boxes = [[] for _ in range(n)]
    for t in tracks:
        bs = t["boxes"]
        for (ka, a), (kb, b) in zip(bs, bs[1:] + [bs[-1]]):
            for k in range(ka, min(kb + 1 if kb > ka else ka + STEP, n)):
                a_ = np.array(a) + (np.array(b) - np.array(a)) * ((k - ka) / (kb - ka) if kb > ka else 0)
                boxes[k].append([round(float(v), 4) for v in a_])
    res = {"fps": fps, "frames": n, "boxes": boxes, "passes": passes}
    json.dump(res, open(out, "w"))
    return res


if __name__ == "__main__":
    detect = detector()
    for clip in sys.argv[1:]:
        r = run(clip, detect)
        print(f"{os.path.basename(clip)}: {sum(1 for b in r['boxes'] if b)} frames with vehicles, passes "
              + ", ".join(f"{p['t']:.1f}s {p['kind']}" for p in r["passes"]))
