/**
 * Puts a Menu, Seasons, Content, Photos or Settings tab edit on the website about a minute later, by starting the repo's
 * "Publish menu" GitHub Action. Adds a "LÜLU’S website" menu to the Sheet: Publish now (after a new PDF in Drive, for example),
 * and Copy the PDF menu's words into the Menu tab (before switching "Menu comes from" back to Sheet after a new PDF).
 * Paste into the Sheet: Extensions > Apps Script. In Project settings > Script properties add:
 *   GITHUB_TOKEN  a fine-grained GitHub token for this repository only, with "Actions: Read and write" and "Contents: Read"
 *   GITHUB_REPO   owner/name of the website repository
 *   GITHUB_BRANCH main
 *   FILES_FOLDER_ID  the id of her Drive folder for the website's photos and menu PDFs (the end of the folder's link)
 * Run setupPublish() once (it asks for permission, watches the Sheet for edits, and lists the Drive folder every 10 minutes
 * in the Drive files tab, which feeds the Photo dropdown of the Photos tab and the PDF dropdowns of the Settings tab).
 * Edits made close together go out as one update. The Action also runs every 3 hours as a backup.
 */
function setupPublish() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'onSheetEdit_') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onSheetEdit_').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshFiles') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshFiles').timeBased().everyMinutes(10).create();
  refreshFiles();
}

/* Lists the photos and PDFs of her Drive folder (newest first; a name used twice keeps its newest file) in the Drive files tab,
   and points the Photo and PDF dropdowns at that list. When a file in use was replaced by a newer one with the same name,
   the website is updated too. */
function refreshFiles() {
  var ss = SpreadsheetApp.getActive(), p = PropertiesService.getScriptProperties();
  var it = DriveApp.getFolderById(p.getProperty('FILES_FOLDER_ID')).getFiles(), photos = [], pdfs = [];
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

function onOpen() {
  SpreadsheetApp.getUi().createMenu('LÜLU’S website')
    .addItem('Publish now', 'publishMenu')
    .addItem('Refresh the photo and PDF lists', 'refreshFiles')
    .addItem('Copy the PDF menu’s words into the Menu tab', 'loadMenuFromSite')
    .addToUi();
}

/* The Menu tab from the menu the website shows now (data/menu-sheet.csv in the repository), in the tab's own column order. */
function loadMenuFromSite() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Replace the Menu tab with the words and prices of the menu on the website now?', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var p = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + p.getProperty('GITHUB_REPO') + '/contents/data/menu-sheet.csv?ref=' + (p.getProperty('GITHUB_BRANCH') || 'main'), {
    muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + p.getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github.raw+json' }
  });
  if (res.getResponseCode() >= 300) throw new Error('GitHub: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  var rows = Utilities.parseCsv(res.getContentText('UTF-8'));
  var head = rows.shift().map(function (h) { return h.toLowerCase(); });
  var tab = SpreadsheetApp.getActive().getSheetByName('Menu');
  var cols = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0].map(function (h) { return String(h).toLowerCase(); });
  var out = rows.map(function (r) { return cols.map(function (c) { var i = head.indexOf(c); return i < 0 ? '' : r[i]; }); });
  tab.getRange(2, 1, Math.max(tab.getLastRow() - 1, 1), cols.length).clearContent();
  tab.getRange(2, 1, out.length, cols.length).setValues(out);
  ui.alert('The Menu tab now matches the website (' + out.length + ' rows).');
}

function onSheetEdit_(e) {
  if (e && e.range && ['Menu', 'Seasons', 'Content', 'Photos', 'Settings'].indexOf(e.range.getSheet().getName()) < 0) return;
  // one publish a minute after the last edit, not one per cell
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'publishMenu') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('publishMenu').timeBased().after(60 * 1000).create();
}

function publishMenu() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'publishMenu') ScriptApp.deleteTrigger(t); });
  var p = PropertiesService.getScriptProperties();
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + p.getProperty('GITHUB_REPO') + '/actions/workflows/publish-menu.yml/dispatches', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + p.getProperty('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ ref: p.getProperty('GITHUB_BRANCH') || 'main' })
  });
  if (res.getResponseCode() >= 300) throw new Error('GitHub: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
}
