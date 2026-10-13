#!/bin/bash
# composite.sh <plate.mp4> <mirrorfeed.mp4> <steer.cmd> <out.mp4> [flare.mp4]
# A car from cars/ (1200x896, 4:3), 16:9 crop taken from the top. Plate centred: its vanishing point
# sits over the wheel hub. Layers: plate, mirror feeds inside the glass, keyed cockpit with light bleed,
# wheel+hands rotated by the steering track, windshield bloom, optional lens-flare layer.
C="${CAR:-$(cd "$(dirname "$0")/../.." && pwd)/cars/touring-sedan}"
PLATE="$1"; FEED="$2"; CMD="$3"; OUT="$4"; FLARE="${5:-}"
eval "$(python3 "$(dirname "$0")/car.py" "$C")"   # HX HY (wheel hub), REAR SIDE (mirror glass boxes x:y:w:h), KEY
BLEED="${BLEED:-0.15}"; BLOOM="${BLOOM:-0.6}"
IFS=: read RX RY RW RH <<< "$REAR"; IFS=: read SX SY SW SH <<< "$SIDE"
T=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$PLATE")
if [ -n "$FLARE" ]; then FLARE_IN="-i $FLARE"; FLARE_FC="[6:v]scale=1200:896,format=rgb24[fl0];[glass2]lutyuv=y='max(val,38)',format=rgb24[fgm];[fl0][fgm]blend=all_mode=multiply,format=rgb24[fl];[lit2][fl]blend=all_mode=screen,format=rgb24[lit3];"; else FLARE_IN=""; FLARE_FC="[glass2]nullsink;[lit2]null[lit3];"; fi
ffmpeg -v error -y -i "$PLATE" -i "$FEED" -loop 1 -i "$C/cabin.png" -loop 1 -i "$C/wheel.png" -loop 1 -i "$C/mirror-mask.png" -loop 1 -i "$C/glass-mask.png" $FLARE_IN -filter_complex "
[0:v]scale=1440:810:flags=lanczos,crop=1200:675:120:119,pad=1200:896:0:0:color=black,eq=saturation=1.08:contrast=1.04,format=rgb24,split=3[plate][pb][ph];
[1:v]scale=320:180,setpts=PTS-STARTPTS,split=2[f1][f2];
[f1]crop=300:103:10:38,scale=${RW}:${RH}[rear];
[f2]crop=150:120:0:30,scale=${SW}:${SH}[side];
color=c=black@0:s=1200x896:d=${T}[cv];
[cv][rear]overlay=${RX}:${RY}:format=auto[cv1];
[cv1][side]overlay=${SX}:${SY}:format=auto,format=rgb24,lutrgb=r=val*0.8:g=val*0.8:b=val*0.8[mirrors];
[4:v]format=gray[mm];
[mirrors][mm]alphamerge[mirrorlayer];
[plate][mirrorlayer]overlay=format=auto:eof_action=endall,format=rgb24[p1];
[2:v]scale=1200:896,format=rgba,chromakey=${KEY},despill=type=green:mix=0.6:expand=0,format=rgba,split=2[cab][caba];
[p1][cab]overlay=format=auto:eof_action=endall[c1];
[3:v]format=rgba,pad=2400:1800:$((1200-HX)):$((900-HY)):color=0x00000000,sendcmd=f='${CMD}',rotate@wheel=a=0:c=0x00000000,crop=1200:896:$((1200-HX)):$((900-HY))[wl];
[c1][wl]overlay=format=auto:eof_action=endall,format=rgb24[comp];
[caba]format=rgba,alphaextract,format=gray,format=rgb24[mask];
[pb]scale=120:90,gblur=sigma=5,scale=1200:896:flags=bicubic[blur];
[blur][mask]blend=all_mode=multiply,format=rgb24[bm];
[bm]hue=s=0,format=rgb24,lutrgb=r=val*${BLEED}:g=val*${BLEED}:b=val*${BLEED}[bleed];
[comp][bleed]blend=all_mode=screen,format=rgb24[lit];
[ph]lutrgb=r='max(val-225,0)*4':g='max(val-225,0)*4':b='max(val-225,0)*4',hue=s=0.3,format=rgb24,scale=150:112,gblur=sigma=6,scale=1200:896:flags=bicubic[hl];
[5:v]format=gray,format=rgb24,split=2[glass][glass2];
[hl][glass]blend=all_mode=multiply,lutrgb=r=val*${BLOOM}:g=val*${BLOOM}:b=val*${BLOOM}[bloom];
[lit][bloom]blend=all_mode=screen,format=rgb24[lit2];
${FLARE_FC}
[lit3]crop=1200:675:0:0,scale=1280:720:flags=lanczos,format=yuv420p[out]" -map "[out]" -t "$T" -r 24 -c:v libx264 -crf 20 -movflags +faststart "$OUT"
