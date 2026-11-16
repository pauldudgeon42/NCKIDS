#!/bin/sh
# Creates sample files for tests/e2e.js in tests/media (needs ffmpeg and Python with Pillow)
set -e
cd "$(dirname "$0")" && mkdir -p media shots && cd media
ffmpeg -loglevel error -y -f lavfi -i "gradients=s=1280x720:d=4:speed=0.05,format=yuv420p" -c:v libx264 -t 4 bg_blue_loop.mp4
ffmpeg -loglevel error -y -f lavfi -i "testsrc2=s=1280x720:d=6" -f lavfi -i "sine=frequency=440:duration=6" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest Lesson_Video.mp4
python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
f = ImageFont.load_default(size=90)
for name, c in [("Slide1",(200,80,60)),("Slide2",(60,140,200)),("Slide3",(80,170,90)),("Slide10",(10,10,10))]:
    im = Image.new('RGB',(1920,1080),c); ImageDraw.Draw(im).text((960,540),name,fill='white',font=f,anchor='mm'); im.save(name+".jpg")
im = Image.new('RGBA',(800,400),(0,0,0,0)); ImageDraw.Draw(im).text((400,200),"NC KIDS",fill=(255,204,51),font=f,anchor='mm'); im.save("logo.png")
PY
cp ../song-sample.txt JesusLovesMe.txt
