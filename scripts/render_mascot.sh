#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

art="site/mascot/serena-cutout.png"
motion="[0:v]crop=1040:1074:90:180,scale=520:-1,format=rgba,rotate='0.025*sin(2*PI*t/6)':ow=600:oh=600:c=none[character]"
placement="x='(W-w)/2+4*sin(2*PI*t/6)':y='(H-h)/2+10*cos(2*PI*t/6)':shortest=1"

# The transparent VP9 stream is used by browsers that support alpha playback.
ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 30 -i "$art" \
  -f lavfi -i 'color=c=black@0:s=720x720:r=30:d=6,format=rgba' \
  -filter_complex "$motion;[1:v][character]overlay=$placement:format=auto,format=yuva420p[out]" \
  -map '[out]' -t 6 -an -c:v libvpx-vp9 -b:v 0 -crf 30 -cpu-used 4 \
  -auto-alt-ref 0 -pix_fmt yuva420p site/mascot/serena-idle.webm

# Safari receives a paper-matched H.264 fallback.
ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 30 -i "$art" \
  -f lavfi -i 'color=c=0xfaf9f6:s=720x720:r=30:d=6,format=rgba' \
  -filter_complex "$motion;[1:v][character]overlay=$placement:format=rgb,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[out]" \
  -map '[out]' -t 6 -an -c:v libx264 -preset slow -crf 18 -movflags +faststart \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 site/mascot/serena-idle.mp4
