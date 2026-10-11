# scripts/xiang-draw.py — draw each model's 相盤 points on the test photos
# (scripts/xiang-model-test.ts), one sheet per model: face, left, right.
#   python3 scripts/xiang-draw.py <dir with face.png left.png right.png and <model>.json>
import json, sys, os
from PIL import Image, ImageDraw
d = sys.argv[1]
COL = {'life': (229, 57, 53), 'head': (30, 136, 229), 'heart': (216, 27, 96), 'fate': (67, 160, 71), 'sun': (251, 140, 0)}
def load(k):
    im = Image.open(os.path.join(d, f'{k}.png')).convert('RGB')
    return im.resize((int(im.size[0] * 900 / im.size[1]), 900))
for name in sorted(f for f in os.listdir(d) if f.endswith('.json')):
    j = json.load(open(os.path.join(d, name)))
    p = j.get('parsed') or {}
    tiles = []
    for k in ['face', 'left', 'right']:
        im = load(k); w, h = im.size; dr = ImageDraw.Draw(im)
        P = lambda pt: (pt[0] * w / 1000, pt[1] * h / 1000)
        part = p.get(k) or {}
        if k == 'face':
            box = part.get('box')
            if isinstance(box, list) and len(box) == 4:
                dr.rectangle([P(box[:2]), P(box[2:])], outline=(255, 200, 0), width=2)
            for mk in ['hairline', 'brow', 'noseBase', 'chin']:
                m = (part.get('marks') or {}).get(mk)
                if m: y = m[1] * h / 1000; dr.line([(0, y), (w, y)], fill=(255, 230, 0), width=2)
            for mk, m in (part.get('marks') or {}).items():
                if m: x, y = P(m); dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(229, 57, 53)); dr.text((x + 7, y - 7), mk, fill=(0, 0, 0))
        else:
            for l in part.get('lines') or []:
                pts = [P(q) for q in l.get('points') or [] if isinstance(q, list) and len(q) >= 2]
                if len(pts) >= 2:
                    dr.line(pts, fill=(255, 255, 255), width=7); dr.line(pts, fill=COL.get(l.get('key'), (0, 0, 0)), width=4)
                    dr.text((pts[-1][0] + 4, pts[-1][1]), l.get('key', ''), fill=(0, 0, 0))
        tiles.append(im)
    W = sum(t.size[0] for t in tiles) + 20
    sheet = Image.new('RGB', (W, 940), 'white'); x = 0
    for t in tiles: sheet.paste(t, (x, 40)); x += t.size[0] + 10
    ImageDraw.Draw(sheet).text((10, 10), f"{j.get('model')}  {j.get('ms', 0) / 1000:.0f}s  ${j.get('cost', 0):.3f}", fill=(0, 0, 0))
    sheet.save(os.path.join(d, 'draw-' + name.replace('.json', '.jpg')), quality=80)
    print('drew', name)
