#!/bin/bash
# session.sh <out.mp4> <clip1> <clip2> ... : dissolve the clips (1 s), derive steering and the mirror feed, and composite
# with a car (CAR, default cars/grand-tourer). The mirrors show the road already driven, run backwards at our pace, with
# the plates' traffic painted out and every vehicle that passes us drawn in from behind as it goes by (traffic.py finds
# them, mirrorfeed.py draws the feed); a clip named *hold* stands still. RAIN=<drops a second> adds windshield
# rain and wipers (rain.py); MIRRORLIGHTS=<dark> turns the mirrors' car lights round (mirrorlights.py);
# rain or WET=1 wets the side window and mirrors, and at night the side window shows taillights (glass.py);
# FLARE=<strength> adds lens flare for a sun in frame (flare.py).
T="$(cd "$(dirname "$0")" && pwd)"; V="${PYTHON:-python3}"; OUT="$1"; shift
W="$(mktemp -d)"; n=0; ins=""
for c in "$@"; do
  ins="$ins -i \"$c\""; d="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$c")"; durs+=("$d"); n=$((n+1))
done
# dissolve <per-clip filters> <out>: joins every clip with a 1 s fade, each clip first run through the given filters.
dissolve() {
  local fc="" prev="v0" off=0 i=0 o
  while [ $i -lt $n ]; do fc="$fc[$i:v]$1,setpts=PTS-STARTPTS[v$i];"; i=$((i+1)); done
  i=1; while [ $i -lt $n ]; do off=$(python3 -c "print(round($off + ${durs[$((i-1))]} - 1.0, 3))"); o="x$i"; [ $i -eq $((n-1)) ] && o="out"; fc="$fc[$prev][v$i]xfade=transition=fade:duration=1:offset=$off[$o];"; prev="$o"; i=$((i+1)); done
  [ $n -eq 1 ] && fc="${fc}[v0]null[out];"
  eval ffmpeg -v error -y ${4:-$ins} -filter_complex "\"${fc%;}\"" -map "[out]" -an -c:v libx264 -crf ${3:-20} -pix_fmt yuv420p "\"$2\""
}
dissolve "fps=24,scale=1280:720:flags=lanczos,setsar=1,format=yuv420p" "$W/plate.mp4"
"$V" "$T/traffic.py" "$@" | sed 's/^/  traffic: /'
"$V" "$T/mirrorfeed.py" "$W/mirror.mp4" "$@" | tail -1
# MIRRORLIGHTS (night about 0.35, dusk or rain 1) turns the mirrors' car lights round: taillights on cars driving away,
# headlights on a car following us, and the rest of the mirror darkened by that factor.
if [ -n "${MIRRORLIGHTS:-}" ]; then "$V" "$T/mirrorlights.py" "$W/mirror.mp4" "$W/mirror-lit.mp4" "$MIRRORLIGHTS" | tail -1; mv "$W/mirror-lit.mp4" "$W/mirror.mp4"; fi
"$V" "$T/steer.py" "$W/plate.mp4" "$W/steer" 12.5 | tail -1
# The speedometer and rev counter follow the clips: a clip made by ramp.py has a <clip>.speed.csv with its speed factor per
# frame, a *hold* clip stands still, and every other clip cruises at CRUISE km/h (55) with a slow wander. Speeds blend
# across each 1 s dissolve. The rev counter idles at 800 and climbs with the speed. Written as a sendcmd track for the
# needles in composite.sh (cars with "dials" in car.json).
eval "$(python3 "$T/car.py" "${CAR:-$T/../../cars/grand-tourer}")"
if [ -n "${SPD:-}" ]; then
python3 - "$W/dials.cmd" "${CRUISE:-55}" "$SPD" "$RPM" "${durs[@]}" -- "$@" <<'PY'
import math, os, sys
out, cruise, spd, rpm = sys.argv[1], float(sys.argv[2]), [float(x) for x in sys.argv[3].split(":")], [float(x) for x in sys.argv[4].split(":")]
rest = sys.argv[5:]; k = rest.index("--"); durs = [float(x) for x in rest[:k]]; clips = rest[k + 1:]
fps = 24; offs = [0.0]
for d in durs[:-1]: offs.append(offs[-1] + d - 1.0)
total = offs[-1] + durs[-1]
def factor(i, tau):
    name = os.path.basename(clips[i]); csv = clips[i] + ".speed.csv"
    if os.path.exists(csv):
        rows = [float(l.split(",")[1]) for l in open(csv).read().split("\n")[1:] if l]
        return rows[min(int(tau * fps), len(rows) - 1)]
    if "hold" in name and "checkpoint" not in name: return 0.0
    return 1 + 0.04 * math.sin(2 * math.pi * tau / 7.3) + 0.02 * math.sin(2 * math.pi * tau / 3.1)
with open(out, "w") as f:
    n = int(total * fps)
    for k in range(n):
        t = k / fps; v = None
        for i in range(len(clips)):
            if offs[i] <= t < offs[i] + durs[i]:
                fi = factor(i, t - offs[i])
                if i + 1 < len(clips) and t >= offs[i + 1]:            # inside the dissolve into the next clip
                    a = (t - offs[i + 1]) / 1.0; v = (1 - a) * fi + a * factor(i + 1, t - offs[i + 1]); break
                v = fi; break
        if v is None: v = 0.0
        kmh = v * cruise; revs = 800 + 25 * kmh + (120 * math.sin(2 * math.pi * t / 1.7) if kmh > 5 else 0)
        a_s = math.radians(spd[2] + spd[3] * min(kmh / spd[4], 1)); a_r = math.radians(rpm[2] + rpm[3] * min(revs / rpm[4], 1))
        f.write(f"{t:.4f} rotate@spd a {a_s:.5f}, rotate@rpm a {a_r:.5f};\n")
print(f"dials: {n} frames, cruise {cruise:.0f} km/h")
PY
export DIALS="$W/dials.cmd"
fi
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
# MIST=<clip names, comma-separated, or parts of them> puts sea spray on the car during those clips: a fine mist on the
# windshield that the wipers clear now and then, beads on the door mirror's silver housing (spray.py). Its strength rises
# and falls over 1.5 s at each end and gusts gently.
if [ -n "${MIST:-}" ]; then
python3 - "$W/mist.csv" "$MIST" "${durs[@]}" -- "$@" <<'PY'
import math, os, sys
out, names = sys.argv[1], [n for n in sys.argv[2].split(",") if n]
rest = sys.argv[3:]; k = rest.index("--"); durs = [float(x) for x in rest[:k]]; clips = rest[k + 1:]
offs = [0.0]
for d in durs[:-1]: offs.append(offs[-1] + d - 1.0)
spans = [(offs[i], offs[i] + durs[i]) for i, c in enumerate(clips) if any(n in os.path.basename(c) for n in names)]
n = int((offs[-1] + durs[-1]) * 24)
with open(out, "w") as f:
    f.write("frame,mist\n")
    for k in range(n):
        t = k / 24; m = 0.0
        for a, b in spans:
            m = max(m, min(1.0, (t - a) / 1.5, (b - t) / 1.5))
        m = max(m, 0.0) * (0.75 + 0.25 * math.sin(t * 1.3) * math.sin(t * 0.47 + 1))
        f.write(f"{k},{m:.3f}\n")
print(f"mist: {len(spans)} clips")
PY
"$V" "$T/spray.py" "$OUT" "$W/spray.mp4" "$W/mist.csv" "${CAR:-}" | tail -1 && mv "$W/spray.mp4" "$OUT"
fi
cp "$W/plate.mp4" "${OUT%.mp4}-plate.mp4"; rm -rf "$W"
echo "$OUT: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT") s"
