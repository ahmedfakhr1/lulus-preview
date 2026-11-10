/**
 * One row per week in the "Visits" tab: visits, QR scans, taps and phones, from the site's own counter
 * (src/worker.js, Cloudflare Workers Analytics Engine; no cookies, no IP addresses).
 * Paste into the Sheet: Extensions > Apps Script. In Project settings > Script properties add:
 *   CF_API_TOKEN   a Cloudflare API token with "Account Analytics: Read"
 *   CF_ACCOUNT_ID  the Cloudflare account ID (right side of the account home page)
 * Run setup() once: it asks for permission, adds the header row and a schedule for Sunday 01:00 Cairo time.
 * Weeks run Sunday to Saturday (Cairo time) and are labelled with the Saturday. A week that already has a row is skipped.
 */
var TAB = 'Visits';
var HEADER = ['Week (Sun–Sat), ending', 'Page views', 'Home', 'Menu', 'QR scans (tables)', 'Morning menu', 'Evening menu',
  'Reserve taps', 'Bookings sent to WhatsApp', 'Calls', 'Directions', 'Instagram / TikTok', 'App links', 'Page zooms',
  'From phones', 'iPhone', 'Android', 'Top phones', 'Top cities', 'Top sources'];

function setup() {
  var sh = sheet_();
  if (sh.getLastRow() === 0) sh.appendRow(HEADER);
  sh.setFrozenRows(1);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'updateVisits') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('updateVisits').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(1).inTimezone('Africa/Cairo').create();
  updateVisits();
}

function updateVisits() {
  // the week that closed at the last Sunday 00:00, Cairo time
  var tz = 'Africa/Cairo', now = new Date();
  var dow = Number(Utilities.formatDate(now, tz, 'u')) % 7;                        // Sunday = 0
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var end = new Date(Utilities.parseDate(today + ' 00:00', tz, 'yyyy-MM-dd HH:mm').getTime() - dow * 864e5);
  var start = new Date(end.getTime() - 7 * 864e5);
  var label = Utilities.formatDate(new Date(end.getTime() - 864e5), tz, 'yyyy-MM-dd');
  var sh = sheet_();
  var done = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(function (r) { return r[0]; }) : [];
  if (done.indexOf(label) >= 0) return;

  var w = "timestamp >= toDateTime('" + iso_(start) + "') AND timestamp < toDateTime('" + iso_(end) + "')";
  var ev = rows_('SELECT blob1 AS e, blob3 AS p, blob4 AS mood, SUM(_sample_interval) AS n FROM lulus_hits WHERE ' + w + ' GROUP BY e, p, mood');
  var n = function (f) { return ev.filter(f).reduce(function (a, r) { return a + Number(r.n); }, 0); };
  var views = n(function (r) { return r.e === 'view'; });
  var dev = rows_("SELECT blob6 AS type, blob7 AS os, SUM(_sample_interval) AS n FROM lulus_hits WHERE " + w + " AND blob1 = 'view' GROUP BY type, os");
  var dn = function (f) { return dev.filter(f).reduce(function (a, r) { return a + Number(r.n); }, 0); };
  var pct = function (x) { return views ? Math.round(x * 100 / views) + '%' : ''; };
  var top = function (col, extra) {
    return rows_('SELECT ' + col + " AS k, SUM(_sample_interval) AS n FROM lulus_hits WHERE " + w + " AND blob1 = 'view'" + (extra || '') +
      ' GROUP BY k ORDER BY n DESC LIMIT 3').map(function (r) { return (r.k || '(direct / QR)') + ' ' + r.n; }).join(', ');
  };
  sh.appendRow([label, views,
    n(function (r) { return r.e === 'view' && r.p === 'home'; }), n(function (r) { return r.e === 'view' && r.p === 'menu'; }),
    n(function (r) { return r.e === 'view' && r.p === 'qr'; }),
    n(function (r) { return r.e === 'view' && r.p !== 'home' && r.mood === 'morning'; }), n(function (r) { return r.e === 'view' && r.p !== 'home' && r.mood === 'evening'; }),
    n(function (r) { return r.e === 'reserve'; }), n(function (r) { return r.e === 'booking_sent'; }),
    n(function (r) { return r.e === 'phone'; }), n(function (r) { return r.e === 'maps'; }),
    n(function (r) { return r.e === 'instagram' || r.e === 'tiktok' || r.e === 'cannes'; }),
    n(function (r) { return r.e === 'appStore' || r.e === 'playStore'; }), n(function (r) { return r.e === 'zoom'; }),
    pct(dn(function (r) { return r.type !== 'desktop'; })), pct(dn(function (r) { return r.os === 'iOS'; })), pct(dn(function (r) { return r.os === 'Android'; })),
    top('blob9', " AND blob9 != ''"), top('blob11', " AND blob11 != ''"), top('blob12')]);
}

function rows_(sql) {
  var p = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch('https://api.cloudflare.com/client/v4/accounts/' + p.getProperty('CF_ACCOUNT_ID') + '/analytics_engine/sql', {
    method: 'post', contentType: 'text/plain', muteHttpExceptions: true, payload: sql + ' FORMAT JSON',
    headers: { Authorization: 'Bearer ' + p.getProperty('CF_API_TOKEN') }
  });
  if (res.getResponseCode() !== 200) throw new Error('Cloudflare: ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText()).data || [];
}

function iso_(d) { return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd HH:mm:ss'); }

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(TAB) || ss.insertSheet(TAB);
}
