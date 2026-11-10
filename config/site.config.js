/* The one place for site-wide settings. Read by the browser and by tools/build.mjs.
   Change a value here and push: the next deploy fills it in on every page, the sitemap, robots.txt and the QR code. */
window.SITE_CONFIG = {
  // Public address of the site, no trailing slash. Placeholder until the Worker or the domain is live.
  siteUrl: 'https://lulus.workers.dev',

  // The Google Sheet staff edit: the Menu tab (words and prices on her menu pages). Share it "Anyone with the link: Viewer".
  sheet: { id: '1qMwnRKBo9ORgpeMHTR9n0tCyKOelcgHmOjswjqdq0hU', tabs: { menu: 'Menu' } },

  contact: {
    phone: '+201210514222',          // for "Call us", written with country code
    whatsapp: '201210514222',        // digits only, country code first
    reserveText: 'Hello LÜLU’S, I’d like to reserve a table.',
    maps: 'https://www.google.com/maps/place/L%C3%9CLU%27S,+New+Cairo+1,+Cairo+Governorate+4728114/@30.0164839,31.5138554,16z/data=!4m6!3m5!1s0x1458231ab4cf764d:0xe33f4bff6f3d0d4a!8m2!3d30.0164839!4d31.5138554!16s%2Fg%2F11msj5gp8h',
    instagram: 'https://www.instagram.com/lulusinmotion/',
    tiktok: 'https://www.tiktok.com/@lulusinmotion',
    cannes: 'https://www.instagram.com/bijouxbylulus/',
    appStore: 'https://apps.apple.com/app/id6757676939',
    playStore: 'https://play.google.com/store/apps/details?id=com.seamlabs.lulus'
  },

  // Opening hours, 24-hour clock, Cairo time. A closing time earlier than the opening time means after midnight.
  hours: { open: '09:00', close: '00:00' },

  // Visitor counting (Cloudflare Web Analytics, free, no cookies). Paste the token from the Web Analytics snippet;
  // empty turns counting off. Table QR codes open /m, a copy of the menu, so scans are counted apart.
  analytics: { cloudflareToken: '' },

  // Footer credit and page author.
  credit: { name: 'Ahmed Fakhreldin', url: 'https://ahmedfakhr1.github.io/' }
};
