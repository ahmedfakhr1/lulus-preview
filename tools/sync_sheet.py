"""Copies the Menu tab of the Google Sheet into data/menu-sheet.csv and redraws the menu pages from it.
Run by the "Publish menu" GitHub Action. Nothing changes when the Sheet cannot be read or a row does not fit:
the reason is printed and the site keeps the last good menu.
Usage: python3 tools/sync_sheet.py"""
import csv, io, re, subprocess, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
cfg = (ROOT / 'config' / 'site.config.js').read_text()
m = re.search(r"sheet:\s*\{\s*id:\s*'([^']*)'(?:.*?menu:\s*'([^']*)')?", cfg, re.S)
sheet_id, tab = (m.group(1), m.group(2) or 'Menu') if m else ('', 'Menu')
if not sheet_id: sys.exit('config/site.config.js has no sheet id yet.')
url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(tab)}'
try:
    body = urllib.request.urlopen(url, timeout=30).read().decode('utf-8')
except Exception as e:
    sys.exit(f'Could not read the Sheet ({e}). Is it shared "Anyone with the link: Viewer"?')
rows = list(csv.DictReader(io.StringIO(body)))
need = ['id', 'name', 'description', 'price', 'note']
if not rows or any(k not in rows[0] for k in need):
    sys.exit(f'The {tab} tab must have the columns {", ".join(need)} in its first row.')
old = list(csv.DictReader((ROOT / 'data' / 'menu-sheet.csv').open()))
if len(rows) < len(old) * 0.9: sys.exit(f'The {tab} tab has {len(rows)} rows, the menu has {len(old)}. Rows must not be deleted.')
tmp = ROOT / 'data' / 'menu-sheet.new.csv'
with tmp.open('w', newline='') as fh:
    w = csv.DictWriter(fh, list(old[0].keys()), extrasaction='ignore'); w.writeheader()
    for r in rows: w.writerow({k: (r.get(k) or '').strip() for k in old[0].keys()})
r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'menu_sheet.py'), str(tmp)])
if r.returncode: tmp.unlink(); sys.exit(1)
tmp.replace(ROOT / 'data' / 'menu-sheet.csv')
print('Menu updated from the Sheet.')
