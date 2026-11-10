/* The site's Worker. Pages, scripts and photos are served straight from dist/ (wrangler.jsonc).
   Only /api/hit runs here: it records one row per visit or tap in Workers Analytics Engine (free, no cookies,
   no IP address kept): what happened, on which page, Morning/Evening, season, phone type, system, browser,
   country, city and where the visitor came from. tools/apps-script/visits.gs reads it once a week into the Sheet. */
const EVENTS = new Set(['view', 'reserve', 'booking_sent', 'phone', 'maps', 'whatsapp', 'instagram', 'tiktok', 'cannes',
  'appStore', 'playStore', 'credit', 'switch', 'zoom', 'depth']);
const clip = (v, n = 40) => String(v || '').slice(0, n);

function device(ua) {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const type = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'phone' : 'desktop';
  const browser = /Instagram/.test(ua) ? 'Instagram' : /FBAN|FBAV/.test(ua) ? 'Facebook' : /TikTok|musical_ly/.test(ua) ? 'TikTok'
    : /SamsungBrowser/.test(ua) ? 'Samsung' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const model = (ua.match(/iPhone|iPad|SM-[A-Z]\d+|Pixel \d+[a-z ]*|Redmi[^;)]*|OPPO[^;)]*|vivo[^;)]*|HUAWEI[^;)]*|Infinix[^;)]*|realme[^;)]*/) || [''])[0].trim();
  return { os, type, browser, model };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/hit' && request.method === 'POST') {
      try {
        const body = JSON.parse(await request.text());
        const e = clip(body.e, 20);
        if (!EVENTS.has(e)) return new Response(null, { status: 204 });
        const ua = request.headers.get('user-agent') || '';
        if (/bot|crawl|spider|preview|lighthouse/i.test(ua)) return new Response(null, { status: 204 });
        const d = device(ua), cf = request.cf || {};
        env.HITS && env.HITS.writeDataPoint({
          // blob1..blob13, read by visits.gs in this order
          blobs: [e, clip(body.d), clip(body.p, 10), clip(body.mood, 10), clip(body.season, 20), d.type, d.os, d.browser, d.model,
            clip(cf.country, 4), clip(cf.city), clip(body.ref, 60), clip(cf.region)],
          doubles: [1],
          indexes: [e],
        });
      } catch (err) { /* a bad message is ignored */ }
      return new Response(null, { status: 204 });
    }
    return env.ASSETS.fetch(request);
  },
};
