#!/bin/bash
# session.sh <out.mp4> <clip1> <clip2> ... : dissolve the clips (1 s), derive steering and the mirror feed, and composite
# with a car (CAR, default cars/touring-sedan). The mirrors show each clip run backwards on its own, dissolved on the
# same joins, so they show the stretch of road the car is on, never a later one. RAIN=<drops a second> adds windshield
# rain and wipers (rain.py); MIRRORLIGHTS=<dark> turns the mirrors' car lights round (mirrorlights.py);
# rain or WET=1 wets the side window and mirrors, and at night the side window shows taillights (glass.py);
# FLARE=<strength> adds lens flare for a sun in frame (flare.py).
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
# MIRRORLIGHTS (night about 0.35, dusk or rain 1) turns the mirrors' car lights round: taillights on cars driving away,
# headlights on a car following us, and the rest of the mirror darkened by that factor.
if [ -n "${MIRRORLIGHTS:-}" ]; then "$V" "$T/mirrorlights.py" "$W/mirror.mp4" "$W/mirror-lit.mp4" "$MIRRORLIGHTS" | tail -1; mv "$W/mirror-lit.mp4" "$W/mirror.mp4"; fi
"$V" "$T/steer.py" "$W/plate.mp4" "$W/steer" 12.5 | tail -1
# RAIN (drops a second, e.g. 900) puts rain on the windshield and turns the wipers on. Steering comes from the dry plate,
# since the wipers would read as camera yaw.
P="$W/plate.mp4"; [ -n "${RAIN:-}" ] && "$V" "$T/rain.py" "$W/plate.mp4" "$W/wet.mp4" "${CAR:-}" | tail -1 && P="$W/wet.mp4"
# FLARE=<strength> (about 0.8) adds the lens-flare layer, for variants with the sun in frame only.
FL=""; [ -n "${FLARE:-}" ] && "$V" "$T/flare.py" "$W/plate.mp4" "$W/flare.mp4" "$FLARE" | tail -1 && FL="$W/flare.mp4"
"$T/composite.sh" "$P" "$W/mirror.mp4" "$W/steer.cmd" "$OUT" $FL
# The side glass: wet whenever it rains (or WET=1 for a wet road), and at night (MIRRORLIGHTS below 1) any lamp in the
# side window shown as a taillight, since a car beside us has passed.
WETG="${WET:-}"; [ -n "${RAIN:-}" ] && WETG=1
NIGHTG=""; [ -n "${MIRRORLIGHTS:-}" ] && python3 -c "import sys; sys.exit(0 if float('$MIRRORLIGHTS') < 1 else 1)" && NIGHTG=1
if [ -n "$WETG$NIGHTG" ]; then WET="$WETG" NIGHT="$NIGHTG" "$V" "$T/glass.py" "$OUT" "$W/glass.mp4" "${CAR:-}" | tail -1 && mv "$W/glass.mp4" "$OUT"; fi
cp "$W/plate.mp4" "${OUT%.mp4}-plate.mp4"; rm -rf "$W"
echo "$OUT: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT") s"
