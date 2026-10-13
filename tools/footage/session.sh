#!/bin/bash
# session.sh <out.mp4> <clip1> <clip2> ... : dissolve the clips (1 s), derive steering and the mirror feed, and composite
# with a car (CAR, default cars/touring-sedan). The mirrors show each clip run backwards on its own, dissolved on the
# same joins, so they show the stretch of road the car is on, never a later one.
T="$(cd "$(dirname "$0")" && pwd)"; V="${PYTHON:-python3}"; OUT="$1"; shift
W="$(mktemp -d)"; n=0; ins=""
for c in "$@"; do ins="$ins -i \"$c\""; durs+=("$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$c")"); n=$((n+1)); done
# dissolve <per-clip filters> <out>: joins every clip with a 1 s fade, each clip first run through the given filters.
dissolve() {
  local fc="" prev="v0" off=0 i=0 o
  while [ $i -lt $n ]; do fc="$fc[$i:v]$1,setpts=PTS-STARTPTS[v$i];"; i=$((i+1)); done
  i=1; while [ $i -lt $n ]; do off=$(python3 -c "print(round($off + ${durs[$((i-1))]} - 1.0, 3))"); o="x$i"; [ $i -eq $((n-1)) ] && o="out"; fc="$fc[$prev][v$i]xfade=transition=fade:duration=1:offset=$off[$o];"; prev="$o"; i=$((i+1)); done
  [ $n -eq 1 ] && fc="${fc}[v0]null[out];"
  eval ffmpeg -v error -y $ins -filter_complex "\"${fc%;}\"" -map "[out]" -an -c:v libx264 -crf ${3:-20} -pix_fmt yuv420p "\"$2\""
}
dissolve "fps=24,scale=1280:720:flags=lanczos,setsar=1,format=yuv420p" "$W/plate.mp4"
dissolve "fps=24,scale=320:180,setsar=1,format=yuv420p,reverse" "$W/mirror.mp4" 18
"$V" "$T/steer.py" "$W/plate.mp4" "$W/steer" 12.5 | tail -1
"$T/composite.sh" "$W/plate.mp4" "$W/mirror.mp4" "$W/steer.cmd" "$OUT"
cp "$W/plate.mp4" "${OUT%.mp4}-plate.mp4"; rm -rf "$W"
echo "$OUT: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT") s"
