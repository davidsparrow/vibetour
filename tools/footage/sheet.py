"""sheet.py <out.png> <cols> <width> <img>=<label> ... : labelled contact sheet."""
import sys
from PIL import Image, ImageDraw, ImageFont
out, cols, W = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
items = [a.split("=", 1) for a in sys.argv[4:]]
ims = [Image.open(p).convert("RGB") for p, _ in items]
cw = W // cols; ch = int(ims[0].height * cw / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cw * cols, ch * rows), (16, 16, 16))
try: font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", max(16, cw // 32))
except Exception: font = ImageFont.load_default()
for i, (im, (_, label)) in enumerate(zip(ims, items)):
    im = im.resize((cw, ch), Image.LANCZOS); d = ImageDraw.Draw(im)
    x, y = 14, ch - font.size - 26
    b = d.textbbox((x, y), label, font=font); d.rectangle((b[0] - 8, b[1] - 6, b[2] + 8, b[3] + 6), fill=(0, 0, 0))
    d.text((x, y), label, font=font, fill=(255, 255, 255))
    sheet.paste(im, ((i % cols) * cw, (i // cols) * ch))
sheet.save(out); print(out, sheet.size)
