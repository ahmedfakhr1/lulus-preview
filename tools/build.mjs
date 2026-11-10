// Builds the deployable site into dist/. Cloudflare runs this on every deploy (see wrangler.jsonc).
// Copies the site, then fills in everything that comes from config/site.config.js: every link marked
// data-cfg="…", the canonical and social-preview addresses, the search-engine data, robots.txt, sitemap.xml,
// humans.txt, the menu QR code and the visit counter. Last, every local script and style link gets a ?v= code
// made from the file's content, so browsers can keep them for a year (see _headers) and still see every change.
// Usage: node tools/build.mjs   (SITE_URL=… overrides siteUrl for one build)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const SKIP = new Set(['.git', '.github', '.gitignore', '.wrangler', 'node_modules', 'dist', 'tools', 'wrangler.jsonc',
  'README.md', 'package.json', 'package-lock.json', 'menu-source', 'data']);

fs.rmSync(OUT, { recursive: true, force: true });
for (const name of fs.readdirSync(ROOT)) if (!SKIP.has(name)) fs.cpSync(path.join(ROOT, name), path.join(OUT, name), { recursive: true });

const read = (f) => fs.readFileSync(path.join(OUT, f), 'utf8');
const write = (f, body) => fs.writeFileSync(path.join(OUT, f), body);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const ctx = { window: {} };
vm.runInNewContext(read('config/site.config.js'), ctx);
const cfg = ctx.window.SITE_CONFIG;
if (!cfg) throw new Error('config/site.config.js does not define window.SITE_CONFIG.');
const site = String(process.env.SITE_URL || cfg.siteUrl || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/\s]+(\/[^\s]*)?$/.test(site)) throw new Error(`siteUrl "${cfg.siteUrl}" must look like https://example.com`);
const c = cfg.contact || {}, credit = cfg.credit || {}, hours = cfg.hours || {};
for (const k of ['phone', 'whatsapp', 'maps', 'instagram']) if (!c[k]) throw new Error(`config contact.${k} is empty.`);
if (!/^\d{8,15}$/.test(c.whatsapp)) throw new Error('config contact.whatsapp must be digits only, country code first.');
if (!credit.name || !/^https?:\/\//.test(credit.url || '')) throw new Error('config credit needs a name and an https:// url.');

// what each data-cfg link points to
const LINKS = {
  reserve: `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(c.reserveText || '')}`,
  whatsapp: `https://wa.me/${c.whatsapp}`,
  phone: `tel:${c.phone.replace(/[^\d+]/g, '')}`,
  maps: c.maps, instagram: c.instagram, tiktok: c.tiktok, cannes: c.cannes,
  appStore: c.appStore, playStore: c.playStore, credit: credit.url,
};

// page file -> its address on the site (the Worker serves menu.html at /menu)
const PAGES = [
  { file: 'index.html', url: site + '/' },
  { file: 'menu.html', url: site + '/menu' },
];

function swap(html, file, re, to, what) {
  if (!re.test(html)) throw new Error(`${file}: could not find ${what}.`);
  return html.replace(re, to);
}

for (const p of PAGES) {
  let html = read(p.file);
  const img = `${site}/img/og.jpg`;
  html = html.replace(/<a\b([^>]*?)href="[^"]*"([^>]*?)data-cfg="(\w+)"/g, (m, a, b, key) => {
    if (!(key in LINKS)) throw new Error(`${p.file}: unknown data-cfg="${key}".`);
    if (!LINKS[key]) throw new Error(`${p.file}: config has no value for "${key}".`);
    return `<a${a}href="${esc(LINKS[key])}"${b}data-cfg="${key}"`;
  });
  html = html.replace(/ data-wa="[^"]*"/, ` data-wa="${c.whatsapp}"`);
  if (c.appStore) html = html.replace(/ data-appstore="[^"]*"/, ` data-appstore="${esc(c.appStore)}"`);
  if (c.playStore) html = html.replace(/ data-play="[^"]*"/, ` data-play="${esc(c.playStore)}"`);
  html = swap(html, p.file, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${p.url}">`, 'the canonical link');
  html = swap(html, p.file, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${p.url}">`, 'og:url');
  html = swap(html, p.file, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${img}">`, 'og:image');
  html = swap(html, p.file, /<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${img}">`, 'twitter:image');
  html = swap(html, p.file, /<meta name="author" content="[^"]*">/, `<meta name="author" content="${esc(credit.name)}">`, 'the author meta tag');
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (m, json) => {
    const d = JSON.parse(json);
    if (d['@type'] === 'Restaurant') {
      d.url = site + '/'; d.image = `${site}/img/og.jpg`; d.hasMenu = site + '/menu';
      d.telephone = LINKS.phone.slice(4);
      d.sameAs = [c.instagram, c.tiktok, c.cannes].filter(Boolean);
      for (const o of d.openingHoursSpecification || []) { if (hours.open) o.opens = hours.open; if (hours.close) o.closes = hours.close; }
    }
    return `<script type="application/ld+json">${JSON.stringify(d)}</script>`;
  });
  write(p.file, html);
}

write('404.html', read('404.html').replace(/<meta name="author" content="[^"]*">/, `<meta name="author" content="${esc(credit.name)}">`));

write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + PAGES.map((p) => `  <url><loc>${p.url}</loc></url>\n`).join('') + `</urlset>\n`);
write('humans.txt', `/* TEAM */\nWebsite: ${credit.name}\nSite: ${credit.url}\n\n/* SITE */\nAddress: ${site}/\nLanguage: English\n`);

// /m is the address on the table QR codes: the same menu page under its own name, so scans are counted apart
write('m.html', read('menu.html').replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${site}/menu">`));

// the table QR code: crisp squares, her brown on white, a 4-module quiet zone, her Ü in the middle (level H)
{
  const qrcode = createRequire(import.meta.url)('./vendor/qrcode-generator.cjs');
  const qr = qrcode(0, 'H'); qr.addData(site + '/m'); qr.make();
  const n = qr.getModuleCount(), q = 4, size = n + q * 2;
  const icon = read('img/icon-fall.svg');
  const mark = icon.match(/<path [^>]*\/>/)[0].replace(/fill="[^"]*"/, 'fill="#592302"').replace(/stroke="[^"]*"/, 'stroke="#592302"');
  const plate = Math.ceil(n * 0.24) | 1, p0 = (size - plate) / 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    const x = col + q, y = r + q;
    if (x >= p0 - 0.5 && x < p0 + plate + 0.5 && y >= p0 - 0.5 && y < p0 + plate + 0.5) continue;
    if (qr.isDark(r, col)) d += `M${x} ${y}h1v1h-1z`;
  }
  fs.mkdirSync(path.join(OUT, 'img/qr'), { recursive: true });
  write('img/qr/menu-qr.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#FFFFFF"/>`
    + `<path fill="#592302" shape-rendering="crispEdges" d="${d}"/>`
    + `<svg x="${p0}" y="${p0}" width="${plate}" height="${plate}" viewBox="0 0 100 100">${mark}</svg></svg>\n`);
}

// visitor counting: the Cloudflare Web Analytics beacon on every page, only when a token is set
const cfToken = String((cfg.analytics || {}).cloudflareToken || '').trim();
const pagesOut = ['index.html', 'menu.html', 'm.html', '404.html'];
if (cfToken) {
  const beacon = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: cfToken })}'></script>`;
  for (const f of pagesOut) write(f, read(f).replace('</body>', beacon + '</body>'));
}

// content codes on every local .js/.css link and on the QR image
{
  const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);
  const qv = hash(path.join(OUT, 'img/qr/menu-qr.svg'));
  for (const f of pagesOut) {
    const html = read(f).replace(/menu-qr\.svg(?=['"])/g, `menu-qr.svg?v=${qv}`)
      .replace(/(\s(?:src|href)=")([^":#?]+\.(?:js|css))(?:\?v=[^"]*)?"/g, (m, pre, ref) => {
        const target = path.join(OUT, ref.replace(/^\//, ''));
        return fs.existsSync(target) ? `${pre}${ref}?v=${hash(target)}"` : m;
      });
    write(f, html);
  }
}
console.log(`Built dist/ for ${site}/`);
