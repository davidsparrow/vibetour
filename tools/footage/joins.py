"""joins.py <build.mp4> <out dir> [fps [seconds]]: a contact sheet of every join in a tour, for review.

For each join (where one clip dissolves into the next, from <build>.inputs.json as build scripts write it with regress.py),
a strip of frames at <fps> (4) spanning <seconds> (3) centred on the dissolve's middle, labelled with the two clip names
and the time. One PNG per join, named joins-NN-<from>-<to>.png, and joins-all.jpg with every strip stacked. A 1 fps strip
of a whole tour can miss a cross-fade, a freeze or a jump in pace at a join; four frames a second show them."""
import json, os, subprocess, sys
import cv2
import numpy as np

build, out = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 4
span = float(sys.argv[4]) if len(sys.argv) > 4 else 3
items = json.load(open(build[:-4] + ".inputs.json"))
os.makedirs(out, exist_ok=True)
t, starts = 0.0, []
for it in items:
    starts.append(t)
    t += it["duration"] - 1.0
cap = cv2.VideoCapture(build)
vfps = cap.get(cv2.CAP_PROP_FPS) or 24
strips = []
for i in range(1, len(items)):
    mid = starts[i] + 0.5                                     # the middle of the 1 s dissolve into clip i
    times = np.arange(mid - span / 2, mid + span / 2 + 1e-6, 1 / fps)
    tiles = []
    for tt in times:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(tt * vfps)))
        ok, f = cap.read()
        if not ok:
            continue
        f = cv2.resize(f, (320, 180), interpolation=cv2.INTER_AREA)
        cv2.putText(f, f"{int(tt // 60)}:{tt % 60:05.2f}", (4, 174), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3)
        cv2.putText(f, f"{int(tt // 60)}:{tt % 60:05.2f}", (4, 174), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        tiles.append(f)
    if not tiles:
        continue
    strip = np.hstack(tiles)
    label = np.full((22, strip.shape[1], 3), 30, np.uint8)
    a, b = items[i - 1]["name"].replace(".mp4", ""), items[i]["name"].replace(".mp4", "")
    cv2.putText(label, f"{i:02d}  {a}  ->  {b}   (dissolve {int(mid // 60)}:{mid % 60:04.1f})", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    strip = np.vstack([label, strip])
    cv2.imwrite(os.path.join(out, f"joins-{i:02d}-{a}-{b}.png"), strip)
    strips.append(strip)
w = max(s.shape[1] for s in strips)
strips = [np.pad(s, ((0, 0), (0, w - s.shape[1]), (0, 0))) for s in strips]
cv2.imwrite(os.path.join(out, "joins-all.jpg"), np.vstack(strips), [cv2.IMWRITE_JPEG_QUALITY, 80])
print(f"{out}: {len(strips)} joins at {fps:g} fps, {span:g} s each; joins-all.jpg")
