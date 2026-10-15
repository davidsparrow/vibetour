#!/bin/bash
# car-build.sh <car dir>: derive a car's glass mask, mirror mask, wheel-and-hands cutout and glass dirt from its cockpit.png
# (the generated still, glass in flat #00FF00), cabin.png (the same still with the wheel and hands removed) and car.json.
set -euo pipefail
C="$1"; T="$(cd "$(dirname "$0")" && pwd)"; V="${PYTHON:-python3}"
eval "$("$V" "$T/car.py" "$C")"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
IFS=: read SX SY SW SH <<< "$SIDE"; IFS=: read RX RY RW RH <<< "$REAR"
# Glass: keyed alpha, inverted, so glass is white (padded by a pixel round the key, since chromakey misreads the border row).
# The windshield is the largest keyed region; the mirrors come from their boxes in car.json, so a mirror cut by the top of the frame
# or by the frame's edge still gets its feed.
ffmpeg -v error -y -i "$C/cockpit.png" -vf "format=rgba,pad=iw+2:ih+2:1:1:color=black,chromakey=$KEY,crop=iw-2:ih-2:1:1,format=rgba,alphaextract,format=gray,lutyuv=y=negval" -frames:v 1 "$W/transparent.png"
# Mirrors: the keyed glass inside each mirror's box in car.json. (masks.py also finds mirror regions by their size, but a
# mirror that touches the frame's top or left edge, as a high slim mirror or the door mirror does, has no closed region.)
ffmpeg -v error -y -f lavfi -i "color=c=black:s=${CW}x${CH}:d=1,format=gray" -frames:v 1 -vf "geq=lum='if(between(X,$SX,$((SX+SW)))*between(Y,$SY,$((SY+SH)))+between(X,$RX,$((RX+RW)))*between(Y,$RY,$((RY+RH))),255,0)'" "$W/mirror-rects.png"
ffmpeg -v error -y -i "$W/transparent.png" -i "$W/mirror-rects.png" -filter_complex "[0:v]format=gray[a];[1:v]format=gray[b];[a][b]blend=all_mode=multiply,gblur=sigma=0.8" -frames:v 1 "$C/mirror-mask.png"
# The windshield is the largest keyed region outside the mirror boxes.
"$V" - "$W/transparent.png" "$W/mirror-rects.png" "$C/glass-mask.png" <<'PY'
import sys, cv2, numpy as np
t, boxes = cv2.imread(sys.argv[1], 0), cv2.imread(sys.argv[2], 0)
bw = ((t > 127) & (boxes < 128)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(bw, 8)
glass = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8) * 255
cv2.imwrite(sys.argv[3], glass); print(f"windshield: {int((glass > 0).sum())} px")
PY
# Side window: the keyed glass that is neither the windshield nor a mirror, on the left of the frame.
"$V" - "$W/transparent.png" "$C/glass-mask.png" "$C/mirror-mask.png" "$C/side-window-mask.png" <<'PY'
import sys, cv2, numpy as np
out = sys.argv[4]
t, g, m = list((cv2.imread(p, cv2.IMREAD_GRAYSCALE) for p in sys.argv[1:4]))
rest = ((t > 128) & (cv2.dilate(g, np.ones((5, 5), np.uint8)) < 128) & (cv2.dilate(m, np.ones((9, 9), np.uint8)) < 128)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(rest, 8)
keep = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 2000 and st[i, cv2.CC_STAT_LEFT] < t.shape[1] * 0.3]
side = np.isin(lab, keep).astype(np.float32)
cv2.imwrite(out, (cv2.GaussianBlur(side, (0, 0), 0.8) * 255).astype(np.uint8))
print(f"side window: {int(side.sum())} px")
PY
# Wheel and hands: where the two stills differ, connected to the wheel (wheel.py), so the hands and forearms are whole.
CLUSTER="$CLUSTER" "$V" "$T/wheel.py" "$C/cockpit.png" "$C/cabin.png" "$HX" "$HY" "$WR" "$W/wheel-mask.png"
ffmpeg -v error -y -i "$C/cockpit.png" -i "$W/wheel-mask.png" -filter_complex "[0:v]format=rgba,pad=iw+2:ih+2:1:1:color=black,chromakey=$KEY,crop=iw-2:ih-2:1:1,despill=type=green:mix=0.6:expand=0,format=rgba,alphaextract,format=gray[ca];[1:v]format=gray[m];[ca][m]blend=all_mode=multiply,format=gray[am];[0:v]format=rgba[c2];[c2][am]alphamerge" -frames:v 1 "$C/wheel.png"
# Dust, smudges and wiper arcs on the windshield, lit in the composite by whatever bright light is behind the glass.
"$V" "$T/dirt.py" "$C/glass-mask.png" "$C/glass-dirt.png" >/dev/null
echo "$C: glass-mask.png, mirror-mask.png, side-window-mask.png, wheel.png, glass-dirt.png"
