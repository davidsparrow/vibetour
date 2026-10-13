#!/bin/bash
# still.sh <plate.png> <out.png> [angle_deg]: one still through the cockpit, to judge an anchor before animating it.
# The plate must already be 16:9 with its vanishing point where the standard puts it (vp.py crops a 4:3 anchor).
# The mirrors show the same still, so they're only a placeholder. CAR selects the car, as for composite.sh.
set -euo pipefail
T="$(cd "$(dirname "$0")" && pwd)"; IN="$1"; OUT="$2"; A="${3:-0}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
ffmpeg -v error -y -loop 1 -i "$IN" -t 1 -r 24 -vf "scale=1280:720:flags=lanczos,format=yuv420p" -c:v libx264 -crf 12 "$W/plate.mp4"
ffmpeg -v error -y -i "$W/plate.mp4" -vf scale=320:180 -c:v libx264 -crf 18 "$W/mirror.mp4"
echo "0.0 rotate a $(python3 -c "import math; print(round($A * math.pi / 180, 5))");" > "$W/steer.cmd"
"$T/composite.sh" "$W/plate.mp4" "$W/mirror.mp4" "$W/steer.cmd" "$W/out.mp4" ${FLARE:+"$FLARE"}
ffmpeg -v error -y -ss 0.5 -i "$W/out.mp4" -frames:v 1 "$OUT"
echo "$OUT"
