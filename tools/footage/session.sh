#!/bin/bash
# session_v4.sh <out.mp4> <clip1> <clip2> ... : dissolve the clips (1 s), derive steering + mirror feed, composite with cockpit v4.
T="$(cd "$(dirname "$0")" && pwd)"; V="${PYTHON:-python3}"; OUT="$1"; shift
W="$(mktemp -d)"; n=0; ins=""; fc=""
for c in "$@"; do ins="$ins -i \"$c\""; fc="$fc[$n:v]fps=24,scale=1280:720:flags=lanczos,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v$n];"; n=$((n+1)); done
prev="v0"; off=0; i=1
for c in "$@"; do d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$c"); durs+=("$d"); done
while [ $i -lt $n ]; do off=$(python3 -c "print(round($off + ${durs[$((i-1))]} - 1.0, 3))"); o="x$i"; [ $i -eq $((n-1)) ] && o="out"; fc="$fc[$prev][v$i]xfade=transition=fade:duration=1:offset=$off[$o];"; prev="$o"; i=$((i+1)); done
[ $n -eq 1 ] && fc="${fc}[v0]null[out];"
eval ffmpeg -v error -y $ins -filter_complex "\"${fc%;}\"" -map "[out]" -an -c:v libx264 -crf 20 "$W/plate.mp4"
"$V" "$T/steer.py" "$W/plate.mp4" "$W/steer" 12.5 | tail -1
ffmpeg -v error -y -i "$W/plate.mp4" -vf "scale=320:180,reverse" -c:v libx264 -crf 18 -pix_fmt yuv420p "$W/mirror.mp4"
"$T/composite.sh" "$W/plate.mp4" "$W/mirror.mp4" "$W/steer.cmd" "$OUT"
cp "$W/plate.mp4" "${OUT%.mp4}-plate.mp4"; rm -rf "$W"
echo "$OUT: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT") s"
