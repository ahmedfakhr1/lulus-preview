"""Copies the Google Sheet into the site. The menu comes from the Sheet or from her two PDFs in Google Drive, as the Settings
tab says: the Menu tab into data/menu-sheet.csv (and the menu pages are redrawn from it), or the PDFs into menu-source/;
the Seasons, Content and Photos tabs into data/seasons.csv, data/content.csv and data/photos.csv (and the pages take them,
with new Drive photos downloaded and prepared).
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
# where the menu comes from: the Settings tab says Sheet (her words and prices on the PDF pages) or PDF (her two PDFs in Drive)
settings = {}
try:
    srows = read(tab('settings', 'Settings'))
    if srows and 'Setting' in srows[0] and 'Value' in srows[0]:  # an unknown tab name gives back the first tab: ignored
        settings = {(r['Setting'] or '').strip().lower(): (r['Value'] or '').strip() for r in srows}
except Exception as e:
    failed.append(f'Settings tab not read: {e}')
source = settings.get('menu comes from', 'Sheet').lower()
# the files in her Drive folder, listed in the Sheet by its Apps Script (name and Drive id of each photo and PDF)
DRIVE_FIELDS = ['Photo', 'Photo ID', 'PDF', 'PDF ID']
drive_rows = []
try:
    drows = read(tab('drive', 'Drive files'))
    if drows and all(f in drows[0] for f in DRIVE_FIELDS): drive_rows = drows
except Exception as e:
    failed.append(f'Drive files tab not read: {e}')
pdf_ids = {(r['PDF'] or '').strip(): (r['PDF ID'] or '').strip() for r in drive_rows if (r['PDF'] or '').strip()}


def menu_from_pdfs():
    import photos, shutil, tempfile
    links = {'morning': settings.get('morning menu pdf', ''), 'evening': settings.get('evening menu pdf', '')}
    new = {}
    for svc, link in links.items():
        fid = photos.drive_id(link) if link.startswith('http') else pdf_ids.get(link)
        if not fid: raise ValueError(f'the {svc.title()} menu PDF in the Settings tab must be a PDF from the Drive folder')
        data = photos.download(fid)
        if not data or not data.startswith(b'%PDF'): raise ValueError(f'the {svc.title()} menu PDF could not be downloaded as a PDF. Is it shared "Anyone with the link"?')
        new[svc] = data
    src = ROOT / 'menu-source'
    if all((src / f'{svc}.pdf').exists() and (src / f'{svc}.pdf').read_bytes() == data for svc, data in new.items()):
        print('Menu PDFs unchanged.'); return
    # keep the current menu, so a PDF the book cannot read changes nothing
    keep = Path(tempfile.mkdtemp())
    saved = [src / 'morning.pdf', src / 'evening.pdf', ROOT / 'js' / 'menu-pdf.js', ROOT / 'data' / 'menu-layout.json', ROOT / 'data' / 'menu-sheet.csv']
    for f in saved:
        if f.exists(): shutil.copy2(f, keep / f.name)
    if (ROOT / 'img' / 'menu-pdf').exists(): shutil.copytree(ROOT / 'img' / 'menu-pdf', keep / 'menu-pdf')
    for svc, data in new.items(): (src / f'{svc}.pdf').write_bytes(data)
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'pdf_book.py')])
    if r.returncode:
        for f in saved:
            if (keep / f.name).exists(): shutil.copy2(keep / f.name, f)
        shutil.rmtree(ROOT / 'img' / 'menu-pdf', ignore_errors=True); shutil.rmtree(ROOT / 'img' / 'menu-pdf.new', ignore_errors=True)
        if (keep / 'menu-pdf').exists(): shutil.copytree(keep / 'menu-pdf', ROOT / 'img' / 'menu-pdf')
        raise ValueError('the new PDFs were not used, see above')
    print('Menu updated from the PDFs.')


def menu_from_sheet():
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


try:
    if source == 'pdf': menu_from_pdfs()
    elif source == 'sheet': menu_from_sheet()
    else: raise ValueError('"Menu comes from" in the Settings tab must be Sheet or PDF')
except Exception as e:
    failed.append(f'Menu not updated: {e}')

# the seasons and the page words
try:
    import site_sheet
    parts = []
    for k, d, fields, file in (('seasons', 'Seasons', site_sheet.S_FIELDS, 'seasons.csv'), ('content', 'Content', site_sheet.C_FIELDS, 'content.csv'),
                               ('photos', 'Photos', site_sheet.ph.P_FIELDS, 'photos.csv')):
        name = tab(k, d)
        rows = [{(k2 or '').strip(): v for k2, v in r.items()} for r in read(name)]
        if not rows or any(f not in rows[0] for f in fields if f not in ('Where', 'Preview', 'Focus')):
            raise ValueError(f'the {name} tab must have the columns {", ".join(fields)} in its first row')
        tmp = ROOT / 'data' / file.replace('.csv', '.new.csv')
        write(tmp, fields, rows); parts.append((tmp, ROOT / 'data' / file))
    dtmp = ROOT / 'data' / 'drive-files.new.csv'
    write(dtmp, DRIVE_FIELDS, drive_rows); parts.append((dtmp, ROOT / 'data' / 'drive-files.csv'))
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'site_sheet.py')] + [str(t) for t, _ in parts])
    if r.returncode:
        for t, _ in parts: t.unlink()
        raise ValueError('see above')
    for t, f in parts: t.replace(f)
except Exception as e:
    failed.append(f'Seasons, page words and photos not updated: {e}')

if failed: sys.exit('\n'.join(failed))
