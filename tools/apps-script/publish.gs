/**
 * Puts a Menu, Seasons or Content tab edit on the website about a minute later, by starting the repo's "Publish menu" GitHub Action.
 * Paste into the Sheet: Extensions > Apps Script. In Project settings > Script properties add:
 *   GITHUB_TOKEN  a fine-grained GitHub token for this repository only, with "Actions: Read and write"
 *   GITHUB_REPO   owner/name of the website repository
 * Run setupPublish() once (it asks for permission and watches the Sheet for edits).
 * Edits made close together go out as one update. The Action also runs every 3 hours as a backup.
 */
function setupPublish() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'onSheetEdit_') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onSheetEdit_').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
}

function onSheetEdit_(e) {
  if (e && e.range && ['Menu', 'Seasons', 'Content'].indexOf(e.range.getSheet().getName()) < 0) return;
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
