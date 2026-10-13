#!/bin/bash
# car-build.sh <car dir>: derive a car's glass mask, mirror mask, wheel-and-hands cutout and glass dirt from its cockpit.png
# (the generated still, glass in flat #00FF00), cabin.png (the same still with the wheel and hands removed) and car.json.
set -euo pipefail
C="$1"; T="$(cd "$(dirname "$0")" && pwd)"; V="${PYTHON:-python3}"
eval "$("$V" "$T/car.py" "$C")"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
IFS=: read SX SY SW SH <<< "$SIDE"
# Glass: keyed alpha, inverted, so glass is white. The windshield and the mirrors fully inside the frame come from masks.py.
ffmpeg -v error -y -i "$C/cockpit.png" -vf "format=rgba,chromakey=$KEY,format=rgba,alphaextract,format=gray,lutyuv=y=negval" -frames:v 1 "$W/transparent.png"
"$V" "$T/masks.py" "$W/transparent.png" "$C/glass-mask.png" "$W/mirrors.png"
# The door mirror touches the frame edge, so masks.py skips it: take the glass inside car.json's side box instead.
ffmpeg -v error -y -f lavfi -i "color=c=black:s=${CW}x${CH}:d=1,format=gray" -frames:v 1 -vf "geq=lum='if(between(X,$SX,$((SX+SW)))*between(Y,$SY,$((SY+SH))),255,0)'" "$W/side-rect.png"
ffmpeg -v error -y -i "$W/transparent.png" -i "$W/side-rect.png" -i "$W/mirrors.png" -filter_complex "[0:v]format=gray[a];[1:v]format=gray[b];[a][b]blend=all_mode=multiply[side];[2:v]format=gray[r];[side][r]blend=all_mode=lighten,gblur=sigma=0.8" -frames:v 1 "$C/mirror-mask.png"
# Wheel and hands: where the two stills differ, connected to the wheel (wheel.py), so the hands and forearms are whole.
"$V" "$T/wheel.py" "$C/cockpit.png" "$C/cabin.png" "$HX" "$HY" "$WR" "$W/wheel-mask.png"
ffmpeg -v error -y -i "$C/cockpit.png" -i "$W/wheel-mask.png" -filter_complex "[0:v]format=rgba,chromakey=$KEY,despill=type=green:mix=0.6:expand=0,format=rgba,alphaextract,format=gray[ca];[1:v]format=gray[m];[ca][m]blend=all_mode=multiply,format=gray[am];[0:v]format=rgba[c2];[c2][am]alphamerge" -frames:v 1 "$C/wheel.png"
# Dust, smudges and wiper arcs on the windshield, lit in the composite by whatever bright light is behind the glass.
"$V" "$T/dirt.py" "$C/glass-mask.png" "$C/glass-dirt.png" >/dev/null
echo "$C: glass-mask.png, mirror-mask.png, wheel.png, glass-dirt.png"
