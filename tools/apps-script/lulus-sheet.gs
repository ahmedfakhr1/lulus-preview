/**
 * The LÜLU’S website Sheet script. Paste this whole file into the Sheet (Extensions > Apps Script, replace everything, Save),
 * reload the Sheet, then use the "LÜLU’S website" menu > Set up. It lives inside the Sheet, so it moves with it when the
 * Sheet changes owner; the new owner runs Set up once and the old owner's automatic updates switch themselves off.
 *
 * What it does:
 * - An edit in the Menu, Seasons, Content, Photos or Settings tab goes on the website about a minute later, by starting the
 *   repository's "Publish menu" GitHub Action. Edits made close together go out as one update.
 * - Every 10 minutes it lists the photos and PDFs of her Drive folder in the Drive files tab, which feeds the Photo dropdown
 *   of the Photos tab and the PDF dropdowns of the Settings tab. A photo or PDF in use that is replaced by a newer file with
 *   the same name is published too.
 * - Once Cloudflare keys are set, one row per week in the Visits tab (visits, QR scans, taps, phones), Sunday 01:00 Cairo.
 *
 * Set up asks for (and keeps in this script's properties, never in the Sheet):
 *   GITHUB_TOKEN   a fine-grained GitHub token for the website repository only: "Actions: Read and write", "Contents: Read"
 *   GITHUB_REPO    owner/name of the website repository
 *   GITHUB_BRANCH  the branch the website is published from
 *   CF_API_TOKEN, CF_ACCOUNT_ID  optional: a Cloudflare token with "Account Analytics: Read" and the account ID
 * The Drive folder is FILES_FOLDER_ID below; its id stays the same when it changes owner.
 */
var DEFAULTS = {
  GITHUB_REPO: 'ahmedfakhr1/lulus-preview',
  GITHUB_BRANCH: 'production',
  FILES_FOLDER_ID: '1oGMG81CJUdQMmJO4E2HZcwgvRRa3AoV8'
};
var WATCHED = ['Menu', 'Seasons', 'Content', 'Photos', 'Settings'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('LÜLU’S website')
    .addItem('Publish now', 'publishMenu')
    .addItem('Refresh the photo and PDF lists', 'refreshFiles')
    .addItem('Copy the PDF menu’s words into the Menu tab', 'loadMenuFromSite')
    .addSeparator()
    .addItem('Set up (once per owner)', 'setUp')
    .addToUi();
}

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || DEFAULTS[k] || ''; }
function me_() { return Session.getEffectiveUser().getEmail(); }

/* Asks for the keys, then starts the automatic updates under the account that runs it. */
function setUp() {
  var ui = SpreadsheetApp.getUi(), p = PropertiesService.getScriptProperties();
  var ask = [
    ['GITHUB_TOKEN', 'GitHub key for the website repository (Actions: Read and write, Contents: Read).', true],
    ['GITHUB_REPO', 'GitHub repository, as owner/name.', false],
    ['GITHUB_BRANCH', 'Branch the website is published from.', false],
    ['CF_API_TOKEN', 'Optional: Cloudflare key for the weekly Visits tab (Account Analytics: Read).', true],
    ['CF_ACCOUNT_ID', 'Optional: Cloudflare account ID.', false]
  ];
  for (var i = 0; i < ask.length; i++) {
    var k = ask[i][0], now = prop_(k);
    var shown = now ? (ask[i][2] ? 'set (hidden)' : now) : 'not set';
    var r = ui.prompt('Set up ' + (i + 1) + ' of ' + ask.length, ask[i][1] + '\n\nNow: ' + shown + '\nLeave empty to keep it.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = r.getResponseText().trim();
    if (v) p.setProperty(k, v); else if (!p.getProperty(k) && DEFAULTS[k]) p.setProperty(k, DEFAULTS[k]);
  }
  if (!p.getProperty('FILES_FOLDER_ID')) p.setProperty('FILES_FOLDER_ID', DEFAULTS.FILES_FOLDER_ID);
  // this account now runs the updates; the triggers of a previous owner remove themselves the next time they fire
  p.setProperty('OWNER', me_());
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('refreshFiles').timeBased().everyMinutes(10).create();
  var visits = !!(p.getProperty('CF_API_TOKEN') && p.getProperty('CF_ACCOUNT_ID'));
  if (visits) ScriptApp.newTrigger('updateVisits').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(1).inTimezone('Africa/Cairo').create();
  refreshFiles();
  var gh = UrlFetchApp.fetch('https://api.github.com/repos/' + prop_('GITHUB_REPO'), { muteHttpExceptions: true, headers: gitHeaders_() });
  ui.alert('Set up done for ' + me_() + '.\n\nGitHub: ' + (gh.getResponseCode() === 200 ? 'connected to ' + prop_('GITHUB_REPO') : 'NOT connected (' + gh.getResponseCode() + '). Check the key and the repository, then run Set up again.') +
    '\nPhoto and PDF lists: updated.\nWeekly visits: ' + (visits ? 'on.' : 'off until the Cloudflare keys are added.'));
}

/* A trigger left by a previous owner: switches itself off. */
function stale_() {
  var owner = PropertiesService.getScriptProperties().getProperty('OWNER');
  if (!owner || owner === me_()) return false;
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return true;
}

function gitHeaders_() { return { Authorization: 'Bearer ' + prop_('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' }; }

/* ---------------------------------------------------------------- publishing */
function onSheetEdit(e) {
  if (stale_()) return;
  if (e && e.range && WATCHED.indexOf(e.range.getSheet().getName()) < 0) return;
  // one publish a minute after the last edit, not one per cell
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'publishMenu') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('publishMenu').timeBased().after(60 * 1000).create();
}

function publishMenu() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'publishMenu') ScriptApp.deleteTrigger(t); });
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + prop_('GITHUB_REPO') + '/actions/workflows/publish-menu.yml/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: gitHeaders_(),
    payload: JSON.stringify({ ref: prop_('GITHUB_BRANCH') || 'main' })
  });
  if (res.getResponseCode() >= 300) throw new Error('GitHub: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
}

/* ---------------------------------------------------------------- Drive folder lists */
/* Lists the photos and PDFs of her Drive folder (newest first; a name used twice keeps its newest file) in the Drive files tab,
   and points the Photo and PDF dropdowns at that list. */
function refreshFiles() {
  if (stale_()) return;
  var ss = SpreadsheetApp.getActive(), p = PropertiesService.getScriptProperties();
  var it = DriveApp.getFolderById(prop_('FILES_FOLDER_ID')).getFiles(), photos = [], pdfs = [];
  while (it.hasNext()) {
    var f = it.next(), t = f.getMimeType(), row = [f.getName(), f.getId(), f.getUrl(), f.getLastUpdated().getTime()];
    if (t.indexOf('image/') === 0) photos.push(row); else if (t === 'application/pdf') pdfs.push(row);
  }
  function newest(list) {
    list.sort(function (a, b) { return b[3] - a[3]; });
    var seen = {}; return list.filter(function (r) { if (seen[r[0]]) return false; seen[r[0]] = 1; return true; }).map(function (r) { return r.slice(0, 3); });
  }
  photos = newest(photos); pdfs = newest(pdfs);
  var tab = ss.getSheetByName('Drive files') || ss.insertSheet('Drive files');
  tab.clearContents();
  var n = Math.max(photos.length, pdfs.length, 1), out = [];
  for (var i = 0; i < n; i++) out.push((photos[i] || ['', '', '']).concat([''], pdfs[i] || ['', '', '']));
  tab.getRange(1, 1, 1, 7).setValues([['Photo', 'Photo ID', 'Photo link', '', 'PDF', 'PDF ID', 'PDF link']]).setFontWeight('bold');
  tab.getRange(2, 1, n, 7).setNumberFormat('@').setValues(out);
  var photoList = SpreadsheetApp.newDataValidation().requireValueInRange(tab.getRange('A2:A'), true).setAllowInvalid(false).build();
  var pdfList = SpreadsheetApp.newDataValidation().requireValueInRange(tab.getRange('E2:E'), true).setAllowInvalid(false).build();
  var ph = ss.getSheetByName('Photos');
  if (ph) ph.getRange('C2:C').setDataValidation(photoList);
  var st = ss.getSheetByName('Settings'), used = [];
  if (st) st.getRange(2, 1, Math.max(st.getLastRow() - 1, 1), 2).getValues().forEach(function (r, k) {
    if (/pdf$/i.test(String(r[0]))) { st.getRange(k + 2, 2).setDataValidation(pdfList); used.push(String(r[1])); }
  });
  if (ph) ph.getRange('C2:C').getValues().forEach(function (r) { if (r[0]) used.push(String(r[0])); });
  // the files in use, by Drive id: a change means a photo or PDF was replaced, so the website takes the new one
  var ids = {}; photos.concat(pdfs).forEach(function (r) { ids[r[0]] = r[1]; });
  var sig = used.map(function (u) { return u + '=' + (ids[u] || ''); }).join('|');
  if (p.getProperty('FILES_SIG') && p.getProperty('FILES_SIG') !== sig) publishMenu();
  p.setProperty('FILES_SIG', sig);
}

/* The Menu tab from the menu the website shows now (data/menu-sheet.csv in the repository), in the tab's own column order. */
function loadMenuFromSite() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Replace the Menu tab with the words and prices of the menu on the website now?', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var h = gitHeaders_(); h.Accept = 'application/vnd.github.raw+json';
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + prop_('GITHUB_REPO') + '/contents/data/menu-sheet.csv?ref=' + (prop_('GITHUB_BRANCH') || 'main'), { muteHttpExceptions: true, headers: h });
  if (res.getResponseCode() >= 300) throw new Error('GitHub: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  var rows = Utilities.parseCsv(res.getContentText('UTF-8'));
  var head = rows.shift().map(function (x) { return x.toLowerCase(); });
  var tab = SpreadsheetApp.getActive().getSheetByName('Menu');
  var cols = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0].map(function (x) { return String(x).toLowerCase(); });
  var out = rows.map(function (r) { return cols.map(function (c) { var i = head.indexOf(c); return i < 0 ? '' : r[i]; }); });
  tab.getRange(2, 1, Math.max(tab.getLastRow() - 1, 1), cols.length).clearContent();
  tab.getRange(2, 1, out.length, cols.length).setValues(out);
  ui.alert('The Menu tab now matches the website (' + out.length + ' rows).');
}

/* ---------------------------------------------------------------- weekly visits */
/* One row per week in the Visits tab, from the site's own counter (src/worker.js, Cloudflare Workers Analytics Engine;
   no cookies, no IP addresses). Weeks run Sunday to Saturday (Cairo time), labelled with the Saturday. */
var VISITS_TAB = 'Visits';
var VISITS_HEADER = ['Week (Sun–Sat), ending', 'Page views', 'Home', 'Menu', 'QR scans (tables)', 'Morning menu', 'Evening menu',
  'Reserve taps', 'Bookings sent to WhatsApp', 'Calls', 'Directions', 'Instagram / TikTok', 'App links', 'Page zooms',
  'From phones', 'iPhone', 'Android', 'Top phones', 'Top cities', 'Top sources'];

function updateVisits() {
  if (stale_()) return;
  var tz = 'Africa/Cairo', now = new Date();
  var dow = Number(Utilities.formatDate(now, tz, 'u')) % 7;                        // Sunday = 0
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var end = new Date(Utilities.parseDate(today + ' 00:00', tz, 'yyyy-MM-dd HH:mm').getTime() - dow * 864e5);
  var start = new Date(end.getTime() - 7 * 864e5);
  var label = Utilities.formatDate(new Date(end.getTime() - 864e5), tz, 'yyyy-MM-dd');
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(VISITS_TAB) || ss.insertSheet(VISITS_TAB);
  if (sh.getLastRow() === 0) { sh.appendRow(VISITS_HEADER); sh.setFrozenRows(1); }
  var done = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(function (r) { return r[0]; }) : [];
  if (done.indexOf(label) >= 0) return;

  var w = "timestamp >= toDateTime('" + iso_(start) + "') AND timestamp < toDateTime('" + iso_(end) + "')";
  var ev = cfRows_('SELECT blob1 AS e, blob3 AS p, blob4 AS mood, SUM(_sample_interval) AS n FROM lulus_hits WHERE ' + w + ' GROUP BY e, p, mood');
  var n = function (f) { return ev.filter(f).reduce(function (a, r) { return a + Number(r.n); }, 0); };
  var views = n(function (r) { return r.e === 'view'; });
  var dev = cfRows_("SELECT blob6 AS type, blob7 AS os, SUM(_sample_interval) AS n FROM lulus_hits WHERE " + w + " AND blob1 = 'view' GROUP BY type, os");
  var dn = function (f) { return dev.filter(f).reduce(function (a, r) { return a + Number(r.n); }, 0); };
  var pct = function (x) { return views ? Math.round(x * 100 / views) + '%' : ''; };
  var top = function (col, extra) {
    return cfRows_('SELECT ' + col + " AS k, SUM(_sample_interval) AS n FROM lulus_hits WHERE " + w + " AND blob1 = 'view'" + (extra || '') +
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

function cfRows_(sql) {
  var res = UrlFetchApp.fetch('https://api.cloudflare.com/client/v4/accounts/' + prop_('CF_ACCOUNT_ID') + '/analytics_engine/sql', {
    method: 'post', contentType: 'text/plain', muteHttpExceptions: true, payload: sql + ' FORMAT JSON',
    headers: { Authorization: 'Bearer ' + prop_('CF_API_TOKEN') }
  });
  if (res.getResponseCode() !== 200) throw new Error('Cloudflare: ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText()).data || [];
}

function iso_(d) { return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd HH:mm:ss'); }
