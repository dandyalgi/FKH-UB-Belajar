// Quiz Time participants -> Google Sheet.
// Paste into the Sheet's Extensions > Apps Script, then Deploy > New deployment > Web app
// (Execute as: Me, Who has access: Anyone) and copy the Web app URL into config.js.
// Each app writes to its own tab: Quiz Time -> 'Participants', OSCE Practice -> 'OSCE Participants', OSCE Assessor -> 'Assessor Participants'.
const SHEETS = { quiz: 'Participants', osce: 'OSCE Participants', assessor: 'Assessor Participants' };
function sheetName_(app) { return SHEETS[app] || SHEETS.quiz; }

function getSheet_(app) {
  const SHEET_NAME = sheetName_(app);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['First seen', 'Last seen', 'Name', 'University', 'Device ID', 'Visits']);
    sh.setFrozenRows(1);
  } else if (sh.getRange(1, 4).getValue() !== 'University') {
    // sheet created by an earlier version: add the University column after Name
    sh.insertColumnAfter(3);
    sh.getRange(1, 4).setValue('University');
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function count_(sh) { return Math.max(0, sh.getLastRow() - 1); }

// Returns only the number of participants, never the names.
function doGet(e) {
  const app = e && e.parameter ? e.parameter.app : '';
  return out_({ ok: true, count: count_(getSheet_(app)) });
}

// Adds a participant, or updates the name / last seen / visits of an existing one.
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === 'report') return report_(d);
    if (d.action === 'suggest') return suggest_(d);
    const id = String(d.id || '');
    let name = String(d.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    let uni = String(d.university || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || name.length < 2) return out_({ ok: false });
    // never let a name or university run as a spreadsheet formula
    if (/^[=+\-@]/.test(name)) name = "'" + name;
    if (/^[=+\-@]/.test(uni)) uni = "'" + uni;
    const sh = getSheet_(String(d.app || ''));
    const last = sh.getLastRow();
    const ids = last > 1 ? sh.getRange(2, 5, last - 1, 1).getValues().map((r) => String(r[0])) : [];
    const i = ids.indexOf(id);
    const now = new Date();
    if (i < 0) {
      sh.appendRow([now, now, name, uni, id, 1]);
    } else {
      const r = i + 2;
      sh.getRange(r, 2).setValue(now);
      sh.getRange(r, 3).setValue(name);
      if (uni) sh.getRange(r, 4).setValue(uni);
      sh.getRange(r, 6).setValue(Number(sh.getRange(r, 6).getValue()) + 1);
    }
    return out_({ ok: true, count: count_(sh) });
  } finally {
    lock.releaseLock();
  }
}

// Question reports from Quiz Time -> 'Reports' tab.
const REPORT_SHEET = 'Reports';
const REPORT_TYPES = ['Incorrect question', 'Incorrect answer choices', 'Incorrect answer key', 'Incorrect explanation', 'Incorrect category', 'Other'];

// Plain text only: trims, caps the length, and stops a value from running as a spreadsheet formula.
function cell_(v, max) {
  let s = String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function report_(d) {
  const types = Array.isArray(d.types) ? d.types.filter((t) => REPORT_TYPES.indexOf(t) >= 0) : [];
  const code = cell_(d.code, 80);
  if (!types.length || !code) return out_({ ok: false });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(REPORT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(REPORT_SHEET);
    sh.appendRow(['Time', 'Reporter', 'Question code', 'Type of error', 'Category', 'Question', 'Answer choices', 'Answer key', 'Explanation', 'Additional comment']);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), cell_(d.reporter, 140), code, types.join(', '), cell_(d.category, 120), cell_(d.question, 4000),
    cell_(d.choices, 3000), cell_(d.answerKey, 600), cell_(d.explanation, 4000), cell_(d.comment, 1000)]);
  return out_({ ok: true });
}

// Suggestions and Google Drive links (Quiz Time and OSCE Practice) -> 'Suggestions' tab.
const SUGGEST_SHEET = 'Suggestions';
function suggest_(d) {
  const link = cell_(d.link, 400);
  const message = cell_(d.message, 1500);
  if (link && !/^https:\/\/(drive|docs)\.google\.com\/\S+$/i.test(link)) return out_({ ok: false });
  if (!link && message.length < 5) return out_({ ok: false });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SUGGEST_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SUGGEST_SHEET);
    sh.appendRow(['Time', 'App', 'Sender', 'Type', 'Google Drive link', 'Message']);
    sh.setFrozenRows(1);
  }
  const app = ['quiz', 'osce'].indexOf(String(d.app)) >= 0 ? String(d.app) : 'quiz';
  const kind = d.kind === 'Contribution' ? 'Contribution' : 'Suggestion';
  sh.appendRow([new Date(), app, cell_(d.sender, 140), kind, link, message]);
  return out_({ ok: true });
}
