"""Turn her Morning/Evening menu PDFs into page data for the book: every text run with its exact place,
font, size, colour and tracking, plus a transparent PNG of the page's non-text marks (drink icons, rules)
and a mask PNG of the cover wordmark.
Usage: python3 tools/pdf_book.py   (reads menu-source/morning.pdf and menu-source/evening.pdf)
Writes js/menu-pdf.js and img/menu-pdf/. Stops with a clear message, changing nothing, if a PDF is not the
4-page layout it knows (her cover, two food pages, the drinks page) or uses a font the site does not have."""
import json, sys, pymupdf as fitz
from pathlib import Path
from fontTools.ttLib import TTFont
from PIL import Image
import numpy as np, io

ROOT = Path(__file__).resolve().parent.parent
SRC = {'morning': ROOT / 'menu-source' / 'morning.pdf', 'evening': ROOT / 'menu-source' / 'evening.pdf'}
FONTS = {  # PDF font -> (css class, file for metrics)
  'Lovelo-Black': ('f-lv', 'lovelo-black.woff2'), 'JuliusSansOne-Regular': ('f-ju', 'juliussansone-400-latin.woff2'),
  'Livvic-Bold': ('f-lb', 'livvic-700-latin.woff2'), 'Livvic-SemiBold': ('f-ls', 'livvic-600-latin.woff2'),
  'NotoSans-Regular': ('f-no', 'jost-normal-latin.woff2')}
COL = {0x592302: 'c-ink', 0xcd5810: 'c-or', 0xfa3ab0: 'c-pk', 0x8a4f25: 'c-cv'}
met = {}
for k, (cls, fn) in FONTS.items():
    t = TTFont(ROOT / 'fonts' / fn); upm = t['head'].unitsPerEm
    a, dsc = t['hhea'].ascent / upm, -t['hhea'].descent / upm
    met[k] = dict(cls=cls, base=(1 + a - dsc) / 2, cmap=t.getBestCmap(), hm=t['hmtx'], upm=upm)
W, H = 595.5, 842.25
def adv(fk, ch):
    m = met[fk]; g = m['cmap'].get(ord(ch))
    return m['hm'][g][0] / m['upm'] if g else 0.5
problems = []
for svc, pdf in SRC.items():
    if not pdf.exists(): problems.append(f'{pdf.name} is missing'); continue
    d = fitz.open(pdf)
    if d.page_count != 4: problems.append(f'{pdf.name} has {d.page_count} pages, the book needs exactly 4')
    seen = {s['font'] for p in d for b in p.get_text('rawdict')['blocks'] for l in b.get('lines', []) for s in l['spans'] if s['size'] >= 2}
    for f in sorted(seen - set(FONTS) - {'BrownSugar'}): problems.append(f'{pdf.name} uses the font {f}, which the site does not have')
if problems: sys.exit('Menu not updated:\n- ' + '\n- '.join(problems))
tmp_dir = ROOT / 'img' / 'menu-pdf.new'; tmp_dir.mkdir(parents=True, exist_ok=True)
out_dir = tmp_dir
PAPER = np.array([242., 239., 235.])
def keyed(pix):
    im = np.array(Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')).astype(float)
    dist = np.sqrt(((im - PAPER) ** 2).sum(-1)); a = np.clip((dist - 8) / 36, 0, 1)
    rgb = (im - PAPER * (1 - a[..., None])) / np.maximum(a[..., None], 1e-3)
    return np.dstack([np.clip(rgb, 0, 255), a * 255]).astype('uint8'), a.max()
data = {}
for svc, pdf in SRC.items():
    doc = fitz.open(pdf); pages = []
    for pn in range(4):
        pg = doc[pn]; runs = []
        for b in pg.get_text('rawdict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    if s['size'] < 2 or s['font'] == 'BrownSugar': continue
                    ch = s['chars']; txt = ''.join(c['c'] for c in ch).rstrip()
                    if not txt.strip(): continue
                    ch = ch[:len(txt)]
                    fk = s['font']; size = s['size']
                    nat = sum(adv(fk, c['c']) for c in ch[:-1]) * size
                    span = ch[-1]['origin'][0] - ch[0]['origin'][0]
                    ls = (span - nat) / (len(ch) - 1) if len(ch) > 1 else 0
                    # where her design software spaced letters unevenly (kerned headings), keep each letter's own place
                    dev = max((abs((ch[i + 1]['origin'][0] - ch[i]['origin'][0]) - adv(fk, ch[i]['c']) * size - ls) for i in range(len(ch) - 1)), default=0)
                    pieces = [[c] for c in ch] if dev > 0.12 * size else [ch]
                    for pc in pieces:
                        t = ''.join(c['c'] for c in pc)
                        if not t.strip(): continue
                        x, y = pc[0]['origin']
                        runs.append([round(x / W * 100, 3), round((y - met[fk]['base'] * size) / W * 100, 3), round(size / W * 100, 4),
                                     met[fk]['cls'], COL.get(s['color'], 'c-ink'), t, round(ls / size, 4) if len(pc) > 1 else 0])
        # the marks that are not text: drink icons, rules; the cover's wordmark separately as a mask
        tmp = fitz.open(); tmp.insert_pdf(doc, from_page=pn, to_page=pn); tp = tmp[0]
        cover = any(s['font'] == 'BrownSugar' for b in pg.get_text('rawdict')['blocks'] for l in b.get('lines', []) for s in l['spans'])
        for b in tp.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    if s['font'] != 'BrownSugar': tp.add_redact_annot(fitz.Rect(s['bbox']))
        tp.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
        arr, mx = keyed(tp.get_pixmap(dpi=220))
        art = None
        if mx > 0.2:
            ys, xs = np.where(arr[..., 3] > 8)
            name = ('cover-a' if cover else (f'{svc[0]}-{pn + 1}' if pn < 3 else 'drinks')) + '.png'
            if cover:  # one colour: kept as a mask so it can take the season's colour
                m = arr[..., 3]; Image.fromarray(np.dstack([np.full_like(m, 255)] * 3 + [m]), 'RGBA').save(out_dir / name, optimize=True)  # white with the mark in alpha: an alpha mask works in every browser
            else:
                Image.fromarray(arr, 'RGBA').save(out_dir / name, optimize=True)
            art = name
        pages.append(dict(runs=runs, art=art, cover=cover))
    data[svc] = pages
import shutil
final = ROOT / 'img' / 'menu-pdf'
shutil.rmtree(final, ignore_errors=True); tmp_dir.rename(final)
(ROOT / 'js' / 'menu-pdf.js').write_text('/* her printed Morning and Evening menus, page by page (built by tools/pdf_book.py from her PDFs) */\nwindow.LULUS_PDF = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
for svc in data: print(svc, [(len(p['runs']), p['art']) for p in data[svc]])
