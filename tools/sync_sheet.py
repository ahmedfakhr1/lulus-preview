"""Copies the Google Sheet into the site: the Menu tab into data/menu-sheet.csv (and the menu pages are redrawn from it),
the Seasons and Content tabs into data/seasons.csv and data/content.csv (and the home page and menu page take them).
Run by the "Publish menu" GitHub Action. Each part changes nothing when the Sheet cannot be read or a row is wrong:
the reason is printed and the site keeps its last good version of that part.
Usage: python3 tools/sync_sheet.py"""
import csv, io, re, subprocess, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
cfg = (ROOT / 'config' / 'site.config.js').read_text()
m = re.search(r"sheet:\s*\{\s*id:\s*'([^']*)'", cfg)
sheet_id = m.group(1) if m else ''
if not sheet_id: sys.exit('config/site.config.js has no sheet id yet.')
tabs = dict(re.findall(r"(\w+):\s*'([^']*)'", (re.search(r'tabs:\s*\{([^}]*)\}', cfg) or [None, ''])[1]))
tab = lambda k, d: tabs.get(k) or d
sys.path.insert(0, str(ROOT / 'tools'))


def read(name):
    url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(name)}'
    body = urllib.request.urlopen(url, timeout=30).read().decode('utf-8')
    return list(csv.DictReader(io.StringIO(body)))


def write(path, fields, rows, key=lambda k: k):
    with path.open('w', newline='') as fh:
        w = csv.DictWriter(fh, fields, extrasaction='ignore'); w.writeheader()
        for r in rows: w.writerow({k: (r.get(key(k)) or '').strip() for k in fields})


failed = []
# the menu
try:
    name = tab('menu', 'Menu')
    rows = [{(k or '').strip().lower(): v for k, v in r.items()} for r in read(name)]
    need = ['id', 'name', 'description', 'price', 'note']
    old = list(csv.DictReader((ROOT / 'data' / 'menu-sheet.csv').open()))
    if not rows or any(k not in rows[0] for k in need): raise ValueError(f'the {name} tab must have the columns {", ".join(need)} in its first row')
    if len(rows) < len(old) * 0.9: raise ValueError(f'the {name} tab has {len(rows)} rows, the menu has {len(old)}. Rows must not be deleted')
    tmp = ROOT / 'data' / 'menu-sheet.new.csv'
    write(tmp, list(old[0].keys()), rows)
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'menu_sheet.py'), str(tmp)])
    if r.returncode: tmp.unlink(); raise ValueError('see above')
    tmp.replace(ROOT / 'data' / 'menu-sheet.csv')
    print('Menu updated from the Sheet.')
except Exception as e:
    failed.append(f'Menu not updated: {e}')

# the seasons and the page words
try:
    import site_sheet
    parts = []
    for k, d, fields, file in (('seasons', 'Seasons', site_sheet.S_FIELDS, 'seasons.csv'), ('content', 'Content', site_sheet.C_FIELDS, 'content.csv')):
        name = tab(k, d)
        rows = [{(k2 or '').strip(): v for k2, v in r.items()} for r in read(name)]
        if not rows or any(f not in rows[0] for f in fields if f != 'Where'):
            raise ValueError(f'the {name} tab must have the columns {", ".join(fields)} in its first row')
        tmp = ROOT / 'data' / file.replace('.csv', '.new.csv')
        write(tmp, fields, rows); parts.append((tmp, ROOT / 'data' / file))
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'site_sheet.py')] + [str(t) for t, _ in parts])
    if r.returncode:
        for t, _ in parts: t.unlink()
        raise ValueError('see above')
    for t, f in parts: t.replace(f)
except Exception as e:
    failed.append(f'Seasons and page words not updated: {e}')

if failed: sys.exit('\n'.join(failed))
