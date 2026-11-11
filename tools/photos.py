"""The photos of the Photos tab, ready for the website.

Each row names a season (Summer, Fall, ...), where the photo goes (Hero: the big photo at the top of the home page,
one per season; Gallery: the photo grid, up to four per season, in the order of the rows), and the photo itself:
the name of a photo in her Drive folder (picked from a list the Sheet keeps up to date), a Google Drive link, or the name
of a photo already on the site. The folder must be viewable by anyone with the link.
Drive photos are downloaded once, turned upright, cropped to the site's shapes around the row's Focus, resized,
saved as WebP without any camera data, and named after their Drive id, so a photo is only fetched again when it changes.

Used by tools/site_sheet.py. Nothing on the site changes when a row is wrong: the reasons are returned instead."""
import io, re, urllib.request
from pathlib import Path
try:  # iPhone photos (HEIC)
    from pillow_heif import register_heif_opener; register_heif_opener()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / 'img'
P_FIELDS = ['Season', 'Place', 'Photo', 'Preview', 'Description', 'Focus']
FOCUS = {'': (0.5, 0.5), 'center': (0.5, 0.5), 'top': (0.5, 0.0), 'bottom': (0.5, 1.0), 'left': (0.0, 0.5), 'right': (1.0, 0.5)}
HERO, TALL, FRAME = (1620, 1080), (1200, 1558), (900, 1125)


def drive_id(link):
    m = re.search(r'(?:/d/|[?&]id=)([-\w]{20,})', link)
    return m.group(1) if m else None


def download(fid):
    for url in (f'https://drive.google.com/uc?export=download&id={fid}', f'https://lh3.googleusercontent.com/d/{fid}=s0'):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read()
        except Exception:
            continue
        if len(data) > 1000 and not data[:200].lstrip().lower().startswith((b'<!doctype', b'<html')):
            return data
    return None


def save(im, size, focus, path):
    from PIL import Image, ImageOps
    import numpy as np
    w, h = size
    if im.width < w or im.height < h:  # a smaller photo is cropped to the same shape at its own size, never blown up
        k = min(im.width / w, im.height / h); w, h = int(w * k), int(h * k)
    out = ImageOps.fit(im, (w, h), Image.LANCZOS, centering=focus)
    Image.fromarray(np.asarray(out.convert('RGB'))).save(path, 'WEBP', quality=80, method=6)  # a fresh image: no camera or location data
    return w, h


def process(rows, kinds, drive=None):
    """rows: dicts with the P_FIELDS; drive: {file name: Drive id} of the photos folder (the Sheet's Drive files tab). Returns (heroes {kind: dict}, gallery {kind: [dict]}, problems, files kept)."""
    from PIL import Image, ImageOps
    heroes, gallery, problems, keep = {}, {}, [], set()
    for n, r in enumerate(rows, 2):
        at = f'Photos row {n}'
        if not r.get('Photo', '').strip(): continue  # a row without a photo (not filled in yet, or the photo taken out) shows nothing
        kind = r.get('Season', '').title()
        place = r.get('Place', '').title()
        photo = r.get('Photo', '').strip()
        focus = r.get('Focus', '').strip().lower()
        if kind not in kinds: problems.append(f'{at}: Season must be one of {", ".join(kinds)}'); continue
        if place not in ('Hero', 'Gallery'): problems.append(f'{at}: Place must be Hero or Gallery'); continue
        if focus not in FOCUS: problems.append(f'{at}: Focus must be empty or one of Center, Top, Bottom, Left, Right'); continue
        if place == 'Hero' and kind in heroes: problems.append(f'{at}: {kind} already has a Hero photo (one per season)'); continue
        if place == 'Gallery' and len(gallery.get(kind, [])) >= 4: problems.append(f'{at}: {kind} already has four Gallery photos'); continue
        alt = r.get('Description', '').strip()
        if not alt: problems.append(f'{at}: Description is empty (it is read aloud to blind visitors and shown if the photo cannot load)'); continue
        # a Drive link, a photo the site already has (her photos from before keep their exact files), or a file name from the Drive folder
        fid = drive_id(photo) if photo.startswith('http') else None
        if photo.startswith('http') and not fid: problems.append(f'{at}: this is not a Google Drive file link'); continue
        if not fid and not (IMG / photo).exists():
            fid = (drive or {}).get(photo)
            if not fid: problems.append(f'{at}: there is no photo called {photo} in the Drive folder'); continue
        if fid:
            tag = f'd-{fid[:12]}' + (f'-{focus}' if focus not in ('', 'center') else '')
            names = [f'hero-{tag}.webp', f'hero-{tag}-tall.webp'] if place == 'Hero' else [f'room-{tag}.webp']
            if not all((IMG / x).exists() for x in names):
                data = download(fid)
                if data is None: problems.append(f'{at}: the photo could not be downloaded. Is it shared "Anyone with the link"?'); continue
                try:
                    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
                except Exception:
                    problems.append(f'{at}: the file is not a photo (JPG, PNG, HEIC or WebP)'); continue
                if im.width < 700 or im.height < 700: problems.append(f'{at}: the photo is too small ({im.width}x{im.height}); send one at least 1200 px wide'); continue
                if place == 'Hero':
                    save(im, HERO, FOCUS[focus], IMG / names[0]); save(im, TALL, FOCUS[focus], IMG / names[1])
                else:
                    save(im, FRAME, FOCUS[focus], IMG / names[0])
        else:
            names = [photo] + ([photo.replace('.webp', '-tall.webp')] if place == 'Hero' else [])
        keep.update(x for x in names if (IMG / x).exists())
        w, h = Image.open(IMG / names[0]).size
        item = {'src': names[0], 'alt': alt, 'w': w, 'h': h}
        if place == 'Hero':
            if len(names) > 1 and (IMG / names[1]).exists(): item['tall'] = names[1]
            heroes[kind] = item
        else:
            gallery.setdefault(kind, []).append(item)
    return heroes, gallery, problems, keep


def tidy(keep):
    """Removes Drive photos that no row uses any more."""
    for p in list(IMG.glob('hero-d-*.webp')) + list(IMG.glob('room-d-*.webp')):
        if p.name not in keep: p.unlink()
