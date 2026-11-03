"""Builds the Napkin Viewer PWA from the artifact's page (tools/napkin.html) into docs/."""
import hashlib, json, pathlib, shutil
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / 'tools' / 'napkin.html'
DIST = ROOT / 'docs'

page = SRC.read_text()
runtime = (ROOT / 'src' / 'runtime.js').read_text()
version = hashlib.sha256((page + runtime + (ROOT / 'src' / 'sw.js').read_text()).encode()).hexdigest()[:10]

# The artifact page is a fragment the platform wraps; the viewer needs a full document.
page = page.replace('<title>Back of the Napkin</title>', '', 1)
viewer_css = """<style>
html.viewer #composer { display: none !important; }
html.viewer .viewer-fs { margin-left: auto; margin-right: 8px; }
</style>"""
head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Napkins</title>
<meta name="theme-color" content="#d5dcd2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1c1a17" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="icon" href="./icon-192.png">
<link rel="apple-touch-icon" href="./icon-192.png">
<!-- napkin viewer {version} -->
<script>
{runtime}
</script>
{viewer_css}
<style>html,body{{margin:0}}body{{background:#d5dcd2}}[hidden]{{display:none!important}}</style>
</head>
<body>
"""
html = head + page + '\n</body>\n</html>\n'

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir()
(DIST / 'index.html').write_text(html)
(DIST / 'sw.js').write_text((ROOT / 'src' / 'sw.js').read_text().replace('__VERSION__', version))
(DIST / '.nojekyll').write_text('')

manifest = {
    'name': 'Napkins',
    'short_name': 'Napkins',
    'description': 'Your Back of the Napkin notes, offline and full screen.',
    'id': './',
    'start_url': './',
    'scope': './',
    'display': 'fullscreen',
    'display_override': ['fullscreen', 'standalone'],
    'orientation': 'any',
    'background_color': '#d5dcd2',
    'theme_color': '#d5dcd2',
    'icons': [
        {'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
        {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
        {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
    ],
    'share_target': {
        'action': './share',
        'method': 'POST',
        'enctype': 'multipart/form-data',
        'params': {
            'title': 'title', 'text': 'text', 'url': 'url',
            'files': [{'name': 'file', 'accept': ['application/json', '.json', 'image/svg+xml', '.svg', 'text/plain', '.txt']}],
        },
    },
}
(DIST / 'manifest.webmanifest').write_text(json.dumps(manifest, indent=2))


def icon(size, maskable=False):
    s = size
    img = Image.new('RGBA', (s, s), (213, 220, 210, 255) if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(s * (0.2 if maskable else 0.08))
    x0, y0, x1, y1 = pad, pad, s - pad, s - pad
    fold = int((x1 - x0) * 0.22)
    if not maskable:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.2), fill=(213, 220, 210, 255))
    d.polygon([(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)], fill=(251, 250, 245, 255), outline=(190, 184, 168, 255))
    d.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=(226, 221, 207, 255), outline=(190, 184, 168, 255))
    mx, my = (x0 + x1) // 2, (y0 + y1) // 2
    d.line([(mx, y0 + fold // 2), (mx, y1)], fill=(214, 209, 194, 255), width=max(1, s // 128))
    d.line([(x0, my), (x1, my)], fill=(214, 209, 194, 255), width=max(1, s // 128))
    ink = (35, 63, 146, 255)
    w = max(2, s // 40)
    lx = x0 + int((x1 - x0) * 0.1)
    for i, f in enumerate([0.55, 0.32, 0.42]):
        y = y0 + int((y1 - y0) * (0.18 + i * 0.11))
        d.line([(lx, y), (lx + int((x1 - x0) * f), y)], fill=ink, width=w)
    cx, cy, r = x0 + int((x1 - x0) * 0.62), y0 + int((y1 - y0) * 0.72), int((x1 - x0) * 0.17)
    d.ellipse([cx - r, cy - int(r * 0.7), cx + r, cy + int(r * 0.7)], outline=ink, width=w)
    return img


icon(192).save(DIST / 'icon-192.png')
icon(512).save(DIST / 'icon-512.png')
icon(512, True).save(DIST / 'icon-maskable-512.png')
print('built', version, sum(f.stat().st_size for f in DIST.iterdir()) // 1024, 'KB')
