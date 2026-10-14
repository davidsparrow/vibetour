#!/bin/bash
# composite.sh <plate.mp4> <mirrorfeed.mp4> <steer.cmd> <out.mp4> [flare.mp4]
# A car from cars/ (1200x896, 4:3), 16:9 crop taken from the top. Plate centred: its vanishing point
# sits over the wheel hub. Layers: plate, mirror feeds inside the glass, keyed cockpit with light bleed,
# wheel+hands rotated by the steering track, windshield bloom, then the glass and camera: the dash reflected
# faintly in the bottom of the windshield, dust and wiper arcs lit by whatever bright light is behind them
# (the sun, a white sky, headlights), optional lens flare, and grain.
# Strengths: BLEED (0.15), BLOOM (0.6), REFLECT (0.18), GLARE (0.8, needs the car's glass-dirt.png), GRAIN (5).
# CABIN is the cabin's light level for the variant (1 midday, about 0.7 near sunset, 0.6 in rain, 0.25 at night); the
# instrument cluster (car.json "cluster") keeps its glow as the cabin darkens.
C="${CAR:-$(cd "$(dirname "$0")/../.." && pwd)/cars/touring-sedan}"
PLATE="$1"; FEED="$2"; CMD="$3"; OUT="$4"; FLARE="${5:-}"
eval "$(python3 "$(dirname "$0")/car.py" "$C")"   # HX HY (wheel hub), WY (wheel moved down, px), REAR SIDE (mirror boxes x:y:w:h), KEY
WY="${WHEEL_OFFSET:-$WY}"
BLEED="${BLEED:-0.15}"; BLOOM="${BLOOM:-0.6}"; REFLECT="${REFLECT:-0.18}"; GLARE="${GLARE:-0.8}"; GRAIN="${GRAIN:-5}"; CABIN="${CABIN:-1}"
IFS=: read RX RY RW RH <<< "$REAR"; IFS=: read SX SY SW SH <<< "$SIDE"
T=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$PLATE")
# The windshield's lowest row at the centre, where the dash meets the glass; the reflection mirrors the dash about it.
GB=$(python3 -c "
from PIL import Image; m = Image.open('$C/glass-mask.png').convert('L'); w, h = m.size
print(max(y for y in range(h) if m.getpixel((w // 2, y)) > 128))")
RH2=150
if [ -n "${CLUSTER:-}" ]; then IFS=: read KX KY KW KH <<< "$CLUSTER"
  GLOW_FC="[cabg]crop=${KW}:${KH}:${KX}:${KY},lutrgb=r='val*${CABIN}+max(val-90,0)*(1-${CABIN})*1.4':g='val*${CABIN}+max(val-90,0)*(1-${CABIN})*1.4':b='val*${CABIN}+max(val-90,0)*(1-${CABIN})*1.4'[glow];[c0][glow]overlay=${KX}:${KY}:format=auto[c1];"
else GLOW_FC="[cabg]nullsink;[c0]null[c1];"; fi
N=6; EXTRA=""
if [ -f "$C/glass-dirt.png" ] && [ "$GLARE" != "0" ]; then
  EXTRA="$EXTRA -loop 1 -i $C/glass-dirt.png"; DI=$N; N=$((N+1))
  GLARE_FC="[pg]lutrgb=r='max(val-160,0)*2.6':g='max(val-160,0)*2.6':b='max(val-160,0)*2.6',hue=s=0.4,format=rgb24,scale=100:75,gblur=sigma=4,scale=1200:896:flags=bicubic[gl0];[$DI:v]format=gray,format=rgb24[dirt];[gl0][dirt]blend=all_mode=multiply,lutrgb=r=val*${GLARE}:g=val*${GLARE}:b=val*${GLARE}[glare];[lit2a][glare]blend=all_mode=addition,format=rgb24[lit2b];"
else
  GLARE_FC="[pg]nullsink;[lit2a]null[lit2b];"
fi
if [ -n "$FLARE" ]; then EXTRA="$EXTRA -i $FLARE"; FL=$N; N=$((N+1)); FLARE_FC="[$FL:v]scale=1200:896,format=rgb24[fl0];[glass2]lutyuv=y='max(val,38)',format=rgb24[fgm];[fl0][fgm]blend=all_mode=multiply,format=rgb24[fl];[lit2b][fl]blend=all_mode=screen,format=rgb24[lit3];"; else FLARE_FC="[glass2]nullsink;[lit2b]null[lit3];"; fi
ffmpeg -v error -y -i "$PLATE" -i "$FEED" -loop 1 -i "$C/cabin.png" -loop 1 -i "$C/wheel.png" -loop 1 -i "$C/mirror-mask.png" -loop 1 -i "$C/glass-mask.png" $EXTRA -filter_complex "
[0:v]scale=1440:810:flags=lanczos,crop=1200:675:120:119,pad=1200:896:0:0:color=black,eq=saturation=1.08:contrast=1.04,format=rgb24,split=4[plate][pb][ph][pg];
[1:v]scale=320:180,setpts=PTS-STARTPTS,split=2[f1][f2];
[f1]crop=300:103:10:38,scale=${RW}:${RH}[rear];
[f2]crop=150:120:0:30,scale=${SW}:${SH}[side];
color=c=black@0:s=1200x896:d=${T}[cv];
[cv][rear]overlay=${RX}:${RY}:format=auto[cv1];
[cv1][side]overlay=${SX}:${SY}:format=auto,format=rgb24,lutrgb=r=val*0.8:g=val*0.8:b=val*0.8[mirrors];
[4:v]format=gray[mm];
[mirrors][mm]alphamerge[mirrorlayer];
[plate][mirrorlayer]overlay=format=auto:eof_action=endall,format=rgb24[p1];
[2:v]scale=1200:896,format=rgba,chromakey=${KEY},despill=type=green:mix=0.6:expand=0,format=rgba,split=4[cab0][caba][cabk][cabg];
[cab0]colorchannelmixer=rr=${CABIN}:gg=${CABIN}:bb=${CABIN}[cab];
color=c=black:s=1200x896:d=1,format=rgb24[kbg];[cabk]colorchannelmixer=rr=${CABIN}:gg=${CABIN}:bb=${CABIN}[cabk2];[kbg][cabk2]overlay=format=auto,format=rgb24[cabr];
[p1][cab]overlay=format=auto:eof_action=endall[c0];
${GLOW_FC}
[3:v]format=rgba,colorchannelmixer=rr=${CABIN}:gg=${CABIN}:bb=${CABIN},pad=2400:1800:$((1200-HX)):$((900-HY)):color=0x00000000,sendcmd=f='${CMD}',rotate@wheel=a=0:c=0x00000000,crop=1200:896:$((1200-HX)):$((900-HY))[wl];
[c1][wl]overlay=0:${WY}:format=auto:eof_action=endall,format=rgb24[comp];
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
