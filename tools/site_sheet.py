"""Puts the Seasons and Content tabs of her Google Sheet into the pages.

Seasons: one row per season and year (Summer, Fall, Winter, Valentine, Ramadan or Spring), its dates, its colours,
its mood word. The site picks the row whose dates hold today's date in Cairo.
Content: the words on the home page, one row per text block, matched to the page by the Key column.

Photos: the hero photo and the gallery photos of each season, from Google Drive (see tools/photos.py).

Usage: python3 tools/site_sheet.py [seasons.csv content.csv photos.csv]   (defaults: the three CSVs in data/)
       python3 tools/site_sheet.py --seed                                 (writes the CSVs from the pages as they are)
Nothing changes when a row is wrong: the reasons are printed and the pages keep their last good version."""
import csv, html, json, re, sys
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import photos as ph

ROOT = Path(__file__).resolve().parent.parent
PAGES = [ROOT / 'index.html', ROOT / 'menu.html']
KINDS = ['Summer', 'Fall', 'Winter', 'Valentine', 'Ramadan', 'Spring']
S_FIELDS = ['Season', 'Year', 'Starts', 'Ends', 'Background', 'Page', 'Text', 'Colour 1', 'Colour 2',
            'Mood word', 'Mood word colour', 'Mood word colour, evening', 'Headline colour', 'Menu cover colour']
C_FIELDS = ['Where', 'Text', 'Key']
WHERE = {'address': 'Address (top of the page and Visit card)', 'story.title': 'Our story: title', 'story.text': 'Our story: text',
         'gallery.title': 'Photos: title (the brand name follows it)', 'mood.1': 'Mood line, after the mood word',
         'mood.2': 'Mood line, second half', 'motion.title': 'In motion: title', 'motion.app': 'In motion: app link',
         'motion.note': 'In motion: line under the list', 'cannes.title': 'Cannes: title', 'cannes.text': 'Cannes: line',
         'visit.hours': 'Visit card: opening hours', 'visit.note': 'Visit card: second line'}
for i in range(1, 7): WHERE[f'motion.{i}'] = f'In motion: item {i}'
HEX = re.compile(r'^#[0-9a-fA-F]{6}$')


def rgb(h): h = h.lstrip('#'); return [int(h[i:i + 2], 16) for i in (0, 2, 4)]
def mix(a, b, p): return [x * p + y * (1 - p) for x, y in zip(a, b)]
def lum(c):
    f = lambda v: (v / 255) / 12.92 if v / 255 <= 0.03928 else ((v / 255 + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
def ratio(a, b): la, lb = lum(a), lum(b); return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
def hx(m): return '#%02x%02x%02x' % tuple(round(v) for v in m)


def word_colour(x):  # the mood word in the colour it names, deepened toward the text colour only as far as needed to read (3:1)
    c, bg, ink = x['colorHex'], x['colours']['bg'], x['colours']['ink']
    for k in range(0, 101, 4):
        m = mix(rgb(c), rgb(ink), 1 - k / 100)
        if ratio(m, rgb(bg)) >= 3: return hx(m)
    return ink
def word_colour_night(x):  # on the Evening ground it is lifted toward white instead (4.5:1)
    c = x['colorHex']; ground = mix(rgb(x['colours']['ink']), [0, 0, 0], 0.34)
    for k in range(0, 101, 4):
        m = mix(rgb(c), [255, 255, 255], 1 - k / 100)
        if ratio(m, ground) >= 4.5: return hx(m)
    return '#ffffff'


def data_of(page):
    m = re.search(r'var DATA = (\{.*?\});\n', page)
    return json.loads(m.group(1)), m


# ---------- seed: the CSVs from the pages as they are ----------
def seed():
    home = PAGES[0].read_text(); d, _ = data_of(home)
    words = dict(re.findall(r'<span class="rt s-([a-z0-9-]+)">([^<]*)</span>', home.split('class="room-line')[1].split('</p>')[0]))
    cols = dict(re.findall(r'html\[data-season="([a-z0-9-]+)"\] \.room-line em\{color:(#[0-9a-f]{6})\}', home))
    ncols = dict(re.findall(r'html\[data-mood="evening"\]\[data-season="([a-z0-9-]+)"\] \.room-line em\{color:(#[0-9a-f]{6})\}', home))
    with (ROOT / 'data' / 'seasons.csv').open('w', newline='') as fh:
        w = csv.DictWriter(fh, S_FIELDS); w.writeheader()
        for s in d['seasons']:
            kind, year = s['name'].rsplit(' ', 1); c = s['colours']
            # the mood word's colours: left empty when they are the ones worked out from her first colour
            day, night = cols[s['id']], ncols[s['id']]
            auto = {**s, 'colorHex': c['accent']}
            w.writerow({'Season': kind, 'Year': year, 'Starts': s['start'], 'Ends': s['end'], 'Background': c['bg'], 'Page': c.get('paper', ''),
                        'Text': c['ink'], 'Colour 1': c['accent'], 'Colour 2': c['accent2'], 'Mood word': words[s['id']],
                        'Mood word colour': '' if day == word_colour(auto) else day, 'Mood word colour, evening': '' if night == word_colour_night(auto) else night, 'Headline colour': s.get('pop', ''), 'Menu cover colour': s.get('cover', '')})
    with (ROOT / 'data' / 'content.csv').open('w', newline='') as fh:
        w = csv.DictWriter(fh, C_FIELDS); w.writeheader(); seen = set()
        for _, k, inner in re.findall(r'<(p|h2|span|a)\b[^>]*data-k="([^"]+)"[^>]*>(.*?)</\1>', home, re.S):
            if k in seen: continue
            seen.add(k)
            txt = html.unescape(re.sub(r'<[^>]+>', '', inner)).replace('\xa0', ' ')
            w.writerow({'Where': WHERE.get(k, k), 'Text': txt, 'Key': k})
    with (ROOT / 'data' / 'photos.csv').open('w', newline='') as fh:
        w = csv.DictWriter(fh, ph.P_FIELDS); w.writeheader(); seen = set()
        for s in d['seasons']:
            kind = s['name'].rsplit(' ', 1)[0]
            if s.get('heroImage') and kind not in seen:
                seen.add(kind); w.writerow({'Season': kind, 'Place': 'Hero', 'Photo': s['heroImage'], 'Description': s.get('heroAlt', '')})
        for kind, src, alt in re.findall(r'<figure class="fr f\d+ rv s-([a-z]+)-[^"]*"[^>]*><div class="fr-in"><img src="img/([^"]+)" alt="([^"]*)"', home):
            w.writerow({'Season': kind.title(), 'Place': 'Gallery', 'Photo': src, 'Description': html.unescape(alt)})
    print('Wrote data/seasons.csv, data/content.csv and data/photos.csv from the pages.')


# ---------- the pages from the CSVs ----------
def text_html(t):
    t = html.escape(t.strip(), quote=False)
    t = re.sub(r'(\d) (am|pm)\b', r'\1&nbsp;\2', t)
    return re.sub(r'(LÜLU(?:’S)?|Lülu’s)', r'<span translate="no">\1</span>', t)


def build(seasons_csv, content_csv, photos_csv, drive_csv=None):
    problems = []
    rows = [{k.strip(): (v or '').strip() for k, v in r.items() if k} for r in csv.DictReader(open(seasons_csv, newline=''))]
    rows = [r for r in rows if any(r.values())]
    seasons, ids = [], set()
    for n, r in enumerate(rows, 2):
        at = f'Seasons row {n}'
        kind = r.get('Season', '').title()
        if kind not in KINDS: problems.append(f'{at}: Season must be one of {", ".join(KINDS)}'); continue
        year = r.get('Year', '')
        if not re.fullmatch(r'20\d\d', year): problems.append(f'{at}: Year must be a year like 2027'); continue
        sid = f'{kind.lower()}-{year}'
        if sid in ids: problems.append(f'{at}: {kind} {year} is listed twice'); continue
        ids.add(sid)
        try: a, b = date.fromisoformat(r['Starts']), date.fromisoformat(r['Ends'])
        except ValueError: problems.append(f'{at}: Starts and Ends must be dates like 2027-03-10'); continue
        if b < a: problems.append(f'{at}: it ends before it starts'); continue
        need = ['Background', 'Text', 'Colour 1', 'Colour 2']
        for f in need + ['Page', 'Mood word colour', 'Mood word colour, evening', 'Headline colour', 'Menu cover colour']:
            v = r.get(f, '')
            if (v or f in need) and not HEX.match(v): problems.append(f'{at}: {f} must be a colour code like #db983e')
        if not r.get('Mood word'): problems.append(f'{at}: Mood word is empty')
        seasons.append((a, b, kind, year, sid, r))
    seasons.sort()
    for (a1, b1, k1, y1, *_), (a2, b2, k2, y2, *_) in zip(seasons, seasons[1:]):
        if a2 <= b1: problems.append(f'{k1} {y1} and {k2} {y2} overlap: a day can only have one season')
    content = {}
    for n, r in enumerate(csv.DictReader(open(content_csv, newline='')), 2):
        r = {k.strip(): (v or '').strip() for k, v in r.items() if k}
        k = r.get('Key', '')
        if not k: continue
        if k not in WHERE: problems.append(f'Content row {n}: unknown Key {k}')
        elif not r.get('Text'): problems.append(f'Content row {n} ({WHERE[k]}): the text is empty')
        content[k] = r.get('Text', '')
    for k in WHERE:
        if k not in content: problems.append(f'Content: the row with Key {k} ({WHERE[k]}) is missing')
    prow = [{k.strip(): (v or '').strip() for k, v in r.items() if k} for r in csv.DictReader(open(photos_csv, newline=''))]
    drive = {}
    if drive_csv and Path(drive_csv).exists():
        for r in csv.DictReader(open(drive_csv, newline='')):
            if (r.get('Photo') or '').strip() and (r.get('Photo ID') or '').strip(): drive[r['Photo'].strip()] = r['Photo ID'].strip()
    heroes, gallery, pp, keep = ph.process(prow, KINDS, drive)
    problems += pp
    if problems: sys.exit('Site not updated:\n- ' + '\n- '.join(dict.fromkeys(problems)))
    out = []
    for a, b, kind, year, sid, r in seasons:
        c = {'bg': r['Background'].lower()}
        if r.get('Page'): c['paper'] = r['Page'].lower()
        c.update(ink=r['Text'].lower(), accent=r['Colour 1'].lower(), accent2=r['Colour 2'].lower())
        s = {'id': sid, 'name': f'{kind} {year}'}
        if r.get('Headline colour'): s['pop'] = r['Headline colour'].lower()
        if r.get('Menu cover colour'): s['cover'] = r['Menu cover colour'].lower()
        hero = heroes.get(kind)
        s.update(start=a.isoformat(), end=b.isoformat(), colours=c, heroImage=hero['src'] if hero else '')
        if hero:
            if hero.get('tall'): s['heroTall'] = hero['tall']
            s.update(heroAlt=hero['alt'], heroW=hero['w'], heroH=hero['h'])
        else:
            s['heroAlt'] = ''
        s['_word'], s['colorHex'] = r['Mood word'], c['accent']
        s['_day'] = r.get('Mood word colour', '').lower() or word_colour(s)
        s['_night'] = r.get('Mood word colour, evening', '').lower() or word_colour_night(s)
        out.append(s)
    # the look when no season holds today: her Fall (the latest one), on its own background
    fall = [s for s in out if s['id'].startswith('fall-')]
    base = fall[-1] if fall else out[0]
    dc = {k: v for k, v in base['colours'].items() if k != 'paper'}
    default = {'id': 'default', 'name': '', 'colours': dc}
    for k in ('heroImage', 'heroTall', 'heroAlt', 'heroW', 'heroH'):
        if k in base: default[k] = base[k]
    default.update(_word=base['_word'], _day=base['_day'], _night=base['_night'])
    clean = lambda s: {k: v for k, v in s.items() if not k.startswith('_') and k != 'colorHex'}
    DATA = json.dumps({'def': clean(default), 'seasons': [clean(s) for s in out]}, ensure_ascii=False, separators=(',', ':'))
    every = [default] + out

    for page in PAGES:
        t = page.read_text()
        _, m = data_of(t)
        t = t[:m.start(1)] + DATA + t[m.end(1):]
        if page.name == 'index.html': t = home(t, out, every, content, gallery)
        page.write_text(t)
    ph.tidy(keep)
    print('Site updated from the Sheet:', ', '.join(s['name'] for s in out))


def home(t, out, every, content, gallery):
    kind = lambda sid: sid.split('-')[0]
    # the photo frames belong to a kind of season (her Fall photos show every Fall); placeholders fill each season's grid to four
    count, real, i = {}, [], 0
    for kname, items in gallery.items():
        k = kname.lower()
        sids = [s['id'] for s in out if kind(s['id']) == k] + (['default'] if k == 'fall' else [])
        if not sids: continue
        for d, f in enumerate(items):
            i += 1
            real.append(f'    <figure class="fr f{i} rv' + ''.join(f' s-{x}' for x in sids) + f'" style="--w:{f["w"] // 2}px;--r:{f["w"] / f["h"]:.4f};--z:0;--d:{d % 3}">'
                        f'<div class="fr-in"><img src="img/{f["src"]}" alt="{html.escape(f["alt"])}" width="{f["w"]}" height="{f["h"]}" loading="lazy" decoding="async"></div></figure>')
        for x in sids: count[x] = count.get(x, 0) + len(items)
    ph = []
    for s in out:
        n = count.get(s['id'], 0)
        if n >= 4: continue
        cls = f' s-{s["id"]}' + (' s-default' if s['id'].startswith('fall-') and s is [x for x in out if x['id'].startswith('fall-')][-1] else '')
        for d in range(n, 4):
            ph.append(f'    <figure class="fr rv{cls}" style="--w:360px;--r:0.8;--z:0;--d:{d % 3}"><div class="fr-in"><i class="ph-img" aria-hidden="true"></i></div></figure>')
    head, rest = t.split('<section class="room" id="room"', 1)
    first, after = rest.split('>\n', 1)
    body, tail = after.split('  </section>', 1)
    t = head + '<section class="room" id="room"' + first + '>\n' + '\n'.join(real + ph) + '\n  </section>' + tail

    ids = sorted({s['id'] for s in every})
    rules = '.room .fr:not(.s-any){display:none}' + ''.join(
        f'html[data-season="{x}"] .room .fr{{display:none}}html[data-season="{x}"] .room .fr.s-{x}{{display:block}}' for x in ids)
    rules += '.room-line .rt{display:none}' + ''.join(f'html[data-season="{x["id"]}"] .room-line .rt.s-{x["id"]}{{display:inline}}' for x in every)
    rules += ''.join(f'html[data-season="{x["id"]}"] .room-line em{{color:{x['_day']}}}'
                     f'html[data-mood="evening"][data-season="{x["id"]}"] .room-line em{{color:{x['_night']}}}' for x in every)
    rules += '.room-head .rt{display:none}' + ''.join(f'html[data-season="{x["id"]}"] .room-head .rt.s-{x["id"]}{{display:inline}}' for x in every)
    t = re.sub(r'<style>\.room \.fr:not\(\.s-any\).*?</style>', lambda m: f'<style>{rules}</style>', t, count=1, flags=re.S)

    titles = ''.join(f'<span class="rt s-{x["id"]}"' + (' translate="no">LÜLU’S' if x['id'] == 'default' else '>' + x['name'].rsplit(' ', 1)[0]) + '</span>' for x in every)
    t = re.sub(r'(<p class="at-h rv">)(?:<span class="rt[^>]*>[^<]*</span>)+', lambda m: m.group(1) + titles, t, count=1)
    words = ''.join(f'<span class="rt s-{x["id"]}">{html.escape(x["_word"])}</span>' for x in every)
    t = re.sub(r'(<p class="room-line rv"><span><em>)(?:<span class="rt[^>]*>[^<]*</span>)+', lambda m: m.group(1) + words, t, count=1)

    t = re.sub(r'(<(p|h2|span|a)\b[^>]*data-k="([^"]+)"[^>]*>)(.*?)(</\2>)',
               lambda m: m.group(1) + text_html(content[m.group(3)]) + m.group(5), t, flags=re.S)
    return t


if __name__ == '__main__':
    if sys.argv[1:] == ['--seed']: seed()
    else:
        a = sys.argv[1:] or [ROOT / 'data' / f for f in ('seasons.csv', 'content.csv', 'photos.csv', 'drive-files.csv')]
        build(*a)
