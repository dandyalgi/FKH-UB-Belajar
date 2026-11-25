(() => {
  'use strict';
  const DATA_URL = 'cases.enc'; // AES-GCM encrypted case database (see encrypt-data.js)
  const KEY_STORE = 'osce.key.v1';
  const T = { brief: 120, exam: 1080 }; // seconds: examinee reads (2 min), examiner stage (18 min = former 15 + 3)
  const REMINDERS = [{ left: 600, msg: '10 minutes remaining', bells: 1 }, { left: 300, msg: '5 minutes remaining', bells: 2 }, { left: 180, msg: '3 minutes remaining', bells: 3 }]; // shown during the 18-minute stage
  const app = document.getElementById('app');
  const NAME_KEY = 'osce.name.v1', HIST_KEY = 'osce.history.v1', HIST_MAX = 200;
  const store = {
    read(k, d) { try { const r = window.localStorage.getItem(k); return r === null ? d : JSON.parse(r); } catch (_) { return d; } },
    write(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
  };
  const st = { cases: [], byId: new Map(), timerOn: true, caseId: null, reveal: false, source: '', key: null, opened: new Set(), assessOn: true, chk: new Set(), xchk: new Set(), ovr: {}, user: null, visitors: null, panelMin: false, name: String(store.read(NAME_KEY, '') || '').slice(0, 60), entry: null };
  const loadHist = () => { const r = store.read(HIST_KEY, []); return Array.isArray(r) ? r.filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.t) && typeof e.name === 'string').slice(-HIST_MAX) : []; };
  const saveHist = (a) => store.write(HIST_KEY, a.slice(-HIST_MAX));
  const when = (t) => { try { return new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return new Date(t).toISOString(); } };
  const CHANGELOG = [
    { v: 'v40', d: '2026-11-25', items: ['Admins (set by the owner) can close, reopen and delete report threads, hide comments, and edit a case (scenario, anamnesis, test text, diagnosis, treatment, prescription…) from a thread or from All questions. Edits are saved for everyone, marked “Edited by admin” with a visible history. Admins can add other admins in the new Admin tab. Your device ID is shown on the main screen.', 'The “View the case now” button in report threads is now much easier to see.'] },
    { v: 'v39', d: '2026-11-25', items: ['Reply to a comment: tap “↩ Reply” under any comment. The person you reply to is tagged and gets a notification in the 🔔 list.', 'Fixed: the 🔔 button now shows right after you sign in, without opening Reports & Discussion first.'] },
    { v: 'v38', d: '2026-11-25', items: ['Report a case: a “Report this case” button under every case in All questions and at the end of a session (also in single-player mode). Choose what is wrong and add a comment.', 'New “Reports & Discussion” tab at the top (next to All questions): all reports in one list, sort by newest, oldest, most thumbs up/down or most comments, filter by status or type of error, see the reporter, give a thumbs up or down, and comment.', 'A 🔔 button at the top right lists new thumbs up/down and comments on your own reports; tap one to open that thread.'] },
    { v: 'v35', d: '2026-11-22', items: ['TO NAS NOVEMBER 2026 cases: lab results that only said up/down now show example values with reference ranges (marked as AI-created example data).'] },
    { v: 'v34', d: '2026-11-21', items: ['Added 3 cases from Agha Thariq Sugijanto (Addison, EPI, Cushing; 30 cases total). Agha added to the contributors list.'] },
    { v: 'v33', d: '2026-11-21', items: ['Time reminders are now bell sounds only (no voice): 1 strike at 10 minutes left, 2 at 5, 3 at 3, 2 when reading time ends, 4 when the exam time is up. On-screen notices stay.'] },
    { v: 'v32', d: '2026-11-21', items: ['TO NAS cases corrected against the original PDFs: full original scenario wording; Ancylostomiasis scenario and CBC now follow Undana; NSHP case diagnosis follows Undikma; extra source versions noted in the prescription notes.'] },
    { v: 'v31', d: '2026-11-21', items: ['Added 8 cases from TO NAS NOVEMBER 2026: EPI, Cushing, Ancylostomiasis, bacterial cystitis, pseudomembranous cystitis, megacolon, MMVD, rickets (27 cases total).'] },
    { v: 'v30', d: '2026-11-21', items: ['Assessment form scale changed: total 400, pass at 250 (was 800 / 550). Same 9 rows and scoring rules; saved sessions are recalculated automatically.'] },
    { v: 'v29', d: '2026-11-20', items: ['Time reminders are now spoken (Indonesian voice): “Sisa waktu sepuluh / lima / tiga menit” and “Waktu habis”, with the on-screen notice. Browsers without speech use a beep.', 'New “Back up your progress” card on the main menu: Export progress (a .json file with your history) and Import progress (merge, or replace the current history).'] },
    { v: 'v28', d: '2026-11-20', items: ['Examiner mode: the 15-minute stage and the 3-minute segment outside the app are now one 18-minute stage. Reminders pop up with 10, 5 and 3 minutes left. When the time runs out the app moves to the next stage by itself, after the 2-minute reading time as well as after the 18 minutes. Skip timer still lets you carry on without a timer.', 'Stage numbers are now 1 reading · 2 examiner · 3 assessment form · 4 results (3 stages without the assessment form).'] },
    { v: 'v27', d: '2026-11-20', items: ['New Single-player mode (button on the main menu): do a case on your own without an examiner, in three stages. 1) Read the case (2 min). 2) Work through six steps in 18 min: history-taking by chatting with the owner (replies when your question contains the right keywords), physical examination form, differential diagnosis and diagnostic tests (many decoys; after 5 tests further ones are flagged), final diagnosis and prognosis, treatment and prescription, client education. 3) No timer: your answers next to the answer key, plus the history questions you did not ask and the tests you did not look at. No scoring rubric. When a timer runs out the app moves on by itself.'] },
    { v: 'v26', d: '2026-11-20', items: ['Back to the original look; only the BPUPKH seal was kept in the header.'] },
    { v: 'v25', d: '2026-11-20', items: ['Assessment form replaced with the Kertas Kerja Penilai OSCE UKMPPDH 2025: 9 rows scored 1–4 by the form’s descriptors, total 800, pass at 550 (St.1 Komunikasi 20%, St.2 Diagnosa Klinik 50%, St.3 Reseptir & Terapeutik 30%).', 'Extra checklist: removed the items that the new form already covers (permission, kindness/welfare, examination order and technique, specific tests, zoonosis education, restraint, not leaving the animal alone).', 'Sessions saved with the old 400-point form still open in History with their old scores; participant reports now count only sessions with the new form.'] },
    { v: 'v24', d: '2026-11-20', items: ['The BPUPKH seal is now in the header.', 'Main menu: a Contributors list on the left and a Suggestions panel on the right (suggestions or a Google Drive link with cases).'] },
    { v: 'v23', d: '2026-11-07', items: ['Participant reports: two new graphs, score over time (with the pass line) and number of missed checklist items over time.'] },
    { v: 'v22', d: '2026-11-07', items: ['New case No. 19 (External 2 Batch 1): Cat Shiro, 3.5 years, FLUTD / urolithiasis. Diagnosis, prognosis, therapy, prescription and education were written by AI (labelled); test results and images are from the source.'] },
    { v: 'v21', d: '2026-11-06', items: ['Missing numeric tests added with example values (labelled “Example data created by AI”): CBC for No. 17; Hematologi for No. 16; Kimia darah for Nos. 5, 6, 9, 10, 14. Existing results were not changed.'] },
    { v: 'v20', d: '2026-11-06', items: [
      'Stage 4 now has the examiner’s answer key (scenario & anamnesis, physical exam, diagnostic tests with accessed / not accessed, diagnosis, differential, prognosis, therapy, prescription, education), grouped and collapsed.',
      'Extra checklist: added DO / DON’T items (preparation, asking permission, examination order, explanations, things to avoid). Still not scored.' ] },
    { v: 'v19', d: '2026-11-05', items: [
      'Assessment now follows your teacher’s form: 10 rows scored 1–4, total out of 400, pass at 250 or more (Lulus / Tidak lulus).',
      'Each row’s score is suggested from the ticked items (none = 1, one = 2, some = 3, all = 4); the examiner can set any row by hand (Auto / Skor 1–4).',
      'Sessions saved with the earlier rubric (v15–v18) are kept in History but no longer show assessment scores.' ] },
    { v: 'v18', d: '2026-11-05', items: [
      'Extra checklist (preparation, biosafety & restraint, clinical procedure), kept separate from stations 1–3: not scored, with its own “Belum dilakukan” list in the results and its own most-missed list in participant reports.',
      'Visitor list: name and university are asked once after login and recorded in a Google Sheet; the menu shows how many participants have used OSCE Practice.' ] },
    { v: 'v15', d: '2026-11-05', items: [
      'Optional checklist assessment form (in Indonesian): choose it when starting a session.',
      'Floating, minimizable checklist in stages 2–3, with all stations in collapsible groups.',
      'New stage before the results to finish the checklist; the results show the scores and what was not done.',
      'History: participant reports with average scores and the criteria most often missed, as PDF.' ] },
    { v: 'v14', d: '2026-11-05', items: ['Treatment, prognosis, prescription and education written by AI (cases 14–18) are labelled “Answers created by AI”.'] },
    { v: 'v13', d: '2026-11-05', items: [
      'Stage 2 shows the written result for tests that have no image (for example an ECG); tests with an image still show only the image.',
      'Tests with a specific target now name it (for example “Test kit FIV / FeLV”, “PCR FeLV”).',
      '5 new cases from the 12 April 2026 national try-out (Nos. 14–18); the UNAIR Doberman case was merged into No. 16 as supplementary data.',
      'Missing treatment completed from the Merck/MSD Veterinary Manual and other cited references (see References in each case).' ] },
    { v: 'v12', d: '2026-11-05', items: [
      'Stage 2 lab tables show Increased / Decreased / Normal again, colour-coded next to the reference range (written findings stay hidden).',
      'Every case has a number. Cases you have finished are marked green with a ✓ in the case list and in All questions.' ] },
    { v: 'v11', d: '2026-11-05', items: [
      'Stage 2 shows no written result text; findings and explanations appear only in stage 4 and in All questions.',
      'Stage 2 remembers which supplementary examinations you opened.',
      'Stage 4 now has the same full layout as All questions (scenario, history, every test result, answer key) and marks each test as accessed in stage 2 or not.',
      'History and PDF use the same layout and keep the accessed/not accessed marks.' ] },
    { v: 'v10', d: '2026-11-05', items: ['Image results show only the image during the exam.'] },
    { v: 'v9', d: '2026-11-05', items: [
      'Changelog added.',
      'Enter the participant’s name before a session; the 2-minute reading time starts only after you confirm.',
      'The case text and all physical examination findings are shown in the 2-minute stage, and the case text stays visible in the 15-minute stage.',
      'New “All questions” menu: scenario, physical examination, anamnesis, test results, explanations, diagnosis, prescription and more for every case.',
      'New “History” menu: every finished session in the answer-key layout, with Save as PDF for one session or the whole history.',
      'Image clean-up: device labels, watermarks and test names removed; circles and arrows kept.' ] },
    { v: 'v8', d: '2026-11-05', items: ['Login page and menus in English.'] },
    { v: 'v1–v7', d: '2026-11-04', items: [
      'First release: 4 stages (2 min read, 15 min examiner, 3 min outside the app, answer key) with optional timers and a Skip timer button.',
      'Test results open on their own page; lab results shown as tables with reference ranges and interpretation.',
      '13 cases from the FKH UB simulation and the October 2025 collection; encrypted case database with login.' ] },
  ];

  class DataError extends Error {}
  class AuthError extends Error {}

  /* ---- crypto: PBKDF2-SHA256 -> AES-256-GCM, key from "id:password" (same scheme as the quiz app) ---- */
  const enc = new TextEncoder();
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (u8) => { let o = ''; for (let i = 0; i < u8.length; i += 0x8000) o += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(o); };
  async function deriveKey(id, password, env) {
    const base = await crypto.subtle.importKey('raw', enc.encode(`${id.trim().toLowerCase()}:${password}`), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(env.salt), iterations: env.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  const importKey = (b64) => crypto.subtle.importKey('raw', b64d(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  async function decryptData(env, key) {
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct)); } catch (_) { throw new AuthError('wrong key'); }
    try { return JSON.parse(new TextDecoder().decode(plain)); } catch (_) { throw new DataError(`${DATA_URL} is not valid JSON.`); }
  }
  async function fetchEnvelope() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache', signal: ctrl.signal });
      if (!res.ok) throw new DataError(`Could not load ${DATA_URL} (HTTP ${res.status}).`);
      let env;
      try { env = await res.json(); } catch (_) { throw new DataError(`${DATA_URL} is not valid.`); }
      if (!env || !env.salt || !env.iv || !env.ct || !Number.isInteger(env.iter)) throw new DataError(`${DATA_URL} is not valid.`);
      return env;
    } catch (err) {
      if (err instanceof DataError) throw err;
      if (err && err.name === 'AbortError') throw new DataError('Loading timed out. Check your connection and retry.');
      throw new DataError('Network error while loading cases. Check your connection and retry.');
    } finally { clearTimeout(timer); }
  }
  /** Login key lives in sessionStorage: closing the tab logs out. */
  const sess = {
    get() { try { return window.sessionStorage.getItem(KEY_STORE); } catch (_) { return null; } },
    set(v) { try { window.sessionStorage.setItem(KEY_STORE, v); } catch (_) { /* login just won't survive a reload */ } },
    clear() { try { window.sessionStorage.removeItem(KEY_STORE); } catch (_) { /* ignore */ } },
  };

  /* ---- DOM helpers ---- */
  function h(tag, a, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(a || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f);
      else if (k === 'checked' || k === 'disabled' || k === 'value') el[k] = v; else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (x) => { if (x === null || x === undefined || x === false) return; if (Array.isArray(x)) x.forEach(add); else el.append(x instanceof Node ? x : document.createTextNode(String(x))); };
    kids.forEach(add); return el;
  }
  const mount = (...n) => { app.replaceChildren(...n.flat().filter(Boolean)); window.scrollTo(0, 0); panelSet(false); if (st.user && REGISTRY_URL) { renderBell(); prefetchReports(); kickRemote(); } };
  /* ---- visitors (name + university, kept in a Google Sheet through an Apps Script web app; same idea as Quiz Time) ---- */
  const REGISTRY_URL = String((window.OSCE_CONFIG && window.OSCE_CONFIG.registryUrl) || '');
  const USER_KEY = 'osce.user.v1';
  const UNIVERSITIES = ['IPB', 'UB', 'UGM', 'UNAIR', 'UNDANA', 'UNHAS', 'UNPAD', 'UNUD', 'USK', 'Other'];
  function loadUser() {
    const r = store.read(USER_KEY, null);
    return r && typeof r.id === 'string' && typeof r.name === 'string' && r.name.trim() && typeof r.university === 'string' && r.university.trim()
      ? { id: r.id, name: r.name.trim().slice(0, 60), university: r.university.trim().slice(0, 80) } : null;
  }
  function newDeviceId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* fall through */ }
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const registry = {
    async call(url, init) {
      if (!REGISTRY_URL) return null;
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
      try { const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: 'follow' }); const d = await res.json(); if (d && d.conflict) return { ok: false, conflict: true }; return d && d.ok ? d : null; }
      catch (_) { return null; } finally { clearTimeout(timer); }
    },
    async sync() {
      if (!st.user) return;
      const d = await this.call(REGISTRY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ app: 'osce', id: st.user.id, name: st.user.name, university: st.user.university }) });
      if (d && Number.isInteger(d.count)) setVisitors(d.count);
    },
    async count() {
      const d = await this.call(`${REGISTRY_URL}${REGISTRY_URL.includes('?') ? '&' : '?'}app=osce`, { method: 'GET' });
      if (d && Number.isInteger(d.count)) setVisitors(d.count);
    },
  };
  const visitorsText = () => (st.visitors === null ? '' : `${st.visitors} participant${st.visitors === 1 ? ' has' : 's have'} used OSCE Practice.`);
  function setVisitors(n) { st.visitors = n; const el = document.getElementById('visitors'); if (el) el.textContent = visitorsText(); }
  function userStage(done, canCancel) {
    const err = h('p', { class: 'notice err', role: 'alert', hidden: true });
    const name = h('input', { id: 'user-name', type: 'text', maxlength: '60', autocomplete: 'name', value: st.user ? st.user.name : '' });
    const uni = h('input', { id: 'user-uni', type: 'text', maxlength: '80', list: 'uni-list', autocomplete: 'organization', value: st.user ? st.user.university : '' });
    mount(h('form', {
      class: 'card', id: 'user-form', novalidate: true,
      on: { submit: (e) => {
        e.preventDefault();
        const v = name.value.replace(/\s+/g, ' ').trim(), u = uni.value.replace(/\s+/g, ' ').trim();
        if (v.length < 2) { err.hidden = false; err.textContent = 'Enter your name (at least 2 characters).'; name.focus(); return; }
        if (u.length < 2) { err.hidden = false; err.textContent = 'Enter your university (at least 2 characters).'; uni.focus(); return; }
        st.user = { id: st.user ? st.user.id : newDeviceId(), name: v.slice(0, 60), university: u.slice(0, 80) };
        store.write(USER_KEY, st.user); registry.sync(); done();
      } },
    },
      h('h2', { text: 'Who are you?' }),
      h('p', { class: 'muted', text: 'Your name and university are recorded so the admin knows who has used OSCE Practice.' }),
      h('label', { for: 'user-name', text: 'Name' }), name,
      h('label', { for: 'user-uni', text: 'University' }), uni, h('datalist', { id: 'uni-list' }, UNIVERSITIES.map((u) => h('option', { value: u }))),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', id: 'user-go', text: 'Continue' }), canCancel && h('button', { class: 'btn', type: 'button', id: 'user-cancel', text: 'Cancel', on: { click: home } })),
      h('p', { class: 'muted', id: 'visitors', text: visitorsText() })));
    registry.count(); name.focus();
  }
  const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  /** Bell sound (WebAudio, no files): n strikes, 0.9 s apart. The browser may need one tap on the page before it allows sound. */
  let audioCtx = null;
  function bell(n = 1) {
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      audioCtx = audioCtx || new C(); if (audioCtx.state === 'suspended') audioCtx.resume();
      for (let i = 0; i < n; i++) {
        const t0 = audioCtx.currentTime + i * 0.9;
        [[1, 1, 2.6], [2.76, 0.5, 4], [5.4, 0.25, 7], [8.9, 0.12, 10]].forEach(([r, a, k]) => {
          const o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.type = 'sine'; o.frequency.value = 880 * r;
          g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22 * a, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2 + 1.4 / k * 1.5);
          o.connect(g); g.connect(audioCtx.destination); o.start(t0); o.stop(t0 + 1.8);
        });
      }
    } catch { /* sound is optional */ }
  }

  /* ---- one clock per stage; deadline-based so it keeps running while a test result is open ---- */
  const clk = { tick: null, end: 0, state: 'off', node: null, onDone: null, skipBtn: null };
  function stopClock() { if (clk.tick) clearInterval(clk.tick); clk.tick = null; clk.state = 'off'; clk.node = null; clk.skipBtn = null; }
  function paintClock() {
    if (!clk.node) return;
    if (clk.state === 'run') {
      const left = Math.max(0, Math.ceil((clk.end - Date.now()) / 1000));
      clk.node.textContent = clock(left); clk.node.classList.toggle('low', left <= 60);
    } else if (clk.state === 'done') { clk.node.textContent = 'Time is up'; clk.node.classList.add('low'); }
    else if (clk.state === 'skipped') { clk.node.textContent = 'Timer skipped'; clk.node.classList.remove('low'); }
    if (clk.skipBtn) clk.skipBtn.hidden = clk.state !== 'run';
  }
  /** Pop-up reminder with bell strikes; disappears by itself after a few seconds. */
  function reminder(msg, bells) {
    const old = document.getElementById('reminder'); if (old) old.remove();
    const n = h('div', { class: 'reminder', id: 'reminder', role: 'alert' }, h('strong', { text: msg }), h('button', { class: 'linkbtn', type: 'button', text: 'Close', on: { click: () => n.remove() } }));
    document.body.append(n); bell(bells || 1); setTimeout(() => { if (n.isConnected) n.remove(); }, 8000);
  }
  /** onDone('done') when the time runs out (the app then moves on by itself); onDone('skipped') for Skip timer. `marks` = reminders by seconds left. */
  function startClock(secs, onDone, marks, bells) {
    stopClock(); clk.bells = bells; clk.state = 'run'; clk.end = Date.now() + secs * 1000; clk.onDone = onDone;
    const todo = (marks || []).filter((m) => m.left < secs);
    clk.tick = setInterval(() => {
      if (clk.state === 'run') {
        const left = Math.ceil((clk.end - Date.now()) / 1000);
        while (todo.length && left <= todo[0].left) { const m = todo.shift(); reminder(m.msg, m.bells); }
        if (Date.now() >= clk.end) { clk.state = 'done'; const f = clk.onDone; stopClockKeepNode(); bell(clk.bells || 4); f('done'); return; }
      }
      paintClock();
    }, 250);
  }
  /** Time is up: stop ticking but keep the node so it reads “Time is up” until the next stage replaces it. */
  function stopClockKeepNode() { if (clk.tick) clearInterval(clk.tick); clk.tick = null; paintClock(); }
  function skipClock() { if (clk.state !== 'run') return; clk.state = 'skipped'; clk.onDone('skipped'); paintClock(); }
  function timerBlock() {
    const node = h('div', { class: 'timer', id: 'timer' });
    const skip = h('button', { class: 'btn', id: 'skip', text: 'Skip timer', on: { click: skipClock } });
    clk.node = node; clk.skipBtn = skip; paintClock();
    return h('div', {}, node, h('div', { class: 'row center' }, skip));
  }

  const cur = () => st.byId.get(st.caseId);
  const stageTotal = () => (st.assessOn ? 4 : 3);
  const stage = (n, label) => h('p', { class: 'stage', text: `Stage ${n} of ${stageTotal()} · ${label}` });
  const lines = (arr) => h('ul', {}, (arr || []).map((x) => h('li', { text: x })));

  /* ---- BPUPKH side panels: contributors (left) and suggestions / Drive links (right) ---- */
  function contribCard() {
    const list = Array.isArray(window.BPUPKH_CONTRIBUTORS) ? window.BPUPKH_CONTRIBUTORS.filter((c) => c && c.name) : [];
    return h('section', { class: 'card side-card', id: 'contributors' },
      h('h2', { text: 'Contributors' }),
      list.length
        ? h('ul', { class: 'contrib-list' }, list.map((c) => h('li', {}, h('b', { text: String(c.name) }), (c.role || c.uni) && h('span', { text: [c.role, c.uni].filter(Boolean).join(' · ') }))))
        : h('p', { class: 'muted', text: 'Contributors will be listed here. Want to be one? Send a suggestion or a Google Drive link on the right.' }));
  }
  let lastSuggest = 0;
  function suggestCard(send, who) {
    const kind = h('select', { id: 'sug-kind' }, h('option', { value: 'Suggestion', text: 'Suggestion' }), h('option', { value: 'Contribution', text: 'Contribution: Google Drive link' }));
    const link = h('input', { id: 'sug-link', type: 'text', maxlength: '400', autocomplete: 'off', placeholder: 'https://drive.google.com/…' });
    const msg = h('textarea', { id: 'sug-msg', maxlength: '1500', placeholder: 'Your suggestion, or a short note about the files (questions and answer keys, source, university).' });
    const note = h('p', { class: 'notice', id: 'sug-note', role: 'status', hidden: true });
    const btn = h('button', { class: 'btn primary', type: 'submit', id: 'sug-send', text: 'Send' });
    const say = (type, text) => { note.hidden = false; note.className = `notice ${type}`; note.textContent = text; };
    return h('form', {
      class: 'card side-card sug-form', id: 'suggestions', novalidate: true,
      on: {
        submit: async (e) => {
          e.preventDefault();
          const url = link.value.trim(); const text = msg.value.trim();
          if (url && !/^https:\/\/(drive|docs)\.google\.com\/\S+$/i.test(url)) return say('err', 'The link must be a Google Drive or Google Docs link (https://drive.google.com/…).');
          if (kind.value === 'Contribution' && !url) return say('err', 'Paste the Google Drive link with your questions and answer keys.');
          if (!url && text.length < 5) return say('err', 'Write your suggestion first (at least 5 characters).');
          if (Date.now() - lastSuggest < 30000) return say('err', 'Please wait a few seconds before sending another one.');
          btn.disabled = true; say('ok', 'Sending…');
          const res = await send({ action: 'suggest', sender: who(), kind: kind.value, link: url, message: text });
          btn.disabled = false;
          if (res === 'nourl') return say('err', 'Suggestions are not available: this site is not connected to the Google Sheet.');
          if (!res) return say('err', 'Could not send. Check your connection and try again.');
          lastSuggest = Date.now(); link.value = ''; msg.value = ''; say('ok', 'Thank you! Your message was sent.');
        },
      },
    },
    h('h2', { text: 'Suggestions' }),
    h('p', { class: 'muted', text: 'Send a suggestion, or share a Google Drive link with questions and answer keys. Set the link to “Anyone with the link can view”.' }),
    h('label', { for: 'sug-kind', text: 'Type' }), kind,
    h('label', { for: 'sug-link', text: 'Google Drive link (optional for suggestions)' }), link,
    h('label', { for: 'sug-msg', text: 'Message' }), msg,
    h('div', { class: 'form-actions' }, btn), note);
  }
  const bpupkhShell = (nodes, left, right) => h('div', { class: 'shell' }, h('aside', { class: 'left' }, left), h('div', { class: 'mainCol' }, nodes), h('aside', { class: 'right' }, right));

  /* ---- back up progress: the exam history lives in this browser only ---- */
  const PROGRESS_FORMAT = 'osce-practice-progress';
  const histKey = (e) => `${e.t}|${e.id}|${e.name}`;
  function exportProgress() {
    const data = { app: PROGRESS_FORMAT, v: 1, exportedAt: new Date().toISOString(), history: loadHist() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `osce-progress-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function importProgress(text, replace) {
    let d; try { d = JSON.parse(text); } catch (_) { return { ok: false, message: 'That file is not valid JSON.' }; }
    if (!d || d.app !== PROGRESS_FORMAT || !Array.isArray(d.history)) return { ok: false, message: 'This is not an OSCE Practice progress file.' };
    const good = d.history.filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.t) && typeof e.name === 'string');
    const base = replace ? [] : loadHist();
    const known = new Set(base.map(histKey));
    const add = []; for (const e of good) { const k = histKey(e); if (!known.has(k)) { known.add(k); add.push(e); } }
    const all = base.concat(add).sort((a, b) => a.t - b.t);
    if (!saveHist(all)) return { ok: false, message: 'Could not save: browser storage is unavailable.' };
    return { ok: true, message: `Imported ${add.length} session${add.length === 1 ? '' : 's'}${good.length - add.length ? ` (${good.length - add.length} already present)` : ''}. History now has ${Math.min(all.length, HIST_MAX)}.` };
  }
  function backupCard(onDone, initial) {
    const note = h('p', { class: 'notice', role: 'status', hidden: true });
    const say = (type, text) => { note.hidden = false; note.className = `notice ${type === 'err' ? 'err' : ''}`; note.textContent = text; };
    if (initial) say('ok', initial);
    const replace = h('input', { id: 'pg-replace', type: 'checkbox' });
    const fileIn = h('input', { id: 'pg-file', type: 'file', accept: '.json,application/json', on: { change: () => {
      const f = fileIn.files && fileIn.files[0]; if (!f) return;
      if (replace.checked && !window.confirm('Replace all current history with the backup?')) { fileIn.value = ''; return; }
      const r = new FileReader();
      r.onload = () => { const res = importProgress(String(r.result), replace.checked); say(res.ok ? 'ok' : 'err', res.message); fileIn.value = ''; if (res.ok && onDone) onDone(res.message); };
      r.onerror = () => say('err', 'Could not read that file.'); r.readAsText(f);
    } } });
    return h('section', { class: 'card', id: 'backup' }, h('h2', { text: 'Back up your progress' }),
      h('p', { class: 'muted', text: 'Your history (finished cases, scores and participant reports) is stored in this browser only. Export it to keep a copy or move to another device, then import it there.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', id: 'pg-export', text: 'Export progress', on: { click: exportProgress } })),
      h('label', { for: 'pg-file', text: 'Import progress (.json)' }), fileIn,
      h('label', { class: 'chk', for: 'pg-replace' }, replace, h('span', { text: 'Replace current history instead of merging' })), note);
  }

  /* ---- 0. setup ---- */
  function home(msg) {
    stopClock();
    const sources = [...new Set(st.cases.map((c) => c.source))];
    const srcSel = h('select', { id: 'source' }, h('option', { value: '', text: 'All sources' }), sources.map((s) => h('option', { value: s, text: s })));
    srcSel.value = st.source;
    const caseSel = h('select', { id: 'case' });
    const done = doneIds();
    const pool = () => st.cases.filter((c) => !srcSel.value || c.source === srcSel.value);
    const fill = () => { st.source = srcSel.value; caseSel.replaceChildren(...pool().map((c) => h('option', { value: c.id, class: done.has(c.id) ? 'acc' : null, text: `${done.has(c.id) ? '✓ ' : ''}No. ${numOf(c)} · [${c.source}] ${c.title}` }))); };
    srcSel.addEventListener('change', fill); fill();
    const tm = h('input', { id: 'timer-on', type: 'checkbox', checked: st.timerOn });
    const as = h('input', { id: 'assess-on', type: 'checkbox', checked: st.assessOn });
    const go = (id) => { st.timerOn = tm.checked; st.assessOn = as.checked; nameStage(id); };
    const sendSug = async (body) => (REGISTRY_URL ? registry.call(REGISTRY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, app: 'osce' }) }) : 'nourl');
    mount(bpupkhShell([
      tabBar('all'),
      h('section', { class: 'card' },
        h('h2', { text: 'Start an OSCE case' }),
        st.user && h('p', { class: 'muted', id: 'user-line' }, `Signed in as ${st.user.name} (${st.user.university}). `, h('button', { class: 'linkbtn', type: 'button', id: 'change-user', text: 'Change name / university', on: { click: () => userStage(home, true) } })),
        st.user && h('p', { class: 'muted', id: 'device-line' }, 'Device ID: ', h('code', { text: st.user.id }), ' ', h('button', { class: 'linkbtn', type: 'button', id: 'copy-device', text: 'Copy', on: { click: () => { try { navigator.clipboard.writeText(st.user.id); } catch (_) { /* ignore */ } } } }), isAdmin() && ' · Admin'),
        h('p', { class: 'muted', id: 'visitors', text: visitorsText() }),
        h('p', { class: 'muted', text: `${st.cases.length} cases. Two people: the examiner operates the app, the examinee reads the case on screen first.` }),
        h('div', { class: 'sel' }, h('label', { for: 'source', text: 'Source:' }), srcSel),
        h('div', { class: 'sel' }, h('label', { for: 'case', text: 'Case:' }), caseSel),
        h('label', { class: 'chk', for: 'timer-on' }, tm, h('span', { text: 'Use timers (2 min read · 18 min examiner stage with reminders at 10, 5 and 3 minutes left; the next stage opens by itself when time is up)' })),
        h('label', { class: 'chk', for: 'assess-on' }, as, h('span', { text: 'Use the checklist assessment form (floating checklist in stage 2, completed in an extra stage, with scores in the results)' })),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', id: 'start', text: 'Start selected case', on: { click: () => go(caseSel.value) } }),
          h('button', { class: 'btn', id: 'solo', text: 'Single-player mode', title: 'Do the selected case on your own, without an examiner', on: { click: () => window.OSCE_SOLO && window.OSCE_SOLO.start(caseSel.value) } }),
          h('button', { class: 'btn', id: 'random', text: 'Random case', on: { click: () => { const p = pool(); go(p[Math.floor(Math.random() * p.length)].id); } } }),
          h('button', { class: 'btn', id: 'logout', text: 'Log out', on: { click: () => { sess.clear(); window.location.reload(); } } }))),
      h('section', { class: 'card' }, h('h2', { text: 'Browse' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', id: 'all-q', text: `All questions (${st.cases.length})`, on: { click: () => questions() } }),
          h('button', { class: 'btn', id: 'hist', text: `History (${loadHist().length})`, on: { click: () => history() } }))),
      backupCard((m) => home(m), typeof msg === 'string' ? msg : ''),
      h('section', { class: 'card', id: 'changelog' }, h('h2', { text: 'Changelog' }),
        CHANGELOG.map((e, i) => h('details', { class: 'cl', open: i === 0 }, h('summary', {}, h('strong', { text: e.v }), ` · ${e.d}`), lines(e.items))))],
      contribCard(), suggestCard(sendSug, () => (st.user ? `${st.user.name} (${st.user.university})` : 'Unknown'))));
  }

  /* ---- 0b. participant name; the 2-minute clock starts only after this is confirmed ---- */
  function nameStage(id) {
    stopClock();
    const err = h('p', { class: 'notice err', role: 'alert', hidden: true });
    const names = [...new Set(loadHist().map((e) => e.name))];
    const name = h('input', { id: 'p-name', type: 'text', maxlength: '60', autocomplete: 'off', list: 'p-names', value: st.name });
    mount(h('form', {
      class: 'card', id: 'name-form', novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          const v = name.value.replace(/\s+/g, ' ').trim();
          if (v.length < 2) { err.hidden = false; err.textContent = 'Enter the participant’s name (at least 2 characters).'; name.focus(); return; }
          st.name = v.slice(0, 60); store.write(NAME_KEY, st.name);
          st.caseId = id; st.reveal = false; st.entry = null; st.opened = new Set(); st.chk = new Set(); st.xchk = new Set(); st.ovr = {}; if (st.assessOn) panelBuild();
          briefStage();
        },
      },
    },
      h('h2', { text: 'Participant' }),
      h('p', { class: 'muted', text: st.timerOn ? 'Enter the examinee’s name. The 2-minute reading time starts when you confirm.' : 'Enter the examinee’s name, then confirm to show the case.' }),
      h('label', { for: 'p-name', text: 'Name' }), name, h('datalist', { id: 'p-names' }, names.map((x) => h('option', { value: x }))), err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', id: 'name-go', text: 'Confirm and start' }), h('button', { class: 'btn', type: 'button', id: 'name-cancel', text: 'Cancel', on: { click: home } }))));
    name.focus();
  }

  /* ---- 1. examinee reads the case (2 min) ---- */
  function briefStage() {
    const c = cur();
    const next = h('button', { class: 'btn primary', id: 'next1', text: 'Next →', hidden: st.timerOn, on: { click: () => examStage() } });
    if (st.timerOn) startClock(T.brief, (why) => { if (why === 'done') examStage(); else next.hidden = false; }, null, 2); else stopClock();
    mount(
      stage(1, 'Examinee reads the case'),
      h('section', { class: 'card' },
        h('h2', { text: 'Case' }), st.timerOn && timerBlock(),
        scenario(c),
        h('div', { class: 'row' }, next, h('button', { class: 'btn', text: 'Cancel', on: { click: home } }))));
  }

  /* ---- 2. examiner stage (15 min) ---- */
  const INTERP_CLASS = { Increased: 'up', Decreased: 'down', Positive: 'up', Normal: 'ok' };
  /** Lab table with the interpretation (Increased / Decreased / Normal) colour-coded next to the reference range. */
  function resultTable(rows) {
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'lab' },
      h('thead', {}, h('tr', {}, ['Parameter', 'Result', 'Reference range', 'Interpretation'].map((x) => h('th', { text: x })))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.slice(0, 4).map((v, i) => h('td', { text: v, class: (i === 3 || i === 1) ? INTERP_CLASS[r[3]] || '' : '' })))))),
      h('p', { class: 'muted', text: 'Reference ranges are general values. Figures are example values for practice.' }));
  }
  /** Exam view: table, image, or (when the test has no image) the written result. `full` (stage 4, All questions) also shows the finding and explanation. */
  const resultBody = (x, full) => {
    const hasImg = !!(x.images && x.images.length);
    const any = (x.quote && x.quote.length) || x.text || x.table || hasImg || x.finding;
    return [
      (x.quote || []).map((q) => h('p', { class: 'result-text quote', text: q })),
      x.text && h('p', { class: 'result-text', text: x.text }),
      x.table && resultTable(x.table),
      (x.images || []).map((im) => h('figure', {}, h('img', { src: im.src, alt: x.label }))),
      !full && !hasImg && x.finding && h('p', { class: 'result-text', text: x.finding }),
      !full && !any && h('p', { class: 'muted', text: 'No result data for this test yet.' }),
      full && x.finding && h('p', { class: 'result-text', text: `Finding: ${x.finding}` }),
      full && x.explain && h('p', { class: 'muted', text: `Interpretation: ${x.explain}` }),
    ];
  };
  const PE = 'Pemeriksaan fisik';
  const aiTest = (x) => (x.ai ? h('span', { class: 'badge ai', text: 'Example data created by AI' }) : null);
  const numOf = (c) => c.no || st.cases.indexOf(c) + 1;
  const doneIds = () => new Set(loadHist().map((e) => e.id)); // cases already finished (green)
  const peOf = (c) => c.tests.find((t) => t.label === PE);
  const otherTests = (c) => c.tests.filter((t) => t.label !== PE);
  /** Case text plus every physical examination finding (shown in stages 1 and 2). */
  function scenario(c) {
    const pe = peOf(c);
    return [h('p', { class: 'problem', id: 'problem', text: c.brief.text }),
      pe && h('div', { class: 'pe', id: 'pe' }, h('h3', { text: 'Physical examination' }), (pe.quote || []).map((q) => h('p', { class: 'problem', text: q })))];
  }
  function testView(x) {
    st.opened.add(x.label);
    mount(
      h('div', { class: 'row' }, h('button', { class: 'btn', id: 'back', text: '← Back to examiner view', on: { click: () => examStage(true) } })),
      h('section', { class: 'card', id: 'result' }, h('h2', {}, x.label, aiTest(x)), resultBody(x)));
    panelSet(true); panelMinimize();
  }
  function examStage(resume) {
    const c = cur();
    if (resume !== true) { if (st.timerOn) startClock(T.exam, (why) => { if (why === 'done') afterExam(); }, REMINDERS, 4); else stopClock(); st.reveal = false; }
    const reveal = h('input', { id: 'reveal', type: 'checkbox', checked: st.reveal });
    const ans = h('div', { id: 'answer' });
    const paint = () => {
      if (reveal.checked) ans.replaceChildren(h('p', {}, h('strong', { text: 'Diagnosis: ' }), c.diagnosis), h('strong', { text: 'Treatment:' }), lines(c.treatment));
      else ans.replaceChildren('Diagnosis and treatment are hidden.');
      ans.className = reveal.checked ? '' : 'hidden-box';
    };
    reveal.addEventListener('change', () => { st.reveal = reveal.checked; paint(); });
    paint();
    mount(
      stage(2, 'Examiner (18 min)'),
      h('section', { class: 'card' }, h('h2', { text: `No. ${numOf(c)} · ${c.title}` }), st.timerOn && timerBlock(),
        h('p', { class: 'muted', text: 'You answer the examinee’s history-taking questions using the expected responses below.' }),
        c.incomplete && h('p', { class: 'notice', text: 'This source case is incomplete (no history answers, test results or prescription).' })),
      h('section', { class: 'card', id: 'question' }, h('h2', { text: 'Case' }), scenario(c)),
      h('section', { class: 'card' }, h('h2', { text: 'Expected anamnesis answers' }),
        c.anamnesis.length ? c.anamnesis.map((x) => h('div', { class: 'qa' }, h('div', { class: 'q', text: x.q }), h('div', { text: x.a })))
          : h('p', { class: 'muted', text: 'No anamnesis answers in the source.' })),
      h('section', { class: 'card' }, h('h2', { text: 'Diagnostic results' }),
        h('p', { class: 'muted', text: 'Give these only when the examinee asks for the test. Each opens on its own page.' }),
        h('div', { class: 'links' }, otherTests(c).map((x) => h('button', { class: 'linkbtn', text: x.label + ((x.images || []).length ? ' (image)' : '') + (x.table ? ' (table)' : '') + (st.opened.has(x.label) ? ' ✓' : ''), on: { click: () => testView(x) } })))),
      h('section', { class: 'card' }, h('h2', { text: 'Answer key' }),
        h('label', { class: 'chk', for: 'reveal' }, reveal, h('span', { text: 'Show diagnosis and treatment' })), ans),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'next2', text: st.assessOn ? 'Next: complete the assessment →' : 'Finish', on: { click: afterExam } })));
    panelSet(true);
  }

  /* the 18-minute stage ends (button or time up): on to the assessment form, or straight to the results */
  function afterExam() { stopClock(); if (st.assessOn) assessStage(); else end(); }

  /* ---- checklist assessment: the teacher's form (Form/Rubrik Penilaian; 10 rows, score 1–4, total 400, pass ≥ 250). Items stay in Indonesian. ---- */
  const cnt = (a, set) => a.items.filter((i) => set.has(i.id)).length;
  /** Teacher's definition: 1 none · 2 exactly one indicator · 3 some · 4 all. */
  const autoScore = (a, set) => { if (a.sc) return a.sc(a.items.map((i) => set.has(i.id))); const k = cnt(a, set), n = a.items.length; return k === 0 ? 1 : k === n ? 4 : k === 1 ? 2 : 3; };
  /** unit = points per score step (row max = unit × 4); pct = the weight printed on the form. */
  const R = (no, name, pct, unit, items, sc) => ({ id: `r${no}`, no, name, pct, unit, sc, items: items.map((t, i) => ({ id: `${no}.${i + 1}`, t })) });
  const OLD_ASSESS = [
    { id: 'S1', title: 'St.1 Komunikasi Profesional (30%)', aspects: [
      R(1, 'Salam dan perkenalan kepada klien', 10, 10, ['Mengucapkan salam kepada klien', 'Memperkenalkan diri sebagai dokter hewan', 'Bersikap/attitude yang sangat baik (ramah, kontak mata, empati)']),
      R(2, 'Perilaku profesional dan informed consent', 10, 10, ['Menunjukkan perilaku profesional', 'Melibatkan klien dalam pengambilan keputusan/informed consent', 'Bertindak sesuai prioritas', 'Memperhatikan kenyamanan klien dan pasien', 'Melakukan tindakan secara legeartis']),
      R(3, 'Saran dan edukasi kepada klien', 10, 10, ['Memberikan saran kepada klien', 'Memberikan edukasi kepada klien', 'Bersikap profesional', 'Melakukan setiap tindakan secara teliti'])] },
    { id: 'S2', title: 'St.2 Diagnosa Klinik (50%)', aspects: [
      R(4, 'Anamnesis', 5, 5, ['Keluhan utama klien', 'Riwayat penyakit', 'Riwayat pengobatan', 'Status vaksinasi']),
      R(5, 'Pemeriksaan fisik', 10, 10, ['Sesuai masalah klinis pasien', 'Runut', 'Sistematis', 'Legeartis']),
      R(6, 'Pemeriksaan penunjang dan interpretasi', 15, 10, ['Menentukan jenis pemeriksaan penunjang yang sesuai (rontgen, USG, EKG, mikroskopis, hematologi, kimia darah, kit tes)', 'Pemeriksaan penunjang menunjang diagnosis definitif', 'Menginterpretasi hasilnya dengan benar']),
      R(7, 'Diagnosis banding', 10, 5, ['Menyebutkan diagnosis banding yang sesuai', 'Menyebutkan lebih dari satu diagnosis banding', 'Menegakkan diagnosis banding untuk menetapkan diagnosis definitif']),
      R(8, 'Diagnosis definitif dan prognosa', 10, 20, ['Menegakkan diagnosis definitif dengan benar', 'Menentukan prognosa dengan benar'])] },
    { id: 'S3', title: 'St.3 Reseptir & Terapeutik (20%)', aspects: [
      R(9, 'Resep', 15, 15, ['Tepat indikasi', 'Tepat dosis', 'Tepat sediaan', 'Tepat cara pemberian']),
      R(10, 'Ambulator', 5, 5, ['Anamnesis', 'Status present', 'Pemeriksaan fisik', 'Pemeriksaan penunjang'])] },
  ];
  const ASSESS = [
    { id: 'S1', title: 'St.1 Komunikasi Profesional (20%)', aspects: [
      R(1, 'Komunikasi dan/atau edukasi klien', 10, 10, ['Membina hubungan baik dengan klien secara verbal dan non verbal (ramah, terbuka, kontak mata, salam, empati, komunikasi 2 arah, respon)', 'Memberi kesempatan klien bercerita dan mengarahkan cerita', 'Melibatkan klien dalam membuat keputusan dan pemeriksaan klinik (informed consent)', 'Memberikan edukasi kepada klien sesuai dengan masalah pasien']),
      R(2, 'Perilaku profesional', 10, 10, ['Meminta izin secara lisan', 'Melakukan setiap tindakan dengan berhati-hati dan teliti sehingga tidak membahayakan pasien dan diri sendiri', 'Memperhatikan kenyamanan pasien', 'Melakukan tindakan sesuai prioritas', 'Menunjukkan rasa sayang/welfare kepada pasien', 'Mengetahui keterbatasan dengan merujuk atau melakukan konsultasi bila diperlukan'],
        (b) => { const p = b.slice(1).filter(Boolean).length; return !b[0] ? (p ? 2 : 1) : p <= 2 ? 2 : p <= 4 ? 3 : 4; })] },
    { id: 'S2', title: 'St.2 Diagnosa Klinik (50%)', aspects: [
      R(3, 'Anamnesa', 10, 10, ['Menanyakan keluhan utama', 'Riwayat penyakit sekarang', 'Riwayat pengobatan sebelumnya', 'Riwayat penyakit terdahulu'],
        (b) => { const p = b.slice(1).filter(Boolean).length; return !b[0] ? 1 : p <= 1 ? 2 : p === 2 ? 3 : 4; }),
      R(4, 'Pemeriksaan fisik', 10, 10, ['Pemeriksaan fisik sesuai masalah klinik pasien', 'Menggunakan teknik yang benar', 'Sistematis dan legeartis'],
        (b) => (!b[0] ? 1 : !b[1] ? 2 : !b[2] ? 3 : 4)),
      R(5, 'Interpretasi hasil pemeriksaan penunjang', 15, 15, ['Mengusulkan pemeriksaan penunjang kepada klien', 'Pemeriksaan penunjang yang diusulkan benar sesuai dengan skenario', 'Interpretasi hasil dengan tepat'],
        (b) => (!b[0] ? 1 : !b[1] ? 2 : !b[2] ? 3 : 4)),
      R(6, 'Diagnosa dan diagnosa banding', 5, 5, ['Menetapkan diagnosa dengan benar', 'Menetapkan 1 diagnosa banding dengan benar', 'Menentukan lebih dari 1 diagnosa banding dengan benar'],
        (b) => { const dd = b[1] || b[2]; return b[0] && b[2] ? 4 : b[0] && dd ? 3 : b[0] || dd ? 2 : 1; }),
      R(7, 'Ambulator', 10, 10, ['Anamnesis', 'Status present', 'Pemeriksaan fisik', 'Pemeriksaan penunjang'])] },
    { id: 'S3', title: 'St.3 Reseptir & Terapeutik (30%)', aspects: [
      R(8, 'Pemilihan obat', 20, 20, ['Memilih obat dengan tepat sesuai indikasi', 'Menentukan bentuk sediaan obat dengan tepat', 'Menetapkan dosis dengan tepat'],
        (b) => (!b[0] ? 1 : 2 + (b[1] ? 1 : 0) + (b[2] ? 1 : 0))),
      R(9, 'Penulisan resep', 10, 10, ['Identitas pasien dan klien', 'Komponen obat', 'Instruksi pemberian obat', 'Identitas dokter pemberi resep'])] },
  ];
  /** Rubrics by form number: 2 = first teacher form (kept so old history still reads), 3 = Kertas Kerja Penilai OSCE UKMPPDH 2025 (current). */
  const FORMS = { 2: { ASSESS: OLD_ASSESS }, 3: { ASSESS } };
  Object.values(FORMS).forEach((f) => { f.ALL = f.ASSESS.flatMap((S) => S.aspects.flatMap((a) => a.items.map((i) => ({ ...i, S, a })))); });
  const FORM_NOW = 3;
  const PASS_OF = { 2: 250, 3: 250 }; const MAX_OF = { 2: 400, 3: 400 };
  const PASS = PASS_OF[FORM_NOW]; const MAXS = MAX_OF[FORM_NOW];
  /* items of the extra checklist that the 2025 rubric already covers (removed; ids stay index-based) */
  const DROPPED = new Set(['x2.3', 'x4.4', 'x4.5', 'x4.6', 'x5.2', 'x5.3', 'x5.4', 'x5.7', 'x5.8', 'x5.10', 'x6.2']);
  /* extra checklist: kept apart from the rubric (not scored, not part of stations 1–3); items already in the rubric are left out */
  const EXTRA = { title: 'Cek tambahan (di luar penilaian)', groups: [
    { id: 'x1', name: '1. Persiapan & Komunikasi Awal', items: [
      { t: 'Membaca skenario kasus dan instruksi tugas di pintu stase', hint: 'Perhatikan batas waktu dan fokus perintah (misal: lakukan anamnesis saja atau sampai terapi)' },
      { t: 'Mengonfirmasi sinyalemen pasien', hint: 'Tanyakan nama hewan, spesies, ras, umur, jenis kelamin, dan bobot badan' }] },
    { id: 'x2', name: '2. Biosafety & Restraint Pasien', items: [
      { t: 'Melakukan cuci tangan 6 langkah WHO (hand hygiene)', hint: 'Lepaskan jam tangan/perhiasan dan gunakan handrub atau sabun sebelum kontak pasien' },
      { t: 'Mengenakan Alat Pelindung Diri (APD) sesuai kebutuhan stase', hint: 'Sarung tangan (handscoon), masker, jas lab, atau apron timbal di stase radiologi' },
      { t: 'Melakukan handling dan restraint yang aman bagi hewan serta pemeriksa', hint: 'Pastikan posisi hewan stabil dan minim stres sebelum memulai prosedur medis' }] },
    { id: 'x3', name: '3. Eksekusi Tindakan Klinis', items: [
      { t: 'Menyiapkan alat dan bahan medis secara aseptis', hint: 'Periksa kelengkapan instrumen, tanggal kedaluwarsa obat, dan sterilitas alat' },
      { t: 'Melakukan prosedur klinis secara sistematis sesuai SOP stase', hint: 'Sampaikan tindakan atau temuan klinis secara verbal kepada penguji bila diminta' }] },
    { id: 'x4', name: 'DO · Persiapan & komunikasi', items: [
      { t: 'Menyiapkan pulpen dan papan jalan' },
      { t: 'Menanyakan identitas owner' },
      { t: 'Meminta waktu sebentar ke owner untuk membaca form rekam medis dan menyusun urutan pengisian' },
      { t: 'Selalu meminta izin owner sebelum melakukan sesuatu ke hewan', hint: 'Sebelum menimbang, mengukur suhu, dan mengambil sampel untuk pemeriksaan penunjang' },
      { t: 'Ramah dan tersenyum, menunjukkan kasih sayang kepada hewan (walau hanya boneka)' },
      { t: 'Sebelum menyudahi konsultasi, menanyakan apakah owner ada yang ingin ditanyakan' }] },
    { id: 'x5', name: 'DO · Urutan pemeriksaan & penjelasan', items: [
      { t: 'Anamnesis selengkap-lengkapnya dulu, baru pemeriksaan fisik' },
      { t: 'Pemeriksaan fisik berurutan: inspeksi, palpasi, auskultasi' },
      { t: 'Pemeriksaan fisik menyeluruh dari kepala sampai anus, walau keluhan hanya di beberapa bagian' },
      { t: 'Handling halus, memperlakukan boneka seperti hewan sungguhan' },
      { t: 'Menjelaskan diagnosis diferensial dulu sebelum pemeriksaan penunjang' },
      { t: 'Pemeriksaan penunjang dilakukan di meja pemeriksaan' },
      { t: 'Meminta hasil pemeriksaan penunjang yang spesifik dan lengkap', hint: 'Misal hematologi lengkap atau kimia darah, bukan hanya "cek darah"' },
      { t: 'Meminta hasil pemeriksaan darah dulu sebelum test kit apa pun' },
      { t: 'Menjelaskan prognosis kepada owner' },
      { t: 'Bila penyakit zoonotik, mengedukasi klien tentang zoonosis' }] },
    { id: 'x6', name: 'DON’T · centang bila TIDAK dilakukan', items: [
      { t: 'Tidak memakai nama alias saat perkenalan' },
      { t: 'Tidak meninggalkan hewan sendirian di meja pemeriksaan' },
      { t: 'Tidak menjelaskan kondisi hewan sambil berdiri di depan meja klien' },
      { t: 'Tidak memainkan pulpen di depan owner' },
      { t: 'Tidak menanyakan sinyalemen yang tidak perlu', hint: 'Bila tidak ada datanya, sebutkan saja sesuai bonekanya' }] },
  ].map((g) => ({ ...g, items: g.items.map((it, i) => ({ ...it, id: `${g.id}.${i + 1}` })).filter((it) => !DROPPED.has(it.id)) })) };
  EXTRA.items = EXTRA.groups.flatMap((g) => g.items.map((i) => ({ ...i, g })));
  const ALL_ITEMS = FORMS[FORM_NOW].ALL;
  const num1 = (x) => (Math.round(x * 10) / 10).toString();
  /** Score per row 1–4: from the ticked items unless the examiner set it by hand (`ovr`: row id → 1–4). Points = unit × score; total out of 400. */
  function compute(set, ovr, form) {
    const stations = FORMS[form || FORM_NOW].ASSESS.map((S) => {
      const aspects = S.aspects.map((a) => { const manual = ovr && ovr[a.id]; const score = manual || autoScore(a, set); return { a, score, manual: !!manual, earned: a.unit * score }; });
      return { S, aspects, earned: aspects.reduce((t, x) => t + x.earned, 0), max: S.aspects.reduce((t, a) => t + a.unit * 4, 0) };
    });
    const earned = stations.reduce((t, x) => t + x.earned, 0);
    return { stations, earned, max: stations.reduce((t, x) => t + x.max, 0), pass: earned >= PASS_OF[form || FORM_NOW], passMark: PASS_OF[form || FORM_NOW] };
  }
  /** The station groups with checkboxes. `live` keeps the state in st.chk and updates every open checklist. */
  const chkRoots = [];
  function checklistNode() {
    const sums = [];
    const root = h('div', { class: 'chk-list' }, ASSESS.map((S) => {
      const sum = h('span', { class: 'muted' }); sums.push([S, sum]);
      return h('details', { class: 'chk-st' }, h('summary', {}, h('strong', { text: S.title }), ' ', sum),
        S.aspects.map((a) => { const b = h('span', { class: 'badge' }); sums.push([a, b]);
          const sel = h('select', { class: 'ovr', 'data-ovr': a.id, 'aria-label': `Skor manual ${a.name}`, on: { change: (e) => { if (e.target.value) st.ovr[a.id] = Number(e.target.value); else delete st.ovr[a.id]; chkRefresh(); } } }, h('option', { value: '', text: 'Auto' }), [1, 2, 3, 4].map((n) => h('option', { value: String(n), text: `Skor ${n}` })));
          return h('div', { class: 'chk-asp' }, h('h4', {}, `${a.no}. ${a.name} `, b, ' ', sel),
            a.items.map((it) => h('label', { class: 'chk-it' }, h('input', { type: 'checkbox', 'data-id': it.id, checked: st.chk.has(it.id), on: { change: (e) => { if (e.target.checked) st.chk.add(it.id); else st.chk.delete(it.id); chkRefresh(); } } }), h('span', { text: it.t }))));
        }));
    }));
    const xsum = h('span', { class: 'muted' });
    root.append(h('details', { class: 'chk-st chk-extra' }, h('summary', {}, h('strong', { text: EXTRA.title }), ' ', xsum),
      EXTRA.groups.map((g) => h('div', { class: 'chk-asp' }, h('h4', { text: g.name }),
        g.items.map((it) => h('label', { class: 'chk-it' }, h('input', { type: 'checkbox', 'data-x': it.id, checked: st.xchk.has(it.id), on: { change: (e) => { if (e.target.checked) st.xchk.add(it.id); else st.xchk.delete(it.id); chkRefresh(); } } }),
          h('span', {}, it.t, it.hint && h('span', { class: 'hint', text: it.hint }))))))));
    root.refresh = () => {
      xsum.textContent = `· tidak dinilai · ${st.xchk.size}/${EXTRA.items.length} dicentang`;
      root.querySelectorAll('input[data-x]').forEach((i) => { i.checked = st.xchk.has(i.dataset.x); });
      const r = compute(st.chk, st.ovr);
      for (const [o, el] of sums) {
        if (o.aspects) { const x = r.stations.find((y) => y.S === o); el.textContent = `· ${o.aspects.reduce((t, a) => t + cnt(a, st.chk), 0)}/${o.aspects.reduce((t, a) => t + a.items.length, 0)} ticked · ${num1(x.earned)}/${x.max}`; }
        else { const x = r.stations.flatMap((y) => y.aspects).find((y) => y.a === o); el.textContent = `Skor ${x.score}/4${x.manual ? ' (manual)' : ''}`; }
      }
      root.querySelectorAll('input[data-id]').forEach((i) => { i.checked = st.chk.has(i.dataset.id); });
      root.querySelectorAll('select[data-ovr]').forEach((i) => { i.value = st.ovr[i.dataset.ovr] ? String(st.ovr[i.dataset.ovr]) : ''; });
    };
    chkRoots.push(root); root.refresh(); return root;
  }
  function chkRefresh() {
    for (let i = chkRoots.length - 1; i >= 0; i--) { if (!chkRoots[i].isConnected) chkRoots.splice(i, 1); else chkRoots[i].refresh(); }
    const t = document.getElementById('chk-total');
    if (t) t.textContent = `${num1(compute(st.chk, st.ovr).earned)}/${MAXS} · ${st.chk.size}/${ALL_ITEMS.length}`;
  }
  /* floating, minimizable panel shown in stage 2 */
  let panelEl = null;
  function panelBuild() {
    if (panelEl) panelEl.remove();
    const body = h('div', { class: 'chk-body' }, checklistNode());
    const min = h('button', { class: 'btn', type: 'button', id: 'chk-min', text: st.panelMin ? 'Open' : 'Minimize' });
    panelEl = h('aside', { class: `chk-panel noprint${st.panelMin ? ' min' : ''}`, id: 'chk-panel', hidden: true },
      h('div', { class: 'chk-head' }, h('strong', { text: 'Penilaian' }), h('span', { class: 'muted', id: 'chk-total' }), min), body);
    min.addEventListener('click', () => { st.panelMin = !st.panelMin; panelEl.classList.toggle('min', st.panelMin); min.textContent = st.panelMin ? 'Open' : 'Minimize'; });
    document.body.append(panelEl); chkRefresh();
  }
  function panelMinimize() { if (!panelEl) return; st.panelMin = true; panelEl.classList.add('min'); const b = panelEl.querySelector('#chk-min'); if (b) b.textContent = 'Open'; }
  function panelSet(on) { if (panelEl) panelEl.hidden = !(on && st.assessOn); }
  /** Stage between 3 and the results: finish ticking. */
  /** Examiner's answer key, grouped by category and collapsed (same idea as the station groups). */
  function answerKeyCard(c) {
    const ai = (sec) => (c.ai && c.ai.includes(sec) ? h('span', { class: 'badge ai', text: 'Answers created by AI' }) : null);
    const grp = (title, ...kids) => h('details', { class: 'chk-st key-grp' }, h('summary', {}, h('strong', { text: title })), h('div', { class: 'full' }, kids));
    const tests = otherTests(c), pe = peOf(c);
    const n = tests.filter((x) => st.opened.has(x.label)).length;
    return h('section', { class: 'card', id: 'answer-key' }, h('h2', { text: 'Kunci jawaban (untuk penguji)' }),
      h('p', { class: 'muted', text: 'Tertutup secara default; buka per kategori.' }),
      grp('Skenario & anamnesis', scenario(c),
        c.anamnesis.length ? c.anamnesis.map((x) => h('div', { class: 'qa' }, h('div', { class: 'q', text: x.q }), h('div', { text: x.a }))) : h('p', { class: 'muted', text: 'No anamnesis answers in the source.' })),
      pe ? grp('Pemeriksaan fisik', (pe.quote || []).map((q) => h('p', { class: 'problem', text: q }))) : null,
      grp(`Pemeriksaan penunjang (${n} dari ${tests.length} diminta di stage 2)`,
        tests.length ? tests.map((x) => h('div', { class: 'tst' },
          h('h4', {}, x.label, aiTest(x), h('span', { class: st.opened.has(x.label) ? 'badge acc' : 'badge no', text: st.opened.has(x.label) ? 'Diminta di stage 2' : 'Belum diminta' })),
          resultBody(x, true))) : h('p', { class: 'muted', text: 'None.' })),
      grp('Diagnosis', h('p', { text: c.diagnosis || '-' })),
      c.differential && c.differential.length ? grp('Diagnosis banding', lines(c.differential)) : null,
      grp('Prognosis', ai('prognosis'), h('p', { text: c.prognosis || '-' })),
      c.treatment && c.treatment.length ? grp('Terapi', ai('treatment'), lines(c.treatment)) : null,
      grp('Resep', ai('prescription'), c.prescription && c.prescription.length
        ? [c.prescription.map((x) => h('pre', { class: 'rx', text: x })), c.rxFooter && h('pre', { class: 'rx foot', text: c.rxFooter }), c.rxNote && h('p', { class: 'muted', text: c.rxNote })]
        : h('p', { text: '-' })),
      c.education && c.education.length ? grp('Edukasi', ai('education'), lines(c.education)) : null);
  }
  function assessStage() {
    stopClock();
    mount(stage(3, 'Complete the assessment'),
      answerKeyCard(cur()),
      h('section', { class: 'card' }, h('h2', { text: 'Lengkapi penilaian' }),
        h('p', { class: 'muted', text: `Tick anything you have not marked yet (the extra checklist at the bottom is not scored). The answer key above is for the examiner. Tests requested by the examinee in stage 2: ${[...st.opened].length} of ${otherTests(cur()).length}.` }),
        checklistNode()),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'next4', text: 'Next: results →', on: { click: end } })));
  }
  /** Assessment results: scores per aspect and what was not done. */
  function assessCard(e) {
    if (!e || !e.assess || !FORMS[e.form]) return null;
    const set = new Set(e.chk || []);
    const r = compute(set, e.ovr, e.form);
    return h('section', { class: 'card', id: 'assess-res' }, h('h2', { text: 'Assessment results' }),
      h('p', { class: 'big', text: `${num1(r.earned)} / ${r.max}` }),
      h('p', { class: r.pass ? 'pass' : 'fail', text: r.pass ? `Lulus (${r.passMark}–${r.max})` : `Tidak lulus (di bawah ${r.passMark})` }),
      r.stations.map((x) => [
        h('h3', { text: `${x.S.title} · ${num1(x.earned)} / ${x.max}` }),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'lab' },
          h('thead', {}, h('tr', {}, ['No', 'Aspek yang dinilai', 'Skor (1–4)', 'Bobot', 'Nilai'].map((t) => h('th', { text: t })))),
          h('tbody', {}, x.aspects.map((y) => h('tr', {}, h('td', { text: String(y.a.no) }), h('td', { text: y.a.name }), h('td', { text: `${y.score}${y.manual ? ' (manual)' : ''}` }), h('td', { text: `${y.a.pct}%` }), h('td', { text: `${num1(y.earned)} / ${y.a.unit * 4}` })))))),
        (() => { const miss = x.S.aspects.flatMap((a) => a.items.filter((i) => !set.has(i.id)).map((i) => [a, i]));
          return miss.length ? [h('h4', { text: 'Belum dilakukan' }), h('ul', {}, miss.map(([a, i]) => h('li', {}, h('strong', { text: `${a.no}. ${a.name}: ` }), i.t)))] : h('p', { class: 'muted', text: 'Semua kriteria dilakukan.' }); })()]),
      h('p', { class: 'muted', text: 'Skor tiap baris (1–4) dihitung dari butir yang dicentang menurut deskriptor Kertas Kerja Penilai OSCE UKMPPDH 2025, kecuali diubah manual. Nilai = bobot × skor, total 400, lulus ≥ 250.' }));
  }

  /** Extra checklist result: separate from the scored assessment. */
  function extraCard(e) {
    if (!e || !e.assess || !Array.isArray(e.xchk)) return null;
    const set = new Set(e.xchk), miss = EXTRA.items.filter((i) => !set.has(i.id));
    return h('section', { class: 'card', id: 'extra-res' }, h('h2', { text: EXTRA.title }),
      h('p', { class: 'muted', text: `${set.size} of ${EXTRA.items.length} dilakukan. Tidak masuk skor penilaian.` }),
      miss.length ? [h('h4', { text: 'Belum dilakukan' }), h('ul', {}, miss.map((i) => h('li', {}, h('strong', { text: `${i.g.name}: ` }), i.t)))] : h('p', { class: 'muted', text: 'Semua dilakukan.' }));
  }

  /* ---- participant reports (from History) ---- */
  const nameKey = (n) => String(n).replace(/\s+/g, ' ').trim().toLowerCase();
  function participants() {
    const m = new Map();
    for (const e of loadHist()) { if (!e.assess || e.form !== FORM_NOW) continue; const k = nameKey(e.name); if (!m.has(k)) m.set(k, { key: k, name: e.name, list: [] }); const p = m.get(k); p.name = e.name; p.list.push(e); }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Small inline-SVG line chart (works on screen and in PDF). vals/labels: one point per session. */
  function lineChart(vals, labels, o) {
    const NS = 'http://www.w3.org/2000/svg', W = 640, H = 236, L = 46, R = 14, T = 26, B = 44;
    const el = (n, a, t) => { const x = document.createElementNS(NS, n); for (const k in a) x.setAttribute(k, a[k]); if (t != null) x.textContent = t; return x; };
    const top = Math.max(o.max || 0, ...vals, o.ref || 0, 1), px = (i) => (vals.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (vals.length - 1)), py = (v) => T + (H - T - B) * (1 - v / top);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title, class: 'chart-svg' });
    for (let g = 0; g <= 4; g++) { const v = (top * g) / 4, y = py(v); svg.append(el('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'currentColor', 'stroke-opacity': '.15' }), el('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': '11', fill: 'currentColor' }, String(Math.round(v)))); }
    if (o.ref) svg.append(el('line', { x1: L, x2: W - R, y1: py(o.ref), y2: py(o.ref), stroke: '#16a34a', 'stroke-width': '1.5', 'stroke-dasharray': '5 4' }), el('text', { x: W - R, y: py(o.ref) - 4, 'text-anchor': 'end', 'font-size': '11', fill: '#16a34a' }, o.refLabel));
    svg.append(el('polyline', { points: vals.map((v, i) => `${px(i)},${py(v)}`).join(' '), fill: 'none', stroke: o.color, 'stroke-width': '2.5' }));
    const every = Math.ceil(vals.length / 8);
    vals.forEach((v, i) => { svg.append(el('circle', { cx: px(i), cy: py(v), r: 4, fill: o.color }), el('text', { x: px(i), y: py(v) - 8, 'text-anchor': 'middle', 'font-size': '11', fill: 'currentColor' }, num1(v)));
      if (i % every === 0 || i === vals.length - 1) svg.append(el('text', { x: px(i), y: H - 24, 'text-anchor': 'middle', 'font-size': '10', fill: 'currentColor' }, `#${i + 1}`), el('text', { x: px(i), y: H - 11, 'text-anchor': 'middle', 'font-size': '9', fill: 'currentColor', 'fill-opacity': '.7' }, labels[i])); });
    return h('div', { class: 'chart' }, svg);
  }
  function reportNodes(p) {
    const n = p.list.length;
    const rs = p.list.map((e) => ({ e, r: compute(new Set(e.chk || []), e.ovr) }));
    const avg = (f) => rs.reduce((t, x) => t + f(x.r), 0) / n;
    const missed = ALL_ITEMS.map((it) => ({ it, k: p.list.filter((e) => !(e.chk || []).includes(it.id)).length })).filter((x) => x.k > 0).sort((a, b) => b.k - a.k);
    const aspAvg = ASSESS.flatMap((S) => S.aspects).map((a) => ({ a, v: rs.reduce((t, x) => t + x.r.stations.flatMap((y) => y.aspects).find((y) => y.a === a).score, 0) / n }));
    return [
      h('section', { class: 'card' }, h('h2', { text: `Evaluation report: ${p.name}` }),
        h('p', { class: 'muted', text: `${n} session${n === 1 ? '' : 's'} with the assessment form · average total ${num1(avg((r) => r.earned))} / ${MAXS} · passed ${rs.filter((x) => x.r.pass).length} of ${n}` }),
        h('h3', { text: 'Score over time' }),
        lineChart(rs.map((x) => x.r.earned), p.list.map((e) => new Date(e.t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })), { title: 'Total score per session', max: MAXS, ref: PASS, refLabel: `Pass ${PASS}`, color: '#2563eb' }),
        h('h3', { text: 'Missed items over time' }),
        lineChart(p.list.map((e) => ALL_ITEMS.filter((it) => !(e.chk || []).includes(it.id)).length), p.list.map((e) => new Date(e.t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })), { title: 'Checklist items missed per session', max: 0, color: '#dc2626' }),
        h('h3', { text: 'Sessions' }),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'lab' },
          h('thead', {}, h('tr', {}, ['Date', 'Case', ...ASSESS.map((S) => S.id), 'Total', 'Status'].map((t) => h('th', { text: t })))),
          h('tbody', {}, rs.map(({ e, r }) => { const c = st.byId.get(e.id); return h('tr', {}, h('td', { text: when(e.t) }), h('td', { text: c ? `No. ${numOf(c)}` : '-' }), ...r.stations.map((x) => h('td', { text: `${num1(x.earned)}/${x.max}` })), h('td', { text: num1(r.earned) }), h('td', { text: r.pass ? 'Lulus' : 'Tidak lulus' })); })))),
        h('h3', { text: 'Average score per row (1–4)' }),
        h('ul', {}, aspAvg.map((x) => h('li', { text: `${x.a.no}. ${x.a.name}: ${num1(x.v)}` }))),
        h('h3', { text: 'Most often missed' }),
        missed.length ? h('ol', {}, missed.slice(0, 15).map((x) => h('li', {}, h('strong', { text: `${x.it.a.no}. ${x.it.a.name}: ` }), `${x.it.t} `, h('span', { class: 'muted', text: `(missed in ${x.k} of ${n} · ${Math.round((100 * x.k) / n)}%)` })))) : h('p', { class: 'muted', text: 'Nothing was missed.' }),
        (() => { const xs = p.list.filter((e) => Array.isArray(e.xchk)); if (!xs.length) return null;
          const xm = EXTRA.items.map((it) => ({ it, k: xs.filter((e) => !e.xchk.includes(it.id)).length })).filter((x) => x.k > 0).sort((a, b) => b.k - a.k);
          return [h('h3', { text: `${EXTRA.title}: paling sering terlewat` }),
            xm.length ? h('ol', {}, xm.map((x) => h('li', {}, h('strong', { text: `${x.it.g.name}: ` }), `${x.it.t} `, h('span', { class: 'muted', text: `(terlewat ${x.k} dari ${xs.length})` })))) : h('p', { class: 'muted', text: 'Semua dilakukan.' })]; })()),
    ];
  }
  function reports() {
    stopClock();
    const ps = participants();
    mount(h('div', { class: 'row' }, h('button', { class: 'btn', id: 'back', text: '← Back to history', on: { click: history } })),
      h('section', { class: 'card' }, h('h2', { text: 'Participant reports' }),
        ps.length ? [h('p', { class: 'muted', text: 'Participants are grouped by name (spelling and capitals are ignored). Only sessions that used the assessment form count.' }),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'rep-all', text: 'Save all reports as PDF', on: { click: () => printBlocks(ps.map(reportNodes)) } })),
          ps.map((p) => h('div', { class: 'li hist-item' }, h('div', {}, h('strong', { text: p.name }), h('div', { class: 'muted', text: `${p.list.length} session${p.list.length === 1 ? '' : 's'}` })),
            h('div', { class: 'row' }, h('button', { class: 'btn', text: 'View', on: { click: () => reportView(p) } }), h('button', { class: 'btn', text: 'Save PDF', on: { click: () => printBlocks([reportNodes(p)]) } }))))]
          : h('p', { class: 'muted', text: 'No sessions with the assessment form yet.' })));
  }
  function reportView(p) {
    mount(h('div', { class: 'row noprint' }, h('button', { class: 'btn', id: 'back', text: '← Back', on: { click: reports } }), h('button', { class: 'btn primary', id: 'pdf', text: 'Save as PDF', on: { click: doPrint } })), reportNodes(p));
  }

  /* ---- 4. answer key (also used by History and printing) ---- */
  /** Everything inside the answer-key card. `ids` adds element ids (only one answer key may be on a page with ids). */
  function keyBody(c, ids) {
    const id = (x) => (ids ? x : null);
    const ai = (sec) => (c.ai && c.ai.includes(sec) ? h('span', { class: 'badge ai', text: 'Answers created by AI' }) : null);
    return [
      h('h3', { text: 'Diagnosis' }), h('p', { id: id('key-dx'), text: c.diagnosis || '-' }),
      c.differential && c.differential.length ? [h('h3', { text: 'Differential diagnosis' }), h('div', { id: id('key-ddx') }, lines(c.differential))] : null,
      h('h3', {}, 'Prognosis', ai('prognosis')), h('p', { id: id('key-px'), text: c.prognosis || '-' }),
      c.treatment && c.treatment.length ? [h('h3', {}, 'Treatment', ai('treatment')), h('div', { id: id('key-tx') }, lines(c.treatment))] : null,
      h('h3', {}, 'Prescription', ai('prescription')),
      c.prescription && c.prescription.length
        ? [h('div', { id: id('key-rx'), class: 'rx-list' }, c.prescription.map((x) => h('pre', { class: 'rx', text: x }))),
          c.rxFooter && h('pre', { class: 'rx foot', text: c.rxFooter }),
          c.rxNote && h('p', { class: 'muted', text: c.rxNote })]
        : h('p', { id: id('key-rx'), text: '-' }),
      c.education && c.education.length ? [h('h3', {}, 'Education', ai('education')), h('div', { id: id('key-edu') }, lines(c.education))] : null,
      c.refs && c.refs.length ? [h('h3', { text: 'References (from source)' }), h('ul', { class: 'muted' }, c.refs.map((r) => h('li', { text: r })))] : null,
    ];
  }
  const finishedCard = (c, e) => h('section', { class: 'card' }, h('h2', { text: 'Examination finished' }),
    h('p', { class: 'muted', text: `No. ${numOf(c)} · [${c.source}] ${c.title}` }),
    e && h('p', { class: 'muted', text: `Participant: ${e.name} · ${when(e.t)} · Timers ${e.timer ? 'on' : 'off'}` }));
  /** Stage 4 / History: the same full view as All questions, plus accessed / not accessed marks on every test. */
  const resultsCard = (c, e, ids) => h('section', { class: 'card', id: ids ? 'key' : null }, fullCase(c, { opened: new Set((e && e.opened) || []), ids }));
  const doPrint = () => { try { window.print(); } catch (_) { /* printing is optional */ } };
  const missing = (e) => h('section', { class: 'card' }, h('h2', { text: 'Case no longer available' }), h('p', { class: 'muted', text: `${e.name} · ${when(e.t)}` }));

  function end() {
    stopClock();
    const c = cur();
    if (!st.entry) {
      st.entry = { t: Date.now(), id: c.id, name: st.name, timer: st.timerOn, opened: [...st.opened] };
      if (st.assessOn) { st.entry.assess = true; st.entry.form = FORM_NOW; st.entry.chk = [...st.chk]; st.entry.xchk = [...st.xchk]; st.entry.ovr = { ...st.ovr }; }
      const a = loadHist(); a.push(st.entry); saveHist(a);
    }
    mount(stage(stageTotal(), 'Examination results'), finishedCard(c, st.entry), assessCard(st.entry), extraCard(st.entry), resultsCard(c, st.entry, true),
      caseReportControl(c),
      h('div', { class: 'row noprint' },
        h('button', { class: 'btn primary', id: 'again', text: 'New case', on: { click: home } }),
        h('button', { class: 'btn', id: 'pdf', text: 'Save as PDF', on: { click: doPrint } }),
        h('button', { class: 'btn', id: 'to-hist', text: 'History', on: { click: () => history() } })));
  }

  /* ---- case reports: report a case, and the public Reports page with thumbs up/down and comments (Google Sheet through the same Apps Script) ---- */
  const CASE_TYPES = ['Incorrect scenario / physical exam', 'Incorrect anamnesis', 'Incorrect test results', 'Incorrect diagnosis', 'Incorrect treatment / prescription', 'Incorrect answer key / explanation', 'Other'];
  const reportedCases = new Set();
  const userLabel = () => (st.user ? `${st.user.name}${st.user.university ? ` (${st.user.university})` : ''}` : 'Unknown');
  const postJson = (body) => (REGISTRY_URL ? registry.call(REGISTRY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, app: 'osce' }) }) : null);
  /** Self-contained Report button + form for one case (Browse and the end of a session). Does not re-render the page. */
  function caseReportControl(c) {
    const wrap = h('div', { class: 'item-report noprint' });
    const types = new Set(); let comment = ''; let open = false; let sending = false; let msg = null;
    const paintR = (focus) => {
      const kids = [h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', 'data-report': c.id, 'aria-expanded': open ? 'true' : 'false', text: reportedCases.has(c.id) ? 'Reported ✓' : 'Report this case',
        on: { click: () => { open = !open; msg = null; paintR(open ? 'input' : 'button'); } } }))];
      if (reportedCases.has(c.id) && !open) kids.push(h('p', { class: 'muted', text: 'Thanks, your report was sent.' }));
      if (open) kids.push(h('div', { class: 'report-box' },
        h('h3', { text: 'Report this case' }), h('p', { class: 'muted', text: 'What looks wrong? Select everything that applies.' }),
        CASE_TYPES.map((t) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', 'data-type': t, checked: types.has(t), on: { change: (e) => { if (e.target.checked) types.add(t); else types.delete(t); } } }), h('span', { text: ` ${t}` }))),
        h('label', { text: 'Additional comments (optional)' }),
        h('textarea', { maxlength: '1000', placeholder: 'For example: the diagnosis should be … because …', value: comment, on: { input: (e) => { comment = e.target.value; } } }),
        msg && h('div', { class: `notice ${msg.type}`, role: 'alert' }, h('p', { text: msg.text })),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', 'data-send': c.id, text: sending ? 'Sending…' : 'Send report', disabled: sending, on: { click: async () => {
            if (sending) return;
            const fail = (text) => { msg = { type: 'err', text }; paintR('send'); };
            if (!types.size) return fail('Select at least one type of error.');
            if (types.size === 1 && types.has('Other') && !comment.trim()) return fail('Please describe the problem in the comment box.');
            if (!REGISTRY_URL) return fail('Reporting is not available: this site is not connected to the report sheet.');
            sending = true; msg = { type: 'ok', text: 'Sending…' }; paintR('send');
            const res = await postJson({ action: 'report', reporter: userLabel(), code: c.id, device: st.user ? st.user.id : '', caseNo: numOf(c), source: c.source, title: c.title, types: [...types], comment: comment.trim().slice(0, 1000) });
            sending = false;
            if (res) { reportedCases.add(c.id); types.clear(); comment = ''; open = false; msg = null; paintR('button'); } else fail('Could not send the report. Check your connection and try again.');
          } } }),
          h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => { open = false; msg = null; paintR('button'); } } }))));
      wrap.replaceChildren(...kids);
      const el = focus === 'input' ? wrap.querySelector('input') : focus === 'send' ? wrap.querySelector('[data-send]') : focus === 'button' ? wrap.querySelector('[data-report]') : null;
      if (el) el.focus();
    };
    paintR();
    return wrap;
  }

  /* ---- shared admin edits (stored ENCRYPTED in the sheet), admin flag and edit history ---- */
  const remote = { cur: new Map(), rev: new Map(), hist: new Map(), sig: '', busy: false, loaded: false };
  let adminFlag = false; let editingOpen = false;
  const isAdmin = () => adminFlag;
  async function sealJson(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, st.key, enc.encode(JSON.stringify(obj)));
    return `e1:${b64e(iv)}.${b64e(new Uint8Array(ct))}`;
  }
  async function openJson(p) {
    try {
      const [iv, ct] = String(p).slice(3).split('.');
      return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(iv) }, st.key, b64d(ct))));
    } catch (_) { return null; }
  }
  const strs = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  /** The editable text of a case (what the admin editor shows and saves). */
  function caseSnap(c) {
    const quotes = {};
    c.tests.forEach((t) => { if (strs(t.quote)) quotes[t.label] = t.quote.slice(); });
    return { title: c.title || '', briefText: (c.brief && c.brief.text) || '', diagnosis: c.diagnosis || '', differential: (c.differential || []).slice(), prognosis: c.prognosis || '',
      treatment: (c.treatment || []).slice(), prescription: (c.prescription || []).slice(), rxFooter: c.rxFooter || '', rxNote: c.rxNote || '', education: (c.education || []).slice(),
      anamnesis: c.anamnesis.map((x) => ({ q: x.q || '', a: x.a || '' })), quotes };
  }
  function remoteOf(c) {
    const e = remote.cur.get(c.id);
    if (!e || typeof e.title !== 'string' || !e.title.trim() || typeof e.briefText !== 'string' || !e.briefText.trim() || !Array.isArray(e.anamnesis) || e.anamnesis.length !== c.anamnesis.length
      || !['differential', 'treatment', 'prescription', 'education'].every((k) => strs(e[k])) || !['diagnosis', 'prognosis', 'rxFooter', 'rxNote'].every((k) => typeof e[k] === 'string')) return c;
    const q = e.quotes && typeof e.quotes === 'object' ? e.quotes : {};
    return { ...c, title: e.title, brief: { ...c.brief, text: e.briefText }, diagnosis: e.diagnosis, differential: e.differential, prognosis: e.prognosis, treatment: e.treatment,
      prescription: e.prescription, rxFooter: e.rxFooter || undefined, rxNote: e.rxNote || undefined, education: e.education,
      anamnesis: c.anamnesis.map((x, i) => ({ ...x, q: String(e.anamnesis[i].q), a: String(e.anamnesis[i].a) })),
      tests: c.tests.map((t) => (strs(t.quote) && strs(q[t.label]) ? { ...t, quote: q[t.label].slice() } : t)), remoteEdit: { rev: e.rev, by: e.by, t: e.t } };
  }
  function rebuildCases() {
    if (!st.baseCases || !st.cases || !st.byId) return;
    const next = st.baseCases.map(remoteOf);
    st.cases.length = 0; st.cases.push(...next);
    st.byId.clear(); next.forEach((c) => st.byId.set(c.id, c));
  }
  async function loadRemote(quiet) {
    if (!REGISTRY_URL || !st.user || !st.key) return false;
    const d = await registry.call(`${REGISTRY_URL}${REGISTRY_URL.includes('?') ? '&' : '?'}action=boot&app=osce&device=${encodeURIComponent(st.user.id)}`, { method: 'GET' });
    if (!d) return false;
    const rows = (Array.isArray(d.edits) ? d.edits : []).filter((r) => r && typeof r.item === 'string' && Number.isInteger(r.rev) && typeof r.p === 'string')
      .sort((x, y) => (x.item < y.item ? -1 : x.item > y.item ? 1 : x.rev - y.rev));
    const sig = `${d.admin ? 1 : 0}:${rows.length}:${rows.reduce((m, r) => Math.max(m, r.t || 0), 0)}`;
    remote.loaded = true;
    if (sig === remote.sig && !quiet) return true;
    const bodies = await Promise.all(rows.map((r) => openJson(r.p)));
    const cur = new Map(); const rev = new Map(); const hist = new Map();
    rows.forEach((r, i) => {
      const b = bodies[i];
      rev.set(r.item, Math.max(rev.get(r.item) || 0, r.rev));
      if (!hist.has(r.item)) hist.set(r.item, []);
      hist.get(r.item).push({ rev: r.rev, by: r.by, t: r.t, kind: r.kind, note: b && b.note, before: b && b.before, set: b && b.set });
      if (r.kind === 'revert') cur.delete(r.item); else if (b && b.set) cur.set(r.item, { ...b.set, rev: r.rev, by: r.by, t: r.t });
    });
    const wasAdmin = adminFlag; adminFlag = d.admin === true;
    Object.assign(remote, { cur, rev, hist, sig });
    if (st.baseCases) rebuildCases();
    if (wasAdmin !== adminFlag && !editingOpen) {
      const tab = document.querySelector('#home-tabs .tab.active');
      if (tab && tab.id === 'tab-reports') caseReportsView(); else if (tab && tab.id === 'tab-all' && document.getElementById('source')) home();
    }
    return true;
  }
  function kickRemote() {
    if (remote.busy || remote.loaded) return;
    remote.busy = true; loadRemote(false).catch(() => {}).finally(() => { remote.busy = false; });
  }
  const adminPost = (body) => postJson({ ...body, device: st.user.id, editor: userLabel() });

  const FIELD_LABEL = { title: 'Title', briefText: 'Scenario', diagnosis: 'Diagnosis', differential: 'Differential diagnosis', prognosis: 'Prognosis', treatment: 'Treatment', prescription: 'Prescription', rxFooter: 'Prescription footer', rxNote: 'Prescription note', education: 'Education' };
  /** Edit history of one case (visible to everyone). */
  function editInfo(c) {
    const hs = remote.hist.get(c.id);
    if (!hs || !hs.length) return null;
    const clip = (t) => { t = Array.isArray(t) ? t.join(' / ') : String(t == null ? '' : t); return t.length > 300 ? `${t.slice(0, 300)}…` : t; };
    const change = (label, a, b) => h('p', { class: 'prewrap' }, h('strong', { text: `${label}: ` }), h('s', { class: 'muted', text: clip(a) }), ' → ', clip(b));
    const lines = (e) => {
      const b = e.before; const n = e.set; if (!b || !n) return [];
      const out = [];
      Object.keys(FIELD_LABEL).forEach((k) => { if (JSON.stringify(b[k]) !== JSON.stringify(n[k])) out.push(change(FIELD_LABEL[k], b[k], n[k])); });
      (n.anamnesis || []).forEach((x, i) => { const y = (b.anamnesis || [])[i] || {}; if (y.q !== x.q) out.push(change(`Anamnesis ${i + 1} question`, y.q, x.q)); if (y.a !== x.a) out.push(change(`Anamnesis ${i + 1} answer`, y.a, x.a)); });
      Object.keys(n.quotes || {}).forEach((k) => { if (JSON.stringify((b.quotes || {})[k]) !== JSON.stringify(n.quotes[k])) out.push(change(k, (b.quotes || {})[k], n.quotes[k])); });
      return out;
    };
    return h('details', { class: 'edit-history' }, h('summary', { text: `✎ Edited by admin · history (${hs.length})` }),
      h('div', {}, hs.slice().sort((x, y) => y.rev - x.rev).map((e) => h('div', { class: 'qa' },
        h('div', {}, h('strong', { text: e.kind === 'revert' ? 'Reverted to the original version' : `Edit #${e.rev}` }), h('span', { class: 'muted', text: ` · ${e.by} · ${e.t ? new Date(e.t).toLocaleString() : ''}` })),
        e.note && h('p', { class: 'muted', text: `Reason: ${e.note}` }), lines(e)))));
  }
  /** Button in Browse that opens the editor for one case. */
  function adminCaseControl(c, repaint) {
    const host = h('div', { class: 'noprint' });
    const btn = h('button', { class: 'btn', type: 'button', 'data-edit': c.id, text: '✎ Edit case (admin)', on: { click: () => { btn.hidden = true; host.append(adminEditor(c, (changed) => { if (changed) repaint(); else { host.lastChild.remove(); btn.hidden = false; } })); } } });
    host.append(btn);
    return host;
  }
  /** Admin editor for one case: scenario, anamnesis, test text, diagnosis, treatment, prescription... Saved for everyone. */
  function adminEditor(c, done) {
    editingOpen = true;
    const close = (changed) => { editingOpen = false; done(changed); };
    const area = (id, v, rows) => { const t = h('textarea', { id, rows: String(rows), maxlength: '6000' }); t.value = v; return t; };
    const before = caseSnap(c);
    const ctl = {};
    const spec = [['title', 'line'], ['briefText', 'text'], ['diagnosis', 'text'], ['differential', 'lines'], ['prognosis', 'text'], ['treatment', 'lines'], ['prescription', 'blocks'], ['rxFooter', 'text'], ['rxNote', 'text'], ['education', 'lines']];
    const toStr = (k, v) => (k === 'blocks' ? v.join('\n---\n') : Array.isArray(v) ? v.join('\n') : v);
    const fields = spec.map(([k, kind]) => {
      let el;
      if (kind === 'line') { el = h('input', { type: 'text', id: `ae-${k}`, maxlength: '300' }); el.value = before[k]; }
      else el = area(`ae-${k}`, kind === 'blocks' ? before[k].join('\n---\n') : Array.isArray(before[k]) ? before[k].join('\n') : before[k], kind === 'text' ? 4 : 5);
      ctl[k] = { el, kind };
      const hint = kind === 'lines' ? ' (one per line)' : kind === 'blocks' ? ' (separate items with a line containing only ---)' : '';
      return h('div', {}, h('label', { for: `ae-${k}`, text: `${FIELD_LABEL[k]}${hint}` }), el);
    });
    const anam = before.anamnesis.map((x, i) => { const q = area(`ae-aq${i}`, x.q, 2); const a = area(`ae-aa${i}`, x.a, 3); return { q, a, node: h('div', { class: 'qa' }, h('label', { for: `ae-aq${i}`, text: `${i + 1}. Question` }), q, h('label', { for: `ae-aa${i}`, text: 'Expected answer' }), a) }; });
    const qkeys = Object.keys(before.quotes);
    const quotes = qkeys.map((k, i) => { const t = area(`ae-t${i}`, before.quotes[k].join('\n'), 4); return { k, t, node: h('div', {}, h('label', { for: `ae-t${i}`, text: `${k} (one line per paragraph)` }), t) }; });
    const note = h('input', { type: 'text', id: 'ae-note', maxlength: '200', placeholder: 'Reason (optional, shown in the edit history)' });
    const msg = h('p', { class: 'notice', role: 'alert', hidden: true });
    const show = (t) => { msg.hidden = false; msg.className = 'notice err'; msg.textContent = t; };
    const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
    const send = async (kind) => {
      let set = null;
      if (kind === 'edit') {
        set = {};
        for (const [k, kd] of spec) {
          const v = ctl[k].el.value;
          set[k] = kd === 'lines' ? lines(v) : kd === 'blocks' ? v.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean) : v.trim();
        }
        set.anamnesis = anam.map((x) => ({ q: x.q.value.trim(), a: x.a.value.trim() }));
        set.quotes = {}; quotes.forEach((x) => { set.quotes[x.k] = lines(x.t.value); });
        if (!set.title || !set.briefText) { show('The title and the scenario need text.'); return; }
        if (JSON.stringify(set) === JSON.stringify(before)) { show('Nothing changed.'); return; }
      }
      saveBtn.disabled = true; if (revBtn) revBtn.disabled = true;
      const p = await sealJson({ kind, set, before, note: note.value.trim() });
      const res = await adminPost({ action: 'aedit', item: c.id, kind, rev: remote.rev.get(c.id) || 0, p });
      saveBtn.disabled = false; if (revBtn) revBtn.disabled = false;
      if (!res) { show('Could not save. Check your connection and that the sheet script is updated and redeployed.'); return; }
      if (res.conflict) { await loadRemote(true); show('Another admin edited this case in the meantime. The latest version is loaded: close and open the editor again.'); return; }
      await loadRemote(true);
      close(true);
    };
    const mk = (id, text, cls, fn) => h('button', { class: `btn ${cls}`, type: 'button', id, text, on: { click: fn } });
    const saveBtn = mk('ae-save', 'Save for everyone', 'primary', () => send('edit'));
    const revBtn = remote.cur.has(c.id) ? mk('ae-revert', 'Revert to original', 'danger', () => { if (window.confirm('Revert this case to the original version for everyone?')) send('revert'); }) : null;
    return h('div', { class: 'editor admin-editor', id: 'admin-editor' },
      h('h3', { text: `Edit No. ${numOf(c)} (saved for everyone)` }), fields,
      h('details', {}, h('summary', { text: `Anamnesis (${anam.length})` }), anam.map((x) => x.node)),
      quotes.length ? h('details', {}, h('summary', { text: `Physical examination / test text (${quotes.length})` }), quotes.map((x) => x.node)) : null,
      h('p', { class: 'muted', text: 'Images and tables are not editable here.' }),
      h('label', { for: 'ae-note', text: 'Reason' }), note, msg,
      h('div', { class: 'row' }, saveBtn, mk('ae-cancel', 'Cancel', '', () => close(false)), revBtn));
  }
  /** Admin tab: device ID, admins (add / remove) and the edit log. */
  function adminView() {
    stopClock();
    const card = h('section', { class: 'card', id: 'admin-panel' });
    let admins = null; let msg = '';
    const load = async () => {
      const d = await registry.call(`${REGISTRY_URL}${REGISTRY_URL.includes('?') ? '&' : '?'}action=admins&device=${encodeURIComponent(st.user.id)}`, { method: 'GET' });
      admins = d && Array.isArray(d.admins) ? d.admins : false; paint();
    };
    const idIn = h('input', { id: 'ad-id', type: 'text', placeholder: 'Device ID, e.g. 21faf0a4-0960-…', autocomplete: 'off', maxlength: '64' });
    const lbIn = h('input', { id: 'ad-label', type: 'text', placeholder: 'Name (optional)', maxlength: '60', autocomplete: 'off' });
    const add = async () => {
      const id = idIn.value.trim();
      if (!/^[A-Za-z0-9-]{6,64}$/.test(id)) { msg = 'That does not look like a device ID.'; paint(); return; }
      const res = await adminPost({ action: 'aadmin_add', target: id, label: lbIn.value.trim() });
      msg = res ? 'Admin added.' : 'Could not add. Is the sheet script updated and redeployed?';
      if (res) { idIn.value = ''; lbIn.value = ''; await load(); } else paint();
    };
    const del = async (id) => { if (!window.confirm('Remove this admin?')) return; const res = await adminPost({ action: 'aadmin_del', target: id }); msg = res ? 'Admin removed.' : 'Could not remove.'; await load(); };
    const log = [...remote.hist.entries()].flatMap(([item, hs]) => hs.map((e) => ({ item, ...e }))).sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 50);
    const paint = () => card.replaceChildren(...[
      h('h2', { text: 'Admin' }), h('p', { class: 'muted' }, 'Your device ID: ', h('code', { text: st.user.id })),
      h('h3', { text: 'Admins' }),
      admins === null ? h('p', { class: 'muted', role: 'status', text: 'Loading…' })
        : admins === false ? h('p', { class: 'notice err', role: 'alert', text: 'Could not load the admin list.' })
          : h('div', { id: 'admin-list' }, admins.map((a) => h('div', { class: 'qa' }, h('code', { text: a.id }), ` ${a.label || ''}${a.seed ? ' (owner)' : ''} `,
            !a.seed && a.id !== st.user.id && h('button', { class: 'btn reply-btn', type: 'button', text: 'Remove', 'data-del': a.id, on: { click: () => del(a.id) } })))),
      h('h3', { text: 'Add admin' }), h('p', { class: 'muted', text: 'Ask the person to copy their device ID from the main screen ("Device ID") and send it to you.' }),
      h('label', { for: 'ad-id', text: 'Device ID' }), idIn, h('label', { for: 'ad-label', text: 'Name' }), lbIn,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', id: 'ad-add', text: 'Add admin', on: { click: add } })),
      msg && h('p', { class: 'notice', role: 'status', text: msg }),
      h('h3', { text: 'Edit log (latest 50)' }),
      log.length ? log.map((e) => h('div', { class: 'qa' }, h('strong', { text: e.item }), h('span', { class: 'muted', text: ` · ${e.kind === 'revert' ? 'reverted' : `edit #${e.rev}`} · ${e.by} · ${e.t ? new Date(e.t).toLocaleString() : ''}${e.note ? ` · ${e.note}` : ''}` }))) : h('p', { class: 'muted', text: 'No edits yet.' }),
    ].filter(Boolean));
    mount(tabBar('admin'), card);
    paint(); load();
  }
  let caseReports = null;
  async function loadCaseReports() {
    const d = await registry.call(`${REGISTRY_URL}${REGISTRY_URL.includes('?') ? '&' : '?'}app=osce&action=reports&device=${encodeURIComponent(st.user ? st.user.id : '')}`, { method: 'GET' });
    return d && Array.isArray(d.reports) ? d.reports : null;
  }
  /* notifications for my own reports: other people's thumbs up/down and comments since I last opened the Reports tab */
  const SEEN_KEY = 'osce.repseen.v1';
  const isMine = (r) => (r.dev ? r.own : r.by === userLabel());
  const seenMap = () => { const m = store.read(SEEN_KEY, {}); return m && typeof m === 'object' ? m : {}; };
  const othersOf = (r) => ({ up: Math.max(0, (r.up || 0) - ((r.mine || 0) > 0 ? 1 : 0)), down: Math.max(0, (r.down || 0) - ((r.mine || 0) < 0 ? 1 : 0)), c: (r.comments || []).filter((c) => c.name !== userLabel()).length,
    m: (r.comments || []).filter((c) => c.name !== userLabel() && replyOf(c.text).to === userLabel()).length });
  /** A reply starts with @[Name (University)] followed by the text. */
  function replyOf(text) {
    const m = /^@\[([^\]]{2,140}(?:\([^)]*\))?)\]\s?/.exec(text || '');
    return m ? { to: m[1], text: (text || '').slice(m[0].length) } : { to: '', text: text || '' };
  }
  function freshActivity() {
    const out = {};
    if (!caseReports || !caseReports.list || !st.user) return out;
    const seen = seenMap();
    for (const r of caseReports.list) {
      const o = othersOf(r);
      if (!isMine(r)) {
        const m = Math.max(0, o.m - ((seen[r.id] || {}).m || 0));
        if (m) out[r.id] = { up: 0, down: 0, c: 0, m, mine: false, title: `No. ${r.no} ${r.title}`, items: (r.comments || []).filter((c) => c.name !== userLabel() && replyOf(c.text).to === userLabel()).slice(-m) };
        continue;
      }
      const s0 = seen[r.id] || { up: 0, down: 0, c: 0 };
      const d = { up: Math.max(0, o.up - s0.up), down: Math.max(0, o.down - s0.down), c: Math.max(0, o.c - s0.c), m: 0, mine: true };
      if (d.c) d.items = (r.comments || []).filter((c) => c.name !== userLabel()).slice(-d.c);
      if (d.up || d.down || d.c) { d.title = `No. ${r.no} ${r.title}`; out[r.id] = d; }
    }
    return out;
  }
  const freshCount = () => Object.values(freshActivity()).reduce((n, d) => n + d.up + d.down + d.c + d.m, 0);
  function markSeen(onlyId) {
    if (!caseReports || !caseReports.list) return;
    const seen = seenMap();
    for (const r of caseReports.list) { const o = othersOf(r); if ((isMine(r) || o.m) && (!onlyId || r.id === onlyId)) seen[r.id] = o; }
    store.write(SEEN_KEY, seen);
    renderBell();
  }
  let freshShown = {}; let prefetched = false;
  /* bell (top right): new thumbs up/down and comments on my reports; a click opens that thread */
  let bellEl = null; let bellOpen = false; let pendingScroll = null; let pinnedFresh = {};
  function renderBell() {
    if (!REGISTRY_URL || !st.user) { if (bellEl) { bellEl.remove(); bellEl = null; } return; }
    if (!bellEl) { bellEl = h('div', { class: 'bell noprint', id: 'bell' }); document.body.append(bellEl); }
    const fa = freshActivity(); const ids = Object.keys(fa);
    const n = ids.reduce((s, id) => s + fa[id].up + fa[id].down + fa[id].c + fa[id].m, 0);
    const kids = [h('button', { class: 'bell-btn', id: 'bell-btn', type: 'button', 'aria-label': `Notifications${n ? `, ${n} new` : ''}`, 'aria-expanded': String(bellOpen), text: n ? `🔔 ${n}` : '🔔',
      on: { click: () => { bellOpen = !bellOpen; renderBell(); } } })];
    if (bellOpen) {
      kids.push(h('div', { class: 'bell-panel card', id: 'bell-panel' },
        h('div', { class: 'row' }, h('strong', { text: 'Notifications' }), ids.length ? h('button', { class: 'btn', type: 'button', id: 'bell-readall', text: 'Mark all as read', on: { click: () => markSeen() } }) : null),
        ids.length ? ids.map((id) => {
          const d = fa[id]; const votes = [d.up && `+${d.up} 👍`, d.down && `+${d.down} 👎`].filter(Boolean).join(' · ');
          return h('button', { class: 'bell-item', type: 'button', 'data-notif': id, on: { click: () => goReport(id) } },
            h('strong', { text: d.mine ? `Your report: ${d.title}` : `Reply to you: ${d.title}` }), votes ? h('span', { class: 'muted', text: votes }) : null,
            (d.items || []).map((c) => { const t = replyOf(c.text).text; return h('span', { class: 'muted', text: `💬 ${c.name}${replyOf(c.text).to === userLabel() ? ' replied to you' : ''}: ${t.length > 90 ? `${t.slice(0, 90)}…` : t}` }); }));
        }) : h('p', { class: 'muted', text: 'No new notifications.' })));
    }
    bellEl.replaceChildren(...kids);
  }
  function goReport(id) {
    if (!document.getElementById('home-tabs') && !window.confirm('Leave this screen? A running case will be cancelled.')) return;
    const d = freshActivity()[id];
    if (d) pinnedFresh[id] = d;
    bellOpen = false; markSeen(id);
    Object.assign(repUi, { status: 'all', type: 'all', query: '', sort: 'new', limit: 100000 });
    pendingScroll = id;
    caseReportsView(); renderBell();
  }

  async function prefetchReports() {
    if (prefetched || !REGISTRY_URL || !st.user) return;
    prefetched = true;
    renderBell();
    if (!caseReports) { const list = await loadCaseReports(); caseReports = list ? { list } : null; }
    renderBell();
    setInterval(async () => {
      if (document.hidden) return;
      const list = await loadCaseReports();
      if (list && !document.getElementById('reports-card')) { caseReports = { list }; renderBell(); }
      else if (!list) renderBell();
      if (!editingOpen) loadRemote(false).catch(() => {});
    }, 90000);
  }
  /** Top tabs, like Quiz Time: All questions (the main menu) and Reports & Discussion. */
  function tabBar(active) {
    return h('div', { class: 'tabs', role: 'tablist', id: 'home-tabs' }, [['all', 'All questions'], ['reports', 'Reports & Discussion'], ...(isAdmin() ? [['admin', 'Admin']] : [])].map(([id, label]) => h('button', {
      class: `tab${active === id ? ' active' : ''}`, type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': String(active === id), text: label,
      on: { click: () => { if (id === active) return; freshShown = {}; pinnedFresh = {}; if (id === 'all') home(); else if (id === 'admin') adminView(); else caseReportsView(); } } })));
  }
  const repUi = { status: 'all', type: 'all', query: '', sort: 'new', limit: 20 };
  function caseReportsView() {
    stopClock();
    const card = h('section', { class: 'card', id: 'reports-card' });
    let marked = false;
    const stOf = (r) => (r.status || '').trim() || 'Open';
    const T = (r) => r.types.split(',').map((x) => x.trim()).filter(Boolean);
    const uniq = (arr) => [...new Set(arr)].sort((x, y) => x.localeCompare(y));
    const SORTS = [['new', 'Newest'], ['old', 'Oldest'], ['up', 'Most 👍'], ['down', 'Most 👎'], ['net', 'Best score (👍 − 👎)'], ['talk', 'Most comments']];
    const cmp = { new: (x, y) => y.t - x.t, old: (x, y) => x.t - y.t, up: (x, y) => (y.up || 0) - (x.up || 0) || y.t - x.t, down: (x, y) => (y.down || 0) - (x.down || 0) || y.t - x.t,
      net: (x, y) => ((y.up || 0) - (y.down || 0)) - ((x.up || 0) - (x.down || 0)) || y.t - x.t, talk: (x, y) => (y.comments || []).length - (x.comments || []).length || y.t - x.t };
    const reportCard = (r) => {
      const root = h('article', { class: 'card rq-item', 'data-report-id': r.id });
      const cs = { draft: '', msg: '', sending: false }; let nowOpen = false; let rendered = false;
      const adminBar = () => {
        if (!isAdmin()) return null;
        const closed = stOf(r) !== 'Open';
        const noteIn = h('input', { type: 'text', maxlength: '300', id: `rq-${r.id}-note`, placeholder: 'Admin note (shown to everyone)' });
        noteIn.value = r.note || '';
        const act = async (body, apply) => { cs.admMsg = ''; const res = await adminPost({ id: r.id, ...body }); if (res) apply(); else cs.admMsg = 'Could not save. Is the sheet script updated and redeployed?'; paintOne(); };
        const btn = (id, text, cls, fn) => h('button', { class: `btn ${cls || ''}`, type: 'button', id: `rq-${r.id}-${id}`, text, on: { click: fn } });
        return h('div', { class: 'admin-bar' }, h('strong', { text: 'Admin' }),
          h('div', { class: 'row' },
            btn('status', closed ? 'Reopen thread' : 'Close thread', '', () => act({ action: 'astatus', status: closed ? '' : 'Closed', note: noteIn.value }, () => { r.status = closed ? '' : 'Closed'; r.note = noteIn.value.trim(); })),
            btn('del', r.deleted ? 'Restore thread' : 'Delete thread', r.deleted ? '' : 'danger', () => { if (r.deleted || window.confirm('Delete this thread? Only admins will still see it (you can restore it).')) act({ action: 'adel', del: !r.deleted }, () => { r.deleted = !r.deleted; }); }),
            st.byId.get(r.code) && btn('edit', '✎ Edit case', 'primary', () => { cs.edit = true; nowOpen = true; paintOne(); })),
          h('div', { class: 'row' }, noteIn, btn('note', 'Save note', '', () => act({ action: 'astatus', note: noteIn.value }, () => { r.note = noteIn.value.trim(); }))),
          cs.admMsg && h('p', { class: 'notice err', role: 'alert', text: cs.admMsg }));
      };
      const paintOne = () => {
        const c = st.byId.get(r.code);
        const now = h('details', { class: 'rq-now', open: nowOpen, on: { toggle: (ev) => { nowOpen = ev.target.open; } } }, h('summary', { text: '👁 View the case now (full case, key and explanations)' }));
        if (nowOpen) now.append(c ? fullCase(c) : h('p', { class: 'muted', text: 'This case is no longer in the case list.' }));
        rendered = nowOpen;
        now.addEventListener('toggle', () => { if (now.open && !rendered) paintOne(); });
        const f = freshShown[r.id];
        root.className = `card rq-item${r.deleted ? ' deleted' : ''}`;
        root.replaceChildren(...[
          r.deleted && h('p', { class: 'notice err', text: '🗑 Deleted: only admins can see this thread.' }),
          adminBar(),
          cs.edit && c && (cs.ed || (cs.ed = adminEditor(c, () => { cs.edit = false; cs.ed = null; paintOne(); }))),
          h('p', {}, h('strong', { text: `No. ${r.no} · [${r.source}] ${r.title}` }), h('span', { class: 'muted', text: ` · ${stOf(r)} · ${r.t ? new Date(r.t).toLocaleString() : ''}` })),
          h('p', { class: 'muted', text: `Type: ${r.types}` }),
          h('p', { class: 'muted', text: `Reported by: ${r.by || 'Unknown'}` }),
          f && h('p', { class: 'notice ok', 'data-fresh': r.id, text: `🔔 New on your report: ${[f.up && `+${f.up} 👍`, f.down && `+${f.down} 👎`, f.c && `+${f.c} comment${f.c === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}` }),
          r.comment && h('p', {}, h('strong', { text: 'Comment: ' }), r.comment),
          r.note && h('p', { class: 'notice ok' }, h('strong', { text: 'Admin: ' }), r.note),
          now, repVoteRow(r, paintOne, cs, `rq-${r.id}`), repCommentBox(r, paintOne, cs, `rq-${r.id}`)].filter(Boolean));
      };
      paintOne();
      return root;
    };
    const paint = () => {
      const kids = [h('h2', { text: 'Reports & Discussion' }), h('p', { class: 'muted', text: 'Reports sent by everyone. Status is updated by the admin.' })];
      if (!REGISTRY_URL) kids.push(h('p', { class: 'muted', text: 'This site is not connected to the report sheet.' }));
      else if (!caseReports || caseReports.loading) kids.push(h('p', { class: 'muted', role: 'status', text: 'Loading reports…' }));
      else if (caseReports.error) kids.push(h('p', { class: 'notice err', role: 'alert', text: 'Could not load reports. Check your connection (the sheet script must be updated and redeployed).' }), h('button', { class: 'btn', type: 'button', text: 'Retry', on: { click: () => { caseReports = null; load(); } } }));
      else {
        const all = caseReports.list; const qq = repUi.query.trim().toLowerCase();
        const shown = all.filter((r) => (repUi.status === 'all' || stOf(r) === repUi.status) && (repUi.type === 'all' || T(r).includes(repUi.type)) && (!qq || `${r.title} ${r.source} ${r.no} ${r.comment}`.toLowerCase().includes(qq))).sort(cmp[repUi.sort] || cmp.new);
        const sel = (id, label, cur, opts, onc) => h('div', { class: 'sel' }, h('label', { for: id, text: label }),
          h('select', { id, on: { change: (ev) => { onc(ev.target.value); repUi.limit = 20; paint(); } } }, opts.map((o) => h('option', { value: o[0], text: o[1], selected: o[0] === cur }))));
        kids.push(sel('rp-sort', 'Sort by:', repUi.sort, SORTS, (v) => { repUi.sort = v; }),
          sel('rp-status', 'Status:', repUi.status, [['all', 'All'], ...uniq(all.map(stOf)).map((x) => [x, x])], (v) => { repUi.status = v; }),
          sel('rp-type', 'Type of error:', repUi.type, [['all', 'All'], ...uniq(all.flatMap(T)).map((x) => [x, x])], (v) => { repUi.type = v; }),
          h('label', { for: 'rp-query', text: 'Search case title / source / number / comment' }),
          h('input', { id: 'rp-query', type: 'text', value: repUi.query, autocomplete: 'off', on: { change: (ev) => { repUi.query = ev.target.value; repUi.limit = 20; paint(); } } }),
          h('p', { class: 'muted', id: 'rp-count', role: 'status', text: `${shown.length} of ${all.length} reports.` }));
        freshShown = { ...freshActivity(), ...pinnedFresh };
        const nf = Object.keys(freshShown).length;
        if (nf) kids.push(h('p', { class: 'notice ok', id: 'rp-fresh', role: 'status', text: `🔔 New activity on ${nf} of your report${nf === 1 ? '' : 's'} (marked below).` }));
        const part = shown.slice(0, repUi.limit);
        kids.push(h('div', { id: 'rp-list' }, part.length ? part.map(reportCard) : h('p', { class: 'muted', text: 'No reports match.' })));
        if (shown.length > part.length) kids.push(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', id: 'rp-more', text: `Show more (${shown.length - part.length} left)`, on: { click: () => { repUi.limit += 20; paint(); } } })));
      }
      card.replaceChildren(...kids.filter(Boolean));
      if (pendingScroll && card.querySelector(`[data-report-id="${pendingScroll}"]`)) {
        const id = pendingScroll; pendingScroll = null;
        setTimeout(() => { const el = document.querySelector(`[data-report-id="${id}"]`); if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); } }, 50);
      }
    };
    const load = async () => {
      if (!REGISTRY_URL || (caseReports && !caseReports.error)) return;
      caseReports = { loading: true }; paint();
      const list = await loadCaseReports();
      caseReports = list ? { list } : { error: true };
      renderBell();
      if (document.getElementById('reports-card')) paint();
    };
    mount(tabBar('reports'), card);
    paint(); load();
  }
  function repVoteRow(r, paint, cs, pre) {
    const cast = async (v) => {
      if (!st.user || r.busy) return;
      const prev = r.mine || 0; const next = prev === v ? 0 : v;
      r.busy = true;
      const res = await postJson({ action: 'rvote', id: r.id, device: st.user.id, vote: next });
      r.busy = false;
      if (!res) { cs.msg = 'Could not save your vote. Try again.'; paint(); return; }
      if (prev > 0) r.up = Math.max(0, (r.up || 0) - 1);
      if (prev < 0) r.down = Math.max(0, (r.down || 0) - 1);
      if (next > 0) r.up = (r.up || 0) + 1;
      if (next < 0) r.down = (r.down || 0) + 1;
      r.mine = next; cs.msg = ''; paint();
    };
    const btn = (v, label, n, id) => h('button', { class: `btn${(r.mine || 0) === v ? ' primary' : ''}`, type: 'button', id, 'aria-pressed': String((r.mine || 0) === v), text: `${label} ${n || 0}`, on: { click: () => cast(v) } });
    return h('div', { class: 'row' }, btn(1, '👍', r.up, `${pre}-up`), btn(-1, '👎', r.down, `${pre}-down`));
  }
  function repCommentBox(r, paint, cs, pre) {
    const ta = h('textarea', { id: `${pre}-ctext`, rows: '3', maxlength: '800', placeholder: 'Write a comment…', on: { input: (ev) => { cs.draft = ev.target.value; } } });
    ta.value = cs.draft || '';
    const send = async () => {
      const body = (cs.draft || '').trim();
      if (body.length < 2 || !st.user || cs.sending) return;
      const text = cs.replyTo ? `@[${cs.replyTo}] ${body}` : body;
      cs.sending = true;
      const res = await postJson({ action: 'rcomment', id: r.id, name: userLabel(), text });
      cs.sending = false;
      if (!res) { cs.msg = 'Could not send the comment. Try again.'; paint(); return; }
      (r.comments || (r.comments = [])).push({ t: Date.now(), name: userLabel(), text });
      cs.draft = ''; cs.msg = ''; cs.replyTo = ''; paint();
    };
    return h('div', { id: `${pre}-comments` }, h('h3', { text: `Comments (${(r.comments || []).length})` }),
      (r.comments || []).length ? r.comments.map((c) => { const rp = replyOf(c.text); return h('div', { class: 'qa' }, h('div', {}, h('strong', { text: c.name }), h('span', { class: 'muted', text: ` · ${c.t ? new Date(c.t).toLocaleString() : ''}` })),
        h('p', { class: 'prewrap' }, rp.to && h('span', { class: `mention${rp.to === userLabel() ? ' me' : ''}`, text: `@${rp.to}` }), rp.to && ' ', rp.text),
        c.hidden && h('p', { class: 'muted', text: '(hidden from users)' }),
        isAdmin() && c.cid && h('button', { class: 'btn reply-btn', type: 'button', text: c.hidden ? 'Unhide' : 'Hide', on: { click: async () => { const res = await adminPost({ action: 'ahide', id: r.id, cid: c.cid, hide: !c.hidden }); if (res) { c.hidden = !c.hidden; paint(); } } } }),
        c.name !== userLabel() && h('button', { class: 'btn reply-btn', type: 'button', text: '↩ Reply', on: { click: () => { cs.replyTo = c.name; paint(); const t = document.getElementById(`${pre}-ctext`); if (t) t.focus(); } } })); }) : h('p', { class: 'muted', text: 'No comments yet.' }),
      cs.replyTo && h('p', { class: 'muted reply-to' }, `Replying to ${cs.replyTo} `, h('button', { class: 'btn', type: 'button', text: '✕', 'aria-label': 'Cancel reply', on: { click: () => { cs.replyTo = ''; paint(); } } })),
      cs.msg && h('p', { class: 'notice err', role: 'alert', text: cs.msg }), ta,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', id: `${pre}-csend`, text: 'Send comment', on: { click: send } })));
  }

  /* ---- all questions ---- */
  function fullCase(c, o) {
    const tests = otherTests(c);
    const mark = o && o.opened;
    const n = mark ? tests.filter((x) => o.opened.has(x.label)).length : 0;
    return h('div', { class: 'full' },
      h('h3', { text: 'Clinical scenario' }), scenario(c),
      c.incomplete && h('p', { class: 'notice', text: 'This source case is incomplete (no history answers, test results or prescription).' }),
      h('h3', { text: 'Anamnesis (expected answers)' }),
      c.anamnesis.length ? c.anamnesis.map((x) => h('div', { class: 'qa' }, h('div', { class: 'q', text: x.q }), h('div', { text: x.a }))) : h('p', { class: 'muted', text: 'No anamnesis answers in the source.' }),
      h('h3', { text: 'Diagnostic results' }),
      mark && tests.length ? h('p', { class: 'muted', id: o.ids ? 'acc-sum' : null, text: `${n} of ${tests.length} supplementary examinations were accessed in stage 2.` }) : null,
      tests.length ? tests.map((x) => h('div', { class: 'tst' },
        h('h4', {}, x.label, aiTest(x), mark && h('span', { class: o.opened.has(x.label) ? 'badge acc' : 'badge no', text: o.opened.has(x.label) ? 'Accessed in stage 2' : 'Not accessed' })),
        resultBody(x, true))) : h('p', { class: 'muted', text: 'None.' }),
      h('h2', { class: 'sub', text: 'Answer key' }), keyBody(c, !!(o && o.ids)), editInfo(c));
  }
  function questions() {
    stopClock();
    const sources = [...new Set(st.cases.map((c) => c.source))];
    const sel = h('select', { id: 'q-source' }, h('option', { value: '', text: 'All sources' }), sources.map((x) => h('option', { value: x, text: x })));
    sel.value = st.source;
    const list = h('div', { id: 'q-list' });
    const done = doneIds();
    const paint = () => {
      st.source = sel.value;
      list.replaceChildren(...st.cases.filter((c) => !sel.value || c.source === sel.value).map((c) => {
        const d = h('details', { class: 'qd' }, h('summary', {}, h('span', { class: done.has(c.id) ? 'num acc' : 'num', text: `No. ${numOf(c)}` }), h('strong', { text: ` [${c.source}] ` }), c.title));
        d.addEventListener('toggle', () => { if (d.open && !d.querySelector('.full')) d.append(fullCase(c), isAdmin() ? adminCaseControl(c, paint) : null, caseReportControl(c)); }); // built on first open: keeps the page light
        return d;
      }));
    };
    sel.addEventListener('change', paint); paint();
    mount(tabBar('all'), h('div', { class: 'row' }, h('button', { class: 'btn', id: 'back', text: '← Back', on: { click: home } })),
      h('section', { class: 'card' }, h('h2', { text: 'All questions' }),
        h('p', { class: 'muted', text: 'Tap a case to see everything: scenario, physical examination, anamnesis, test results, explanations, diagnosis, prescription and more.' }),
        h('div', { class: 'sel' }, h('label', { for: 'q-source', text: 'Source:' }), sel), list));
  }

  /* ---- history of finished sessions ---- */
  const entryView = (e) => { const c = st.byId.get(e.id); return c ? [finishedCard(c, e), assessCard(e), extraCard(e), resultsCard(c, e, false)] : [missing(e)]; };
  function history() {
    stopClock();
    const all = loadHist();
    const items = all.slice().reverse();
    const del = (e) => { if (window.confirm(`Delete this session (${e.name}, ${when(e.t)})?`)) { saveHist(loadHist().filter((x) => x.t !== e.t)); history(); } };
    mount(h('div', { class: 'row' }, h('button', { class: 'btn', id: 'back', text: '← Back', on: { click: home } })),
      h('section', { class: 'card' }, h('h2', { text: `History (${all.length})` }),
        items.length ? [
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', id: 'pdf-all', text: 'Save all as PDF', on: { click: () => printView(items) } }),
            h('button', { class: 'btn', id: 'reports', text: 'Participant reports', on: { click: reports } }),
            h('button', { class: 'btn', id: 'clear', text: 'Delete all', on: { click: () => { if (window.confirm('Delete the whole history?')) { saveHist([]); history(); } } } })),
          items.map((e) => { const c = st.byId.get(e.id); return h('div', { class: 'li hist-item' },
            h('div', {}, h('strong', { text: e.name }), h('div', { class: 'muted', text: `${when(e.t)} · ${c ? `No. ${numOf(c)} · [${c.source}] ${c.title}` : 'case no longer available'}` })),
            h('div', { class: 'row' },
              h('button', { class: 'btn', text: 'View', on: { click: () => histView(e) } }),
              h('button', { class: 'btn', text: 'Save PDF', on: { click: () => printView([e]) } }),
              h('button', { class: 'btn', text: 'Delete', on: { click: () => del(e) } }))); }),
        ] : h('p', { class: 'muted', text: 'No finished sessions yet. A session is saved when you press Finish.' })));
  }
  function histView(e) {
    mount(h('div', { class: 'row noprint' }, h('button', { class: 'btn', id: 'back', text: '← Back to history', on: { click: history } }),
      h('button', { class: 'btn primary', id: 'pdf', text: 'Save as PDF', on: { click: doPrint } })), entryView(e));
  }
  /** One or many sessions on a printable page; the browser's print dialog offers “Save as PDF”. */
  const printView = (entries) => printBlocks(entries.map(entryView));
  function printBlocks(blocks) {
    mount(h('div', { class: 'row noprint' }, h('button', { class: 'btn', id: 'back', text: '← Back to history', on: { click: history } }),
      h('button', { class: 'btn primary', id: 'pdf', text: 'Print / Save as PDF', on: { click: doPrint } }),
      h('span', { class: 'muted', text: 'In the print dialog, choose “Save as PDF” as the destination.' })),
      blocks.map((b) => h('div', { class: 'entry' }, b)));
    setTimeout(doPrint, 400);
  }

  /* ---- load / login ---- */
  const validCase = (c) => c && typeof c.id === 'string' && c.brief && Array.isArray(c.anamnesis) && Array.isArray(c.tests);
  async function load() {
    mount(h('section', { class: 'card' }, h('p', { class: 'muted', text: 'Loading…' })));
    try {
      const env = await fetchEnvelope();
      const data = await decryptData(env, st.key);
      st.baseCases = (data.cases || []).filter(validCase);
      if (!st.baseCases.length) throw new DataError(`${DATA_URL} has no valid cases.`);
      st.user = loadUser();
      if (st.user) await Promise.race([loadRemote(true), new Promise((res) => setTimeout(res, 3500))]);
      st.cases = st.baseCases.map(remoteOf);
      st.byId = new Map(st.cases.map((c) => [c.id, c]));
      if (st.user) { registry.sync(); setTimeout(prefetchReports, 1500); home(); } else userStage(home, false);
    } catch (err) {
      if (err instanceof AuthError) { showLogin(); return; }
      mount(h('section', { class: 'card' }, h('h2', { text: 'Could not load cases' }), h('p', { text: err instanceof DataError ? err.message : 'Unexpected error.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Retry', on: { click: load } }))));
    }
  }
  function showLogin() { st.key = null; sess.clear(); mount(viewLogin()); }
  function viewLogin() {
    const err = h('p', { class: 'notice err', role: 'alert', hidden: true });
    const id = h('input', { id: 'login-id', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
    const pw = h('input', { id: 'login-pw', type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primary', type: 'submit', id: 'login-btn', text: 'Log in' });
    const fail = (msg) => { err.hidden = false; err.textContent = msg; pw.value = ''; btn.disabled = false; btn.textContent = 'Log in'; pw.focus(); };
    return h('form', {
      class: 'card', id: 'login-form', novalidate: true,
      on: {
        submit: async (e) => {
          e.preventDefault(); err.hidden = true; btn.disabled = true; btn.textContent = 'Checking…';
          try {
            const env = await fetchEnvelope();
            const key = await deriveKey(id.value, pw.value, env);
            await decryptData(env, key); // throws AuthError when the ID/password is wrong
            st.key = key;
            sess.set(b64e(new Uint8Array(await crypto.subtle.exportKey('raw', key))));
            load();
          } catch (ex) {
            if (ex instanceof AuthError) fail('Wrong ID or password.');
            else fail(ex instanceof DataError ? ex.message : 'Something went wrong. Please try again.');
          }
        },
      },
    },
      h('h2', { text: 'Login' }),
      h('label', { for: 'login-id', text: 'ID' }), id,
      h('label', { for: 'login-pw', text: 'Password' }), pw,
      err,
      h('div', { class: 'row' }, btn),
      h('p', { class: 'muted thanks', text: 'Thanks to: Allah SWT, Claude AI, and every question bank that went into my chat.' }));
  }

  window.OSCE_API = { h, mount, st, resultBody, scenario, lines, numOf, home, caseReportControl };

  (async () => {
    const saved = sess.get();
    if (saved) {
      try { st.key = await importKey(saved); load(); return; } catch (_) { sess.clear(); }
    }
    mount(viewLogin());
  })();
})();
