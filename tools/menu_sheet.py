"""The menu pages from her PDFs, with the words and prices from the Google Sheet.

Her pages stay exactly as designed: every line keeps its place, font, size and colour. The Sheet's Menu tab has one
row per dish, drink, heading or note, matched to the lines on the page. A row whose text is unchanged is drawn exactly
as in the PDF; a changed row is set again in the same place, font, size, colour and letter spacing. A description is
wrapped to the width it had, and may take more lines only where the page has room below it.
If any row does not fit, nothing changes and the reason is printed for each row.

Usage:
  python3 tools/menu_sheet.py --seed          write data/menu-sheet.csv from the PDF layout, then the pages
  python3 tools/menu_sheet.py [file.csv]      the pages from the given rows (default data/menu-sheet.csv)
Writes js/menu-pdf.js. Reads data/menu-layout.json (made by tools/pdf_book.py) and the fonts in fonts/.
"""
import csv, json, math, re, sys
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
LAYOUT = ROOT / 'data' / 'menu-layout.json'
ROWS = ROOT / 'data' / 'menu-sheet.csv'
OUT = ROOT / 'js' / 'menu-pdf.js'
W = 595.5
FONTFILE = {'f-lv': 'lovelo-black.woff2', 'f-ju': 'juliussansone-400-latin.woff2', 'f-lb': 'livvic-700-latin.woff2',
            'f-ls': 'livvic-600-latin.woff2', 'f-no': 'jost-normal-latin.woff2'}
FIELDS = ['id', 'menu', 'page', 'section', 'type', 'name', 'description', 'price', 'note']
PRICE = re.compile(r'^(\d[\d,.]*)\s*EGP$')


class Font:
    def __init__(self, cls):
        t = TTFont(ROOT / 'fonts' / FONTFILE[cls])
        self.upm = t['head'].unitsPerEm
        self.base = (1 + t['hhea'].ascent / self.upm + t['hhea'].descent / self.upm) / 2
        self.cmap = t.getBestCmap(); self.hm = t['hmtx']

    def has(self, ch): return ch == ' ' or ord(ch) in self.cmap

    def adv(self, ch):
        g = self.cmap.get(ord(ch))
        return self.hm[g][0] / self.upm if g else 0.5


FONTS = {k: Font(k) for k in FONTFILE}


def width(text, cls, size, ls):
    """width in points of text set in this font, size and letter spacing (em), with the stand-in for missing glyphs"""
    f = FONTS[cls]
    w = sum((f if f.has(c) else FONTS['f-no']).adv(c) for c in text) * size
    return w + ls * size * max(0, len(text) - 1)


# ------------------------------------------------------------------ lines and items on a page
def lines_of(page):
    """spans on one baseline that follow each other become one line"""
    spans = sorted(page['spans'], key=lambda s: (round(s['y']), s['x']))
    out = []
    for s in spans:
        cur = out[-1] if out else None
        if cur and abs(cur['y'] - s['y']) < 0.9 and 0 <= s['x'] - cur['end'] < 2.2 * max(cur['size'], s['size']):
            gap = s['x'] - cur['end']
            cur['text'] += (' ' if gap > 0.12 * s['size'] else '') + s['text']
            cur['end'] = s['end']; cur['spans'].append(s)
        else:
            out.append(dict(x=s['x'], y=s['y'], end=s['end'], size=s['size'], cls=s['cls'], col=s['col'], ls=s['ls'],
                            text=s['text'], spans=[s]))
    # a tiny raised tag next to a name (VE) belongs to that name
    tags = [l for l in out if l['cls'] == 'f-lv' and l['size'] < 4.8]
    for t in tags:
        host = next((l for l in out if l is not t and l['cls'] == 'f-lv' and l['size'] >= 9 and 0 < t['y'] - l['y'] + 4 < 6 and abs(t['x'] - l['end']) < 4), None)
        if host: host['tag'] = t; out.remove(t)
    return sorted(out, key=lambda l: (l['y'], l['x']))


def role(l, drinks):
    c, s = l['cls'], l['size']
    if s >= 14: return 'heading'
    if drinks:
        if c == 'f-ju' and PRICE.match(l['text']): return 'price'
        if c == 'f-lv' and s >= 10.5: return 'name'
        if c == 'f-lv' and s < 8: return 'note'
        return 'text'
    if c == 'f-lv' and 9 <= s < 14: return 'name'
    if c == 'f-ju': return 'price' if PRICE.match(l['text']) else 'desc'
    if c in ('f-lb', 'f-ls') and (l['y'] < 60 or l['y'] > 780): return 'text'
    return 'note'


def column_of(x, cols):
    return min(cols, key=lambda c: abs(c - x))


def items_of(page, pn):
    """group the page's lines into rows for the Sheet: dishes (name, description, price, notes), drinks, headings"""
    drinks = pn == 3
    ls_ = lines_of(page)
    for l in ls_: l['role'] = role(l, drinks)
    items = []
    if not drinks:
        cols = sorted({round(l['x']) for l in ls_ if l['role'] == 'name'})
        cols = [c for i, c in enumerate(cols) if i == 0 or c - cols[i - 1] > 20]
        for l in ls_: l['colx'] = column_of(l['x'], cols) if cols else l['x']
        cur = {}
        for l in sorted(ls_, key=lambda l: (l['colx'], l['y'])):
            r = l['role']
            if r in ('heading', 'text'):
                items.append(dict(type=r, lines=[l])); cur.pop(l['colx'], None)
            elif r == 'name':
                it = dict(type='dish', lines=[l]); items.append(it); cur[l['colx']] = it
            else:
                it = cur.get(l['colx'])
                if it and abs(l['x'] - it['lines'][0]['x']) < 3 and l['y'] - it['lines'][-1]['y'] < 3.2 * max(l['size'], 5):
                    it['lines'].append(l)
                else:
                    last = next((it for it in reversed(items) if it['lines'][0].get('colx') == l['colx']), None)
                    if last and last['type'] == 'note' and abs(last['lines'][-1]['x'] - l['x']) < 30 and l['y'] - last['lines'][-1]['y'] < 3 * l['size']:
                        last['lines'].append(l)
                    else:
                        items.append(dict(type='note', lines=[l]))
                    cur.pop(l['colx'], None)
    else:
        prices = [l for l in ls_ if l['role'] == 'price']
        names = [l for l in ls_ if l['role'] == 'name']
        used = set()
        for p in sorted(prices, key=lambda l: (l['x'], l['y'])):
            row = [n for n in names if abs(n['y'] - p['y']) < 0.45 * p['size'] and 0 < p['x'] - n['x'] < 240 and id(n) not in used]
            if not row: items.append(dict(type='note', lines=[p])); continue
            n = min(row, key=lambda n: (abs(n['y'] - p['y']), p['x'] - n['x'])); used.add(id(n))
            it = dict(type='drink', lines=[n], price=p); items.append(it)
        # a name with no price of its own continues the drink above it in the same column (a long name, or a list under one price)
        for n in sorted(names, key=lambda l: (l['x'], l['y'])):
            if id(n) in used: continue
            above = [it for it in items if it['type'] == 'drink' and abs(it['lines'][0]['x'] - n['x']) < 3 and 0 < n['y'] - it['lines'][-1]['y'] < 2.2 * n['size']]
            if above:
                it = min(above, key=lambda it: n['y'] - it['lines'][-1]['y']); it['lines'].append(n); used.add(id(n))
            else:
                items.append(dict(type='text', lines=[n])); used.add(id(n))
        # small print under a heading (the syrup list) is one note, line after line
        for l in sorted([l for l in ls_ if l['role'] in ('note', 'text', 'heading')], key=lambda l: (round(l['x']), l['y'])):
            last = items[-1] if items else None
            if l['role'] == 'note' and last and last['type'] == 'list' and abs(last['lines'][-1]['x'] - l['x']) < 3 and l['y'] - last['lines'][-1]['y'] < 2.2 * l['size']:
                last['lines'].append(l)
            else:
                items.append(dict(type='list' if l['role'] == 'note' else l['role'], lines=[l]))
    for it in items:
        it['lines'].sort(key=lambda l: l['y'])
    items.sort(key=lambda it: (round(it['lines'][0]['x'] / 40), it['lines'][0]['y']))
    return items, ls_


def fields_of(it):
    """the Sheet's view of one item"""
    L = it['lines']
    if it['type'] == 'dish':
        name = L[0]['text']
        desc, price, note = [], '', []
        for l in L[1:]:
            if l['role'] == 'desc' and not price and not note: desc.append(l['text'])
            elif l['role'] == 'price' and not price: price = PRICE.match(l['text']).group(1)
            else: note.append(l['text'])
        return dict(name=name, description=' '.join(desc), price=price, note='\n'.join(note))
    if it['type'] == 'drink':
        return dict(name='\n'.join(l['text'] for l in L), description='', price=PRICE.match(it['price']['text']).group(1), note='')
    return dict(name='\n'.join(l['text'] for l in L), description='', price='', note='')


# ------------------------------------------------------------------ setting changed text
def wrap(text, cls, size, ls, maxw):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if cur and width(t, cls, size, ls) > maxw: lines.append(cur); cur = w
        else: cur = t
    if cur: lines.append(cur)
    return lines


def runs_for(text, x, baseline, l):
    """one line of new text: runs in the line's font, with the stand-in font for glyphs it lacks"""
    f, size, ls, out = FONTS[l['cls']], l['size'], l['ls'], []
    seg, segcls, sx, cx = '', None, x, x
    for ch in text:
        c = l['cls'] if f.has(ch) else 'f-no'
        if c != segcls and seg:
            out.append((sx, segcls, seg)); seg = ''; sx = cx
        if not seg: sx = cx
        seg += ch; segcls = c
        cx += FONTS[c].adv(ch) * size + ls * size
    if seg: out.append((sx, segcls, seg))
    return [[round(sx / W * 100, 3), round((baseline - FONTS[c].base * size) / W * 100, 3), round(size / W * 100, 4), c, l['col'], t,
             round(ls, 4) if len(t) > 1 else 0] for sx, c, t in out]


def original_runs(page, l):
    out = [page['runs'][i] for s in l['spans'] for i in range(*s['runs'])]
    if l.get('tag'): out += [page['runs'][i] for s in l['tag']['spans'] for i in range(*s['runs'])]
    return out


def set_line(page, l, text, baseline=None, problems=None, label='', maxw=None, right=False):
    """runs for a line: the PDF's own when unchanged and in place, else the text set again
    (right=True keeps its right edge, as her drink prices are set)"""
    baseline = l['y'] if baseline is None else baseline
    if text == l['text'] and abs(baseline - l['y']) < 0.01: return original_runs(page, l)
    w = width(text, l['cls'], l['size'], l['ls'])
    if maxw and w > maxw + 0.5 and problems is not None:
        problems.append(f'{label}: "{text}" is too long for its place on the page')
    out = runs_for(text, l['end'] - w if right else l['x'], baseline, l)
    if l.get('tag'):
        t = l['tag']; dx = l['x'] + width(text, l['cls'], l['size'], l['ls']) + 0.6 - t['x']
        out += [[round(r[0] + dx / W * 100, 3), round(r[1] + (baseline - l['y']) / W * 100, 3)] + r[2:] for s in t['spans'] for r in [page['runs'][i] for i in range(*s['runs'])]]
    return out


def room(items, it, ls_, page_bottom):
    """points free below an item before the next thing in its column (keeping the page's tightest gap)"""
    L = it['lines']; x0, bottom = L[0]['x'], L[-1]['y']
    below = [l['y'] - l['size'] for l in ls_ if abs(l['x'] - x0) < 3 and l['y'] > bottom + 0.5 and l not in L]
    nxt = min(below) if below else page_bottom
    return nxt - bottom


def build_page(page, items, ls_, rows, label, problems):
    runs, used = [], set()
    footer = [l['y'] - l['size'] for l in ls_ if l['role'] == 'text' and l['y'] > 780]
    bottom = min(footer) if footer else 800
    gaps = []
    for it in items:
        if it['type'] == 'dish':
            r = room(items, it, ls_, bottom)
            if r > 0: gaps.append(r)
    tight = min(gaps) if gaps else 0
    for it in items:
        L = it['lines']; row = rows.get(it['id'])
        new = fields_of(it) if row is None else {k: (row.get(k) or '').strip() for k in ('name', 'description', 'price', 'note')}
        old = fields_of(it)
        tag = f"{label} row {it['id']}"
        for l in L: used.add(id(l))
        if new == old:
            for l in L: runs += original_runs(page, l)
            if it.get('price'): runs += original_runs(page, it['price']); used.add(id(it['price']))
            continue
        if it['type'] in ('heading', 'text', 'list', 'note') or it['type'] == 'drink':
            parts = new['name'].split('\n')
            if len(parts) > len(L): problems.append(f'{tag}: has {len(parts)} lines, its place on the page holds {len(L)}'); continue
            limit = None
            if it['type'] == 'drink': limit = it['price']['x'] - L[0]['x'] - 4
            for i, l in enumerate(L):
                runs += set_line(page, l, parts[i] if i < len(parts) else '', problems=problems, label=tag,
                                 maxw=limit if limit else max(l['end'] - l['x'], 0) * 1.08 + 6)
            if it['type'] == 'drink':
                p = it['price']; used.add(id(p))
                if not re.fullmatch(r'\d[\d,.]*', new['price']): problems.append(f'{tag}: price "{new["price"]}" must be a number'); continue
                runs += set_line(page, p, f"{new['price']} EGP", right=True)
            continue
        # a dish: name, description wrapped to its width, price, notes, each line after the last
        name_l = L[0]
        # the same reading as fields_of: description lines until the price, the price, then notes
        desc_ls, price_l, note_ls = [], None, []
        for l in L[1:]:
            if l['role'] == 'desc' and not price_l and not note_ls: desc_ls.append(l)
            elif l['role'] == 'price' and not price_l: price_l = l
            else: note_ls.append(l)
        if new['price'] and not re.fullmatch(r'\d[\d,.]*', new['price']):
            problems.append(f'{tag}: price "{new["price"]}" must be a number'); continue
        if bool(new['price']) != bool(price_l):
            problems.append(f'{tag}: this dish {"has no" if not price_l else "needs a"} price line on the page'); continue
        runs += set_line(page, name_l, new['name'], problems=problems, label=tag, maxw=colwidth(ls_, name_l))
        ref = desc_ls[0] if desc_ls else (price_l or name_l)
        pitch = (desc_ls[1]['y'] - desc_ls[0]['y']) if len(desc_ls) > 1 else (price_l['y'] - ref['y'] if price_l and desc_ls else ref['size'] * 1.82)
        wrapw = max([l['end'] - l['x'] for l in desc_ls] + [0])
        if new['description'] == old['description']: dl = [l['text'] for l in desc_ls]
        else: dl = wrap(new['description'], ref['cls'], ref['size'], ref['ls'], wrapw) if new['description'] else []
        if desc_ls and len(dl) > len(desc_ls):
            dl = wrap(new['description'], ref['cls'], ref['size'], ref['ls'], colwidth(ls_, ref))
        if new['description'] and not desc_ls:
            problems.append(f'{tag}: this dish has no description on the page'); continue
        notes = [n for n in new['note'].split('\n') if n.strip()] if new['note'] else []
        if len(notes) > len(note_ls): problems.append(f'{tag}: the note has {len(notes)} lines, the page holds {len(note_ls)}'); continue
        extra = (len(dl) - len(desc_ls)) * pitch
        if extra > 0 and extra > room(items, it, ls_, bottom) - tight + 0.5:
            problems.append(f'{tag}: the description needs {len(dl)} lines; there is room for {len(desc_ls)} here. Shorten it a little.'); continue
        y = desc_ls[0]['y'] if desc_ls else None
        for i, t in enumerate(dl):
            runs += set_line(page, desc_ls[min(i, len(desc_ls) - 1)], t, baseline=y + i * pitch)
        shift = extra
        if price_l: runs += set_line(page, price_l, f"{new['price']} EGP", baseline=price_l['y'] + shift)
        for i, l in enumerate(note_ls):
            if i < len(notes): runs += set_line(page, l, notes[i], baseline=l['y'] + shift, problems=problems, label=tag, maxw=colwidth(ls_, l))
    for l in ls_:
        if id(l) not in used: runs += original_runs(page, l)
    return runs


def colwidth(ls_, l):
    """how wide a line may run: to the next column on its right, or the page's right margin"""
    left = min(x['x'] for x in ls_)
    right = [x['x'] for x in ls_ if x['x'] > l['x'] + 40 and abs(x['y'] - l['y']) < 80]
    return (min(right) - 8 if right else W - left) - l['x']


# ------------------------------------------------------------------ the Sheet rows
def all_items(layout):
    """every page's items, with ids; the drinks page is the same in both menus, so it is listed once"""
    pages = {}
    for svc in ('morning', 'evening'):
        for pn, page in enumerate(layout[svc]):
            if pn == 0: continue
            items, ls_ = items_of(page, pn)
            section = ''
            for i, it in enumerate(items):
                key = 'D' if pn == 3 else svc[0].upper() + str(pn + 1)
                it['id'] = f'{key}-{i + 1:02d}'
            pages[(svc, pn)] = (items, ls_)
    return pages


def seed_rows(layout, pages):
    rows = []
    same_drinks = [l['text'] for l in lines_of(layout['morning'][3])] == [l['text'] for l in lines_of(layout['evening'][3])]
    for (svc, pn), (items, ls_) in pages.items():
        if pn == 3 and svc == 'evening' and same_drinks: continue
        heads = [it for it in items if it['type'] == 'heading']
        for it in items:
            f = fields_of(it)
            y, x = it['lines'][0]['y'], it['lines'][0]['x']
            above = [h for h in heads if h['lines'][0]['y'] <= y + 1 and (pn != 3 or abs(h['lines'][0]['x'] - x) < 30)]
            section = fields_of(max(above, key=lambda h: h['lines'][0]['y']))['name'] if above else ''
            rows.append(dict(id=it['id'], menu='Both' if pn == 3 and same_drinks else svc.title(), page=pn + 1,
                             section=section if it['type'] != 'heading' else '', type=it['type'], **f))
    return rows


def main():
    layout = json.loads(LAYOUT.read_text())
    pages = all_items(layout)
    if '--seed' in sys.argv:
        with ROWS.open('w', newline='') as fh:
            w = csv.DictWriter(fh, FIELDS); w.writeheader(); w.writerows(seed_rows(layout, pages))
        src = ROWS
    else:
        src = Path(next((a for a in sys.argv[1:] if not a.startswith('--')), ROWS))
    rows = {}
    with open(src, newline='') as fh:
        for r in csv.DictReader(fh):
            rid = (r.get('id') or '').strip()
            if rid: rows[rid] = r
    problems = []
    known = {it['id'] for items, _ in pages.values() for it in items}
    for rid in rows:
        if rid not in known: problems.append(f'row {rid}: no such place on the menu pages (ids come from the page layout; do not change them)')
    for rid in known:
        if rid not in rows: problems.append(f'row {rid} is missing from the Sheet')
    out = {}
    for svc in ('morning', 'evening'):
        out[svc] = []
        for pn, page in enumerate(layout[svc]):
            if pn == 0:
                runs = page['runs']
            else:
                items, ls_ = pages[(svc, pn)]
                runs = build_page(page, items, ls_, rows, f'{svc.title()} page {pn + 1}', problems)
            out[svc].append(dict(runs=runs, art=page['art'], cover=page['cover']))
    if problems:
        sys.exit('Menu not updated:\n- ' + '\n- '.join(dict.fromkeys(problems)))
    OUT.write_text('/* her printed Morning and Evening menus, page by page (tools/pdf_book.py from her PDFs, words and prices from the Sheet by tools/menu_sheet.py) */\n'
                   'window.LULUS_PDF = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('menu pages written:', {s: [len(p['runs']) for p in out[s]] for s in out})


if __name__ == '__main__':
    main()
