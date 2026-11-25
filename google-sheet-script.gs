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

// Returns the number of participants (never the names), or, with ?action=reports, the public list of question reports.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'reports') return reports_(String(p.device || ''), String(p.app || ''));
  if (p.action === 'boot') return boot_(String(p.device || ''), String(p.app || ''));
  if (p.action === 'admins') return admins_(String(p.device || ''));
  return out_({ ok: true, count: count_(getSheet_(p.app || '')) });
}

// Adds a participant, or updates the name / last seen / visits of an existing one.
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === 'report') return d.app === 'osce' ? osceReport_(d) : report_(d);
    if (d.action === 'suggest') return suggest_(d);
    if (d.action === 'rvote') return vote_(d);
    if (d.action === 'rcomment') return comment_(d);
    if (String(d.action || '').charAt(0) === 'a') return admin_(d);
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
    sh.appendRow(['Time', 'Reporter', 'Question code', 'Type of error', 'Category', 'Question', 'Answer choices', 'Answer key', 'Explanation', 'Additional comment', 'Status', 'Admin note', 'Report ID', 'Device ID']);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), cell_(d.reporter, 140), code, types.join(', '), cell_(d.category, 120), cell_(d.question, 4000),
    cell_(d.choices, 3000), cell_(d.answerKey, 600), cell_(d.explanation, 4000), cell_(d.comment, 1000), '', '', '', ID_RE.test(String(d.device || '')) ? String(d.device) : '']);
  return out_({ ok: true });
}

// Public list of reports for the Quiz Time "Reports" page, with votes and comments. Reporter names are NOT included.
// Mark a report as handled by typing a status (e.g. Fixed, Rejected, In progress) in column K ('Status') of the Reports tab; column L ('Admin note') is shown to everyone too.
// Column M ('Report ID') is filled in automatically. To hide a comment, type anything in the 'Hidden' column of the 'Report comments' tab.
const VOTE_SHEET = 'Report votes';
const COMMENT_SHEET = 'Report comments';

function tab_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

function reports_(device, app) {
  if (app === 'osce') return osceReports_(device);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REPORT_SHEET);
  if (!sh || sh.getLastRow() < 2) return out_({ ok: true, reports: [], admin: isAdmin_(device) });
  if (sh.getRange(1, 11).getValue() !== 'Status') { sh.getRange(1, 11).setValue('Status'); sh.getRange(1, 12).setValue('Admin note'); }
  if (sh.getRange(1, 13).getValue() !== 'Report ID') sh.getRange(1, 13).setValue('Report ID');
  if (sh.getRange(1, 14).getValue() !== 'Device ID') sh.getRange(1, 14).setValue('Device ID');
  if (sh.getRange(1, 15).getValue() !== 'Deleted') sh.getRange(1, 15).setValue('Deleted');
  const adm = isAdmin_(device);
  const n = sh.getLastRow() - 1;
  const rng = sh.getRange(2, 1, n, 15);
  const rows = rng.getValues();
  let changed = false;
  rows.forEach((r) => { if (!r[12]) { r[12] = Utilities.getUuid().replace(/-/g, '').slice(0, 12); changed = true; } });
  if (changed) sh.getRange(2, 13, n, 1).setValues(rows.map((r) => [r[12]]));

  const votes = {};
  const vs = tab_(VOTE_SHEET, ['Time', 'Report ID', 'Device ID', 'Vote']);
  if (vs.getLastRow() > 1) vs.getRange(2, 1, vs.getLastRow() - 1, 4).getValues().forEach((v) => {
    const o = votes[v[1]] || (votes[v[1]] = { up: 0, down: 0, mine: 0 });
    if (Number(v[3]) > 0) o.up++; else if (Number(v[3]) < 0) o.down++;
    if (device && String(v[2]) === device) o.mine = Number(v[3]);
  });
  const comments = {};
  const cs = tab_(COMMENT_SHEET, ['Time', 'Report ID', 'Name', 'Comment', 'Hidden']);
  if (cs.getLastRow() > 1) cs.getRange(2, 1, cs.getLastRow() - 1, 5).getValues().forEach((c, i) => {
    if (!c[3] || (c[4] && !adm)) return;
    const o = { t: c[0] instanceof Date ? c[0].getTime() : 0, name: String(c[2]).slice(0, 140), text: String(c[3]).slice(0, 1000) };
    if (adm) { o.cid = i + 2; o.hidden = !!c[4]; }
    (comments[c[1]] || (comments[c[1]] = [])).push(o);
  });

  const cut = (v, m) => String(v == null ? '' : v).slice(0, m);
  const list = rows.map((r) => {
    const id = String(r[12]); const v = votes[id] || { up: 0, down: 0, mine: 0 };
    return {
      id, t: r[0] instanceof Date ? r[0].getTime() : 0, by: cut(r[1], 140), dev: !!r[13], own: !!device && String(r[13]) === device, code: cut(r[2], 40), types: cut(r[3], 200), category: cut(r[4], 80),
      question: cut(r[5], 4000), choices: cut(r[6], 3000), key: cut(r[7], 600), explanation: cut(r[8], 4000), comment: cut(r[9], 1000),
      status: cut(r[10], 40), note: cut(r[11], 500), up: v.up, down: v.down, mine: v.mine, comments: (comments[id] || []).slice(-100), deleted: !!r[14],
    };
  }).filter((x) => x.code && (adm || !x.deleted)).reverse().slice(0, 300);
  return out_({ ok: true, reports: list, admin: adm });
}

// ---- OSCE Practice case reports -> 'OSCE Reports' tab (same votes/comments tabs; Report ID is unique across apps) ----
const OSCE_REPORT_SHEET = 'OSCE Reports';
const OSCE_TYPES = ['Incorrect scenario / physical exam', 'Incorrect anamnesis', 'Incorrect test results', 'Incorrect diagnosis', 'Incorrect treatment / prescription', 'Incorrect answer key / explanation', 'Other'];

function osceReport_(d) {
  const types = Array.isArray(d.types) ? d.types.filter((t) => OSCE_TYPES.indexOf(t) >= 0) : [];
  const code = cell_(d.code, 80);
  if (!types.length || !code) return out_({ ok: false });
  const sh = tab_(OSCE_REPORT_SHEET, ['Time', 'Reporter', 'Case ID', 'Case no.', 'Source', 'Title', 'Type of error', 'Additional comment', 'Status', 'Admin note', 'Report ID', 'Device ID']);
  sh.appendRow([new Date(), cell_(d.reporter, 140), code, cell_(d.caseNo, 20), cell_(d.source, 120), cell_(d.title, 300), types.join(', '), cell_(d.comment, 1000), '', '', Utilities.getUuid().replace(/-/g, '').slice(0, 12), ID_RE.test(String(d.device || '')) ? String(d.device) : '']);
  return out_({ ok: true });
}

function osceReports_(device) {
  const sh = tab_(OSCE_REPORT_SHEET, ['Time', 'Reporter', 'Case ID', 'Case no.', 'Source', 'Title', 'Type of error', 'Additional comment', 'Status', 'Admin note', 'Report ID', 'Device ID']);
  if (sh.getRange(1, 12).getValue() !== 'Device ID') sh.getRange(1, 12).setValue('Device ID');
  if (sh.getRange(1, 13).getValue() !== 'Deleted') sh.getRange(1, 13).setValue('Deleted');
  const adm = isAdmin_(device);
  if (sh.getLastRow() < 2) return out_({ ok: true, reports: [], admin: adm });
  const n = sh.getLastRow() - 1;
  const rows = sh.getRange(2, 1, n, 13).getValues();
  let changed = false;
  rows.forEach((r) => { if (!r[10]) { r[10] = Utilities.getUuid().replace(/-/g, '').slice(0, 12); changed = true; } });
  if (changed) sh.getRange(2, 11, n, 1).setValues(rows.map((r) => [r[10]]));
  const votes = {};
  const vs = tab_(VOTE_SHEET, ['Time', 'Report ID', 'Device ID', 'Vote']);
  if (vs.getLastRow() > 1) vs.getRange(2, 1, vs.getLastRow() - 1, 4).getValues().forEach((v) => {
    const o = votes[v[1]] || (votes[v[1]] = { up: 0, down: 0, mine: 0 });
    if (Number(v[3]) > 0) o.up++; else if (Number(v[3]) < 0) o.down++;
    if (device && String(v[2]) === device) o.mine = Number(v[3]);
  });
  const comments = {};
  const cs = tab_(COMMENT_SHEET, ['Time', 'Report ID', 'Name', 'Comment', 'Hidden']);
  if (cs.getLastRow() > 1) cs.getRange(2, 1, cs.getLastRow() - 1, 5).getValues().forEach((c, i) => {
    if (!c[3] || (c[4] && !adm)) return;
    const o = { t: c[0] instanceof Date ? c[0].getTime() : 0, name: String(c[2]).slice(0, 140), text: String(c[3]).slice(0, 1000) };
    if (adm) { o.cid = i + 2; o.hidden = !!c[4]; }
    (comments[c[1]] || (comments[c[1]] = [])).push(o);
  });
  const cut = (v, m) => String(v == null ? '' : v).slice(0, m);
  const list = rows.map((r) => {
    const id = String(r[10]); const v = votes[id] || { up: 0, down: 0, mine: 0 };
    return { id, t: r[0] instanceof Date ? r[0].getTime() : 0, by: cut(r[1], 140), dev: !!r[11], own: !!device && String(r[11]) === device, code: cut(r[2], 80), no: cut(r[3], 20), source: cut(r[4], 120), title: cut(r[5], 300), types: cut(r[6], 300),
      comment: cut(r[7], 500), status: cut(r[8], 40), note: cut(r[9], 500), up: v.up, down: v.down, mine: v.mine, comments: (comments[id] || []).slice(-100), deleted: !!r[12] };
  }).filter((x) => x.code && (adm || !x.deleted)).reverse().slice(0, 300);
  return out_({ ok: true, reports: list, admin: adm });
}

const ID_RE = /^[A-Za-z0-9-]{6,64}$/;
function vote_(d) {
  const id = String(d.id || ''); const dev = String(d.device || ''); const val = Number(d.vote);
  if (!ID_RE.test(id) || !ID_RE.test(dev) || [-1, 0, 1].indexOf(val) < 0) return out_({ ok: false });
  const sh = tab_(VOTE_SHEET, ['Time', 'Report ID', 'Device ID', 'Vote']);
  const last = sh.getLastRow();
  const data = last > 1 ? sh.getRange(2, 2, last - 1, 2).getValues() : [];
  let row = -1;
  for (let i = 0; i < data.length; i++) if (String(data[i][0]) === id && String(data[i][1]) === dev) { row = i + 2; break; }
  if (row < 0) { if (val !== 0) sh.appendRow([new Date(), id, dev, val]); }
  else if (val === 0) sh.deleteRow(row);
  else { sh.getRange(row, 1).setValue(new Date()); sh.getRange(row, 4).setValue(val); }
  return out_({ ok: true });
}

function comment_(d) {
  const id = String(d.id || ''); const text = cell_(d.text, 1000); const name = cell_(d.name, 140);
  if (!ID_RE.test(id) || text.length < 2 || name.length < 2) return out_({ ok: false });
  tab_(COMMENT_SHEET, ['Time', 'Report ID', 'Name', 'Comment', 'Hidden']).appendRow([new Date(), id, name, text, '']);
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


// ---------------------------------------------------------------------------------------------
// Admins: moderate threads (close / reopen / soft-delete / hide comments), edit questions and cases, manage admins.
// The first three device IDs below can never be removed. Others are added from the Admin tab of the app (stored in the 'Admins' tab).
// Question / case edits are stored ENCRYPTED (the browser encrypts them with the same key as bank.enc / cases.enc), so this sheet never holds the plain text.
// Do not delete rows of 'Report comments' or 'Question edits' by hand: comment IDs are row numbers and edit history is append-only.
// ---------------------------------------------------------------------------------------------
const SEED_ADMINS = ['21faf0a4-0960-40b6-848f-550cb8f3d2ec', '4720a55c-3190-49a7-936e-c2c54157aab7', '4ea21542-db3f-44bf-ac2c-59ab93f9c277'];
const ADMIN_SHEET = 'Admins';
const EDIT_SHEET = 'Question edits';
const ITEM_RE = /^[A-Za-z0-9._:-]{1,80}$/;

function adminList_() {
  const sh = tab_(ADMIN_SHEET, ['Device ID', 'Label', 'Added by', 'Time']);
  const out = SEED_ADMINS.map((id) => ({ id, label: 'Owner', seed: true }));
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach((r) => {
    const id = String(r[0]).trim();
    if (ID_RE.test(id) && !out.some((x) => x.id === id)) out.push({ id, label: String(r[1]).slice(0, 80), seed: false, by: String(r[2]).slice(0, 140) });
  });
  return out;
}
function isAdmin_(dev) {
  dev = String(dev || '');
  if (!ID_RE.test(dev)) return false;
  if (SEED_ADMINS.indexOf(dev) >= 0) return true;
  return adminList_().some((x) => x.id === dev);
}

function editRows_(app) {
  const sh = tab_(EDIT_SHEET, ['Time', 'App', 'Item', 'Rev', 'Editor', 'Device ID', 'Kind', 'Payload']);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().filter((r) => String(r[1]) === app).map((r) => ({
    item: String(r[2]), rev: Number(r[3]) || 0, by: String(r[4]).slice(0, 140), t: r[0] instanceof Date ? r[0].getTime() : 0, kind: String(r[6]), p: String(r[7]),
  }));
}

// One call at start-up: is this device an admin, and every edit made so far (encrypted).
function boot_(device, app) {
  app = app === 'osce' ? 'osce' : 'quiz';
  return out_({ ok: true, admin: isAdmin_(device), edits: editRows_(app) });
}
function admins_(device) {
  if (!isAdmin_(device)) return out_({ ok: false, denied: true });
  return out_({ ok: true, admins: adminList_() });
}

function reportRow_(app, id) {
  const osce = app === 'osce';
  const sh = osce ? tab_(OSCE_REPORT_SHEET, ['Time']) : SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REPORT_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const idCol = osce ? 11 : 13;
  const ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return { sh, row: i + 2, status: osce ? 9 : 11, note: osce ? 10 : 12, del: osce ? 13 : 15 };
  return null;
}

function admin_(d) {
  const dev = String(d.device || '');
  if (!isAdmin_(dev)) return out_({ ok: false, denied: true });
  const act = String(d.action);
  const app = d.app === 'osce' ? 'osce' : 'quiz';
  if (act === 'astatus' || act === 'adel') {
    const id = String(d.id || '');
    const r = ID_RE.test(id) ? reportRow_(app, id) : null;
    if (!r) return out_({ ok: false });
    if (act === 'astatus') {
      if (typeof d.status === 'string') r.sh.getRange(r.row, r.status).setValue(d.status === 'Closed' ? 'Closed' : '');
      if (typeof d.note === 'string') r.sh.getRange(r.row, r.note).setValue(cell_(d.note, 500));
    } else {
      r.sh.getRange(r.row, r.del).setValue(d.del ? 'Deleted' : '');
    }
    return out_({ ok: true });
  }
  if (act === 'ahide') {
    const cs = tab_(COMMENT_SHEET, ['Time', 'Report ID', 'Name', 'Comment', 'Hidden']);
    const row = Number(d.cid);
    if (!(row >= 2 && row <= cs.getLastRow()) || String(cs.getRange(row, 2).getValue()) !== String(d.id)) return out_({ ok: false });
    cs.getRange(row, 5).setValue(d.hide ? 'Hidden' : '');
    return out_({ ok: true });
  }
  if (act === 'aedit') {
    const item = String(d.item || ''); const p = String(d.p || '');
    const kind = d.kind === 'revert' ? 'revert' : 'edit';
    if (!ITEM_RE.test(item) || p.indexOf('e1:') !== 0 || p.length > 45000) return out_({ ok: false });
    const rows = editRows_(app).filter((x) => x.item === item);
    const cur = rows.reduce((m, x) => Math.max(m, x.rev), 0);
    if (Number(d.rev) !== cur) return out_({ ok: false, conflict: true });
    tab_(EDIT_SHEET, ['Time', 'App', 'Item', 'Rev', 'Editor', 'Device ID', 'Kind', 'Payload']).appendRow([new Date(), app, item, cur + 1, cell_(d.editor, 140), dev, kind, p]);
    return out_({ ok: true, rev: cur + 1 });
  }
  if (act === 'aadmin_add') {
    const target = String(d.target || '').trim();
    if (!ID_RE.test(target)) return out_({ ok: false });
    if (!adminList_().some((x) => x.id === target)) tab_(ADMIN_SHEET, ['Device ID', 'Label', 'Added by', 'Time']).appendRow([target, cell_(d.label, 80), cell_(d.editor, 140), new Date()]);
    return out_({ ok: true });
  }
  if (act === 'aadmin_del') {
    const target = String(d.target || '').trim();
    if (SEED_ADMINS.indexOf(target) >= 0) return out_({ ok: false });
    const sh = tab_(ADMIN_SHEET, ['Device ID', 'Label', 'Added by', 'Time']);
    for (let i = sh.getLastRow(); i >= 2; i--) if (String(sh.getRange(i, 1).getValue()).trim() === target) sh.deleteRow(i);
    return out_({ ok: true });
  }
  return out_({ ok: false });
}
