#!/bin/bash
# composite.sh <plate.mp4> <mirrorfeed.mp4> <steer.cmd> <out.mp4> [flare.mp4]
# A car from cars/ (1200x896, 4:3; CAR picks the folder, default cars/grand-tourer), 16:9 crop taken from the top. Plate centred: its vanishing point
# sits over the wheel hub. Layers: plate, mirror feeds inside the glass, keyed cockpit with light bleed,
# wheel+hands rotated by the steering track, windshield bloom, then the glass and camera: the dash reflected
# faintly in the bottom of the windshield, dust and wiper arcs lit by whatever bright light is behind them
# (the sun, a white sky, headlights), optional lens flare, and grain.
# The cabin is padded by a pixel before the key and cropped after: ffmpeg's chromakey reads the neighbours of every pixel,
# and on the frame's border row they are uninitialised, which keyed out the top row of the cockpit and let the plate show.
# Strengths: BLEED (0.15), BLOOM (0.6), REFLECT (0.18), GLARE (0.8, needs the car's glass-dirt.png), GRAIN (5).
# A car with "dials" in car.json gets live needles: a speedometer and rev counter rotated by a sendcmd track (DIALS).
# CABIN is the cabin's light level for the variant (1 midday, about 0.7 near sunset, 0.6 in rain, 0.35 at night); the
# instrument cluster (car.json "cluster") keeps its glow as the cabin darkens.
C="${CAR:-$(cd "$(dirname "$0")/../.." && pwd)/cars/grand-tourer}"
PLATE="$1"; FEED="$2"; CMD="$3"; OUT="$4"; FLARE="${5:-}"
eval "$(python3 "$(dirname "$0")/car.py" "$C")"   # HX HY (wheel hub), WY (wheel moved down, px), REAR SIDE (mirror boxes x:y:w:h), KEY
WY="${WHEEL_OFFSET:-$WY}"
# VPY: where the plate's horizon (45% down the plate) lands in the frame, as a fraction of its height (0.364). A lower
# horizon reads as a lower seat. DIALS: a sendcmd file for the needles (session.sh writes one from the clips' speeds);
# without it the dials sit at CRUISE km/h (55).
VPY="${VPY:-0.364}"; PY0=$(python3 -c "print(max(0, min(135, round(364.5 - $VPY * 675))))")
BLEED="${BLEED:-0.15}"; BLOOM="${BLOOM:-0.6}"; REFLECT="${REFLECT:-0.18}"; GLARE="${GLARE:-0.8}"; GRAIN="${GRAIN:-5}"; CABIN="${CABIN:-1}"
IFS=: read RX RY RW RH <<< "$REAR"; IFS=: read SX SY SW SH <<< "$SIDE"
FH=$((300 * RH / RW)); [ $FH -gt 180 ] && FH=180; FY=$(((180 - FH) / 2))   # the band of the feed the rear mirror shows, in its aspect
T=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$PLATE")
# The windshield's lowest row at the centre, where the dash meets the glass; the reflection mirrors the dash about it.
GB=$(python3 -c "
from PIL import Image; m = Image.open('$C/glass-mask.png').convert('L'); w, h = m.size
print(max(y for y in range(h) if m.getpixel((w // 2, y)) > 128))")
RH2=150
# Backlit areas: the cluster and any "lit" boxes in car.json keep their bright pixels (numerals, needles, icons, chrome)
# lit as the cabin darkens, so the dashboard reads at night the way a real one does.
BOXES="${CLUSTER:-}"; [ -n "${LIT:-}" ] && BOXES="${BOXES:+$BOXES,}$LIT"
if [ -n "$BOXES" ]; then
  IFS=, read -ra BOXA <<< "$BOXES"; NB=${#BOXA[@]}; GLOW_FC="[cabg]split=$NB"; i=0
  while [ $i -lt $NB ]; do GLOW_FC="$GLOW_FC[g$i]"; i=$((i+1)); done; GLOW_FC="$GLOW_FC;"; prev="c0"; i=0
  for b in "${BOXA[@]}"; do IFS=: read KX KY KW KH <<< "$b"; nxt="c0g$i"; [ $i -eq $((NB-1)) ] && nxt="c1"
    GLOW_FC="$GLOW_FC[g$i]crop=${KW}:${KH}:${KX}:${KY},lutrgb=r='val*${CABIN}+max(val-90,0)*(1-${CABIN})*1.4':g='val*${CABIN}+max(val-90,0)*(1-${CABIN})*1.4':b='val*${CABIN}+max(val-90,0)*(1-${CABIN})*1.4'[glow$i];[$prev][glow$i]overlay=${KX}:${KY}:format=auto[$nxt];"
    prev="$nxt"; i=$((i+1)); done
else GLOW_FC="[cabg]nullsink;[c0]null[c1];"; fi
N=6; EXTRA=""
if [ -f "$C/glass-dirt.png" ] && [ "$GLARE" != "0" ]; then
  EXTRA="$EXTRA -loop 1 -i $C/glass-dirt.png"; DI=$N; N=$((N+1))
  GLARE_FC="[pg]lutrgb=r='max(val-160,0)*2.6':g='max(val-160,0)*2.6':b='max(val-160,0)*2.6',hue=s=0.4,format=rgb24,scale=100:75,gblur=sigma=4,scale=1200:896:flags=bicubic[gl0];[$DI:v]format=gray,format=rgb24[dirt];[gl0][dirt]blend=all_mode=multiply,lutrgb=r=val*${GLARE}:g=val*${GLARE}:b=val*${GLARE}[glare];[lit2a][glare]blend=all_mode=addition,format=rgb24[lit2b];"
else
  GLARE_FC="[pg]nullsink;[lit2a]null[lit2b];"
fi
DIAL_FC="[c1]null[c1d];"
if [ -n "${SPD:-}" ]; then
  W2="$(mktemp -d)"; trap 'rm -rf "$W2"' EXIT
  IFS=: read SPX SPY SPZ SPS SPM <<< "$SPD"; IFS=: read RPX RPY RPZ RPS RPM_ <<< "$RPM"
  python3 - "$W2/needle.png" "$NEEDLE" <<'PY'
import sys; from PIL import Image, ImageDraw
out, L = sys.argv[1], int(sys.argv[2]); S = 4; im = Image.new("RGBA", (120 * S, 120 * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = 60 * S
d.polygon([(c - 2 * S, c + 6 * S), (c + 2 * S, c + 6 * S), (c + 0.6 * S, c - L * S), (c - 0.6 * S, c - L * S)], fill=(248, 246, 240, 255))
d.polygon([(c - 0.9 * S, c - (L - 7) * S), (c + 0.9 * S, c - (L - 7) * S), (c + 0.6 * S, c - L * S), (c - 0.6 * S, c - L * S)], fill=(235, 90, 40, 255))
d.ellipse([c - 4 * S, c - 4 * S, c + 4 * S, c + 4 * S], fill=(30, 30, 32, 255), outline=(200, 200, 205, 255), width=S)
im.resize((120, 120), Image.LANCZOS).save(out)
PY
  if [ -z "${DIALS:-}" ]; then   # no track: both needles at cruising speed
    python3 -c "
import math; v=float('${CRUISE:-55}'); rpm=800+25*v
print('0.0 rotate@spd a %.5f, rotate@rpm a %.5f;' % (math.radians($SPZ + $SPS * min(v / $SPM, 1)), math.radians($RPZ + $RPS * min(rpm / $RPM_, 1))))" > "$W2/dials.cmd"; DIALS="$W2/dials.cmd"; fi
  EXTRA="$EXTRA -loop 1 -i $W2/needle.png"; NI=$N; N=$((N+1))
  DIAL_FC="[$NI:v]format=rgba,split=2[n1][n2];[n1]sendcmd=f='${DIALS}',rotate@spd=a=0:c=0x00000000:ow=120:oh=120[nspd];[n2]rotate@rpm=a=0:c=0x00000000:ow=120:oh=120[nrpm];[c1][nspd]overlay=$((SPX-60)):$((SPY-60)):format=auto:eof_action=endall[c1a];[c1a][nrpm]overlay=$((RPX-60)):$((RPY-60)):format=auto:eof_action=endall,format=rgb24[c1d];"
fi
# A car with "screens" in car.json lights them (headunit.py): the radio's face on the console screen, the station and the
# water temperature on the cluster's centre display. Blended with "screen" onto the dark glass under the wheel and hands,
# and dimmed a little at night as a real screen is. HEADUNIT=0 leaves the screens dark.
HU_FC="[c1d]null[c1h];"
if [ -n "${SCON:-}" ] && [ "${HEADUNIT:-1}" != "0" ]; then
  W3="$(mktemp -d)"; trap 'rm -rf "${W2:-}" "$W3"' EXIT
  python3 "$(dirname "$0")/headunit.py" "$C" "$T" "$W3" | tail -1
  IFS=: read CNX CNY CNW CNH <<< "$SCON"; IFS=: read CLX CLY CLW CLH <<< "$SCLU"
  HB=$(python3 -c "print(round(min(1, 0.55 + 0.45 * $CABIN), 3))")
  EXTRA="$EXTRA -i $W3/console.mp4 -i $W3/cluster.mp4"; HI=$N; HC=$((N+1)); N=$((N+2))
  HU_FC="color=c=black:s=1200x896:r=24:d=${T},format=rgb24[hu0];[$HI:v]format=rgb24[hcon];[$HC:v]format=rgb24[hclu];[hu0][hcon]overlay=${CNX}:${CNY}[hu1];[hu1][hclu]overlay=${CLX}:${CLY},lutrgb=r=val*${HB}:g=val*${HB}:b=val*${HB},format=rgb24[hu];[c1d][hu]blend=all_mode=screen:shortest=1,format=rgb24[c1h];"
fi
if [ -n "$FLARE" ]; then EXTRA="$EXTRA -i $FLARE"; FL=$N; N=$((N+1)); FLARE_FC="[$FL:v]scale=1200:896,format=rgb24[fl0];[glass2]lutyuv=y='max(val,38)',format=rgb24[fgm];[fl0][fgm]blend=all_mode=multiply,format=rgb24[fl];[lit2b][fl]blend=all_mode=screen,format=rgb24[lit3];"; else FLARE_FC="[glass2]nullsink;[lit2b]null[lit3];"; fi
ffmpeg -v error -y -i "$PLATE" -i "$FEED" -loop 1 -i "$C/cabin.png" -loop 1 -i "$C/wheel.png" -loop 1 -i "$C/mirror-mask.png" -loop 1 -i "$C/glass-mask.png" $EXTRA -filter_complex "
[0:v]scale=1440:810:flags=lanczos,crop=1200:675:120:${PY0},pad=1200:896:0:0:color=black,eq=saturation=1.08:contrast=1.04,format=rgb24,split=4[plate][pb][ph][pg];
[1:v]scale=320:180,setpts=PTS-STARTPTS,split=2[f1][f2];
[f1]crop=300:${FH}:10:${FY},scale=${RW}:${RH}[rear];
[f2]crop=150:120:0:30,scale=${SW}:${SH}[side];
color=c=black@0:s=1200x896:d=${T}[cv];
[cv][rear]overlay=${RX}:${RY}:format=auto[cv1];
[cv1][side]overlay=${SX}:${SY}:format=auto,format=rgb24,lutrgb=r=val*0.8:g=val*0.8:b=val*0.8[mirrors];
[4:v]format=gray[mm];
[mirrors][mm]alphamerge[mirrorlayer];
[plate][mirrorlayer]overlay=format=auto:eof_action=endall,format=rgb24[p1];
[2:v]scale=1200:896,format=rgba,pad=1202:898:1:1:color=black,chromakey=${KEY},crop=1200:896:1:1,despill=type=green:mix=0.6:expand=0,format=rgba,split=4[cab0][caba][cabk][cabg];
[cab0]colorchannelmixer=rr=${CABIN}:gg=${CABIN}:bb=${CABIN}[cab];
color=c=black:s=1200x896:d=1,format=rgb24[kbg];[cabk]colorchannelmixer=rr=${CABIN}:gg=${CABIN}:bb=${CABIN}[cabk2];[kbg][cabk2]overlay=format=auto,format=rgb24[cabr];
[p1][cab]overlay=format=auto:eof_action=endall[c0];
${GLOW_FC}
${DIAL_FC}
${HU_FC}
[3:v]format=rgba,colorchannelmixer=rr=${CABIN}:gg=${CABIN}:bb=${CABIN},pad=2400:1800:$((1200-HX)):$((900-HY)):color=0x00000000,sendcmd=f='${CMD}',rotate@wheel=a=0:c=0x00000000,crop=1200:896:$((1200-HX)):$((900-HY))[wl];
[c1h][wl]overlay=0:${WY}:format=auto:eof_action=endall,format=rgb24[comp];
[caba]format=rgba,alphaextract,format=gray,format=rgb24[mask];
[pb]scale=120:90,gblur=sigma=5,scale=1200:896:flags=bicubic[blur];
[blur][mask]blend=all_mode=multiply,format=rgb24[bm];
[bm]hue=s=0,format=rgb24,lutrgb=r=val*${BLEED}:g=val*${BLEED}:b=val*${BLEED}[bleed];
[comp][bleed]blend=all_mode=screen,format=rgb24[lit];
[ph]lutrgb=r='max(val-225,0)*4':g='max(val-225,0)*4':b='max(val-225,0)*4',hue=s=0.3,format=rgb24,scale=150:112,gblur=sigma=6,scale=1200:896:flags=bicubic[hl];
[5:v]format=gray,format=rgb24,split=3[glass][glass2][glass3];
[hl][glass]blend=all_mode=multiply,lutrgb=r=val*${BLOOM}:g=val*${BLOOM}:b=val*${BLOOM}[bloom];
[lit][bloom]blend=all_mode=screen,format=rgb24[lit1];
[cabr]crop=1200:${RH2}:0:${GB},vflip,format=rgb24,pad=1200:896:0:$((GB-RH2)):color=black,gblur=sigma=2.5[refl0];
color=c=black:s=1200x896:d=1,format=gray,geq=lum='255*pow(min(max((Y-$((GB-RH2)))/${RH2},0),1),1.6)',format=rgb24[fade];
[glass3][fade]blend=all_mode=multiply[rmask];
[refl0][rmask]blend=all_mode=multiply,lutrgb=r=val*${REFLECT}:g=val*${REFLECT}:b=val*${REFLECT}[refl];
[lit1][refl]blend=all_mode=screen,format=rgb24[lit2a];
${GLARE_FC}
${FLARE_FC}
[lit3]crop=1200:675:0:0,scale=1280:720:flags=lanczos,noise=c0s=${GRAIN}:c0f=t+u,format=yuv420p[out]" -map "[out]" -t "$T" -r 24 -c:v libx264 -crf 20 -movflags +faststart "$OUT"
