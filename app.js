(() => {
  'use strict';
  const DATA_URL = 'cases.enc'; // AES-GCM encrypted case database (see encrypt-data.js)
  const KEY_STORE = 'osce.key.v1';
  const T = { brief: 120, exam: 900, outside: 180 }; // seconds: examinee reads, examiner stage, segment outside the app
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
  const mount = (...n) => { app.replaceChildren(...n.flat().filter(Boolean)); window.scrollTo(0, 0); panelSet(false); };
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
      try { const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: 'follow' }); const d = await res.json(); return d && d.ok ? d : null; }
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
  function beep() {
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const c = new C(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination); g.gain.value = 0.15; o.frequency.value = 880; o.start(); o.stop(c.currentTime + 0.4);
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
  function startClock(secs, onDone) {
    stopClock(); clk.state = 'run'; clk.end = Date.now() + secs * 1000; clk.onDone = onDone;
    clk.tick = setInterval(() => {
      if (clk.state === 'run' && Date.now() >= clk.end) { clk.state = 'done'; beep(); clk.onDone(); }
      paintClock();
    }, 250);
  }
  function skipClock() { if (clk.state !== 'run') return; clk.state = 'skipped'; clk.onDone(); paintClock(); }
  function timerBlock() {
    const node = h('div', { class: 'timer', id: 'timer' });
    const skip = h('button', { class: 'btn', id: 'skip', text: 'Skip timer', on: { click: skipClock } });
    clk.node = node; clk.skipBtn = skip; paintClock();
    return h('div', {}, node, h('div', { class: 'row center' }, skip));
  }

  const cur = () => st.byId.get(st.caseId);
  const stageTotal = () => (st.assessOn ? 5 : 4);
  const stage = (n, label) => h('p', { class: 'stage', text: `Stage ${n} of ${stageTotal()} · ${label}` });
  const lines = (arr) => h('ul', {}, (arr || []).map((x) => h('li', { text: x })));

  /* ---- 0. setup ---- */
  function home() {
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
    mount(
      h('section', { class: 'card' },
        h('h2', { text: 'Start an OSCE case' }),
        st.user && h('p', { class: 'muted', id: 'user-line' }, `Signed in as ${st.user.name} (${st.user.university}). `, h('button', { class: 'linkbtn', type: 'button', id: 'change-user', text: 'Change name / university', on: { click: () => userStage(home, true) } })),
        h('p', { class: 'muted', id: 'visitors', text: visitorsText() }),
        h('p', { class: 'muted', text: `${st.cases.length} cases. Two people: the examiner operates the app, the examinee reads the case on screen first.` }),
        h('div', { class: 'sel' }, h('label', { for: 'source', text: 'Source:' }), srcSel),
        h('div', { class: 'sel' }, h('label', { for: 'case', text: 'Case:' }), caseSel),
        h('label', { class: 'chk', for: 'timer-on' }, tm, h('span', { text: 'Use timers (2 min read · 15 min examiner stage · 3 min outside the app)' })),
        h('label', { class: 'chk', for: 'assess-on' }, as, h('span', { text: 'Use the checklist assessment form (floating checklist in stages 2–3, completed in a extra stage, with scores in the results)' })),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', id: 'start', text: 'Start selected case', on: { click: () => go(caseSel.value) } }),
          h('button', { class: 'btn', id: 'random', text: 'Random case', on: { click: () => { const p = pool(); go(p[Math.floor(Math.random() * p.length)].id); } } }),
          h('button', { class: 'btn', id: 'logout', text: 'Log out', on: { click: () => { sess.clear(); window.location.reload(); } } }))),
      h('section', { class: 'card' }, h('h2', { text: 'Browse' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', id: 'all-q', text: `All questions (${st.cases.length})`, on: { click: () => questions() } }),
          h('button', { class: 'btn', id: 'hist', text: `History (${loadHist().length})`, on: { click: () => history() } }))),
      h('section', { class: 'card', id: 'changelog' }, h('h2', { text: 'Changelog' }),
        CHANGELOG.map((e, i) => h('details', { class: 'cl', open: i === 0 }, h('summary', {}, h('strong', { text: e.v }), ` · ${e.d}`), lines(e.items)))));
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
    if (st.timerOn) startClock(T.brief, () => { next.hidden = false; }); else stopClock();
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
    if (resume !== true) { if (st.timerOn) startClock(T.exam, () => {}); else stopClock(); st.reveal = false; }
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
      stage(2, 'Examiner'),
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
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'next2', text: 'Next: segment outside the app →', on: { click: outsideStage } })));
    panelSet(true);
  }

  /* ---- 3. segment outside the app (3 min) ---- */
  function outsideStage() {
    if (st.timerOn) startClock(T.outside, () => {}); else stopClock();
    mount(
      stage(3, 'Outside the application'),
      h('section', { class: 'card done' }, h('h2', { text: 'Continue the examination outside the app' }), st.timerOn && timerBlock(),
        h('p', { class: 'muted', text: 'Put the device aside. The examiner continues the rest of the assessment.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'finish', text: st.assessOn ? 'Next: complete the assessment →' : 'Finish', on: { click: () => (st.assessOn ? assessStage() : end()) } }))));
    panelSet(true);
  }

  /* ---- checklist assessment: the teacher's form (Form/Rubrik Penilaian; 10 rows, score 1–4, total 400, pass ≥ 250). Items stay in Indonesian. ---- */
  const PASS = 250;
  const cnt = (a, set) => a.items.filter((i) => set.has(i.id)).length;
  /** Teacher's definition: 1 none · 2 exactly one indicator · 3 some · 4 all. */
  const autoScore = (a, set) => { const k = cnt(a, set), n = a.items.length; return k === 0 ? 1 : k === n ? 4 : k === 1 ? 2 : 3; };
  /** unit = points per score step (row max = unit × 4); pct = the weight printed on the form. */
  const R = (no, name, pct, unit, items) => ({ id: `r${no}`, no, name, pct, unit, items: items.map((t, i) => ({ id: `${no}.${i + 1}`, t })) });
  const ASSESS = [
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
  ].map((g) => ({ ...g, items: g.items.map((it, i) => ({ ...it, id: `${g.id}.${i + 1}` })) })) };
  EXTRA.items = EXTRA.groups.flatMap((g) => g.items.map((i) => ({ ...i, g })));
  const ALL_ITEMS = ASSESS.flatMap((S) => S.aspects.flatMap((a) => a.items.map((i) => ({ ...i, S, a }))));
  const num1 = (x) => (Math.round(x * 10) / 10).toString();
  /** Score per row 1–4: from the ticked items unless the examiner set it by hand (`ovr`: row id → 1–4). Points = unit × score; total out of 400. */
  function compute(set, ovr) {
    const stations = ASSESS.map((S) => {
      const aspects = S.aspects.map((a) => { const manual = ovr && ovr[a.id]; const score = manual || autoScore(a, set); return { a, score, manual: !!manual, earned: a.unit * score }; });
      return { S, aspects, earned: aspects.reduce((t, x) => t + x.earned, 0), max: S.aspects.reduce((t, a) => t + a.unit * 4, 0) };
    });
    const earned = stations.reduce((t, x) => t + x.earned, 0);
    return { stations, earned, max: stations.reduce((t, x) => t + x.max, 0), pass: earned >= PASS };
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
    if (t) t.textContent = `${num1(compute(st.chk, st.ovr).earned)}/400 · ${st.chk.size}/${ALL_ITEMS.length}`;
  }
  /* floating, minimizable panel shown in stages 2–3 */
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
    mount(stage(4, 'Complete the assessment'),
      answerKeyCard(cur()),
      h('section', { class: 'card' }, h('h2', { text: 'Lengkapi penilaian' }),
        h('p', { class: 'muted', text: `Tick anything you have not marked yet (the extra checklist at the bottom is not scored). The answer key above is for the examiner. Tests requested by the examinee in stage 2: ${[...st.opened].length} of ${otherTests(cur()).length}.` }),
        checklistNode()),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'next4', text: 'Next: results →', on: { click: end } })));
  }
  /** Assessment results: scores per aspect and what was not done. */
  function assessCard(e) {
    if (!e || !e.assess || e.form !== 2) return null;
    const set = new Set(e.chk || []);
    const r = compute(set, e.ovr);
    return h('section', { class: 'card', id: 'assess-res' }, h('h2', { text: 'Assessment results' }),
      h('p', { class: 'big', text: `${num1(r.earned)} / ${r.max}` }),
      h('p', { class: r.pass ? 'pass' : 'fail', text: r.pass ? `Lulus (${PASS}–${r.max})` : `Tidak lulus (di bawah ${PASS})` }),
      r.stations.map((x) => [
        h('h3', { text: `${x.S.title} · ${num1(x.earned)} / ${x.max}` }),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'lab' },
          h('thead', {}, h('tr', {}, ['No', 'Aspek yang dinilai', 'Skor (1–4)', 'Bobot', 'Nilai'].map((t) => h('th', { text: t })))),
          h('tbody', {}, x.aspects.map((y) => h('tr', {}, h('td', { text: String(y.a.no) }), h('td', { text: y.a.name }), h('td', { text: `${y.score}${y.manual ? ' (manual)' : ''}` }), h('td', { text: `${y.a.pct}%` }), h('td', { text: `${num1(y.earned)} / ${y.a.unit * 4}` })))))),
        (() => { const miss = x.S.aspects.flatMap((a) => a.items.filter((i) => !set.has(i.id)).map((i) => [a, i]));
          return miss.length ? [h('h4', { text: 'Belum dilakukan' }), h('ul', {}, miss.map(([a, i]) => h('li', {}, h('strong', { text: `${a.no}. ${a.name}: ` }), i.t)))] : h('p', { class: 'muted', text: 'Semua kriteria dilakukan.' }); })()]),
      h('p', { class: 'muted', text: 'Skor tiap baris: 1 = tidak satu pun indikator, 2 = salah satu, 3 = sebagian, 4 = seluruh indikator; dihitung dari butir yang dicentang kecuali diubah manual. Nilai = bobot poin × skor, total 400, lulus ≥ 250.' }));
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
    for (const e of loadHist()) { if (!e.assess || e.form !== 2) continue; const k = nameKey(e.name); if (!m.has(k)) m.set(k, { key: k, name: e.name, list: [] }); const p = m.get(k); p.name = e.name; p.list.push(e); }
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
        h('p', { class: 'muted', text: `${n} session${n === 1 ? '' : 's'} with the assessment form · average total ${num1(avg((r) => r.earned))} / 400 · passed ${rs.filter((x) => x.r.pass).length} of ${n}` }),
        h('h3', { text: 'Score over time' }),
        lineChart(rs.map((x) => x.r.earned), p.list.map((e) => new Date(e.t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })), { title: 'Total score per session', max: 400, ref: 250, refLabel: 'Pass 250', color: '#2563eb' }),
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
      if (st.assessOn) { st.entry.assess = true; st.entry.form = 2; st.entry.chk = [...st.chk]; st.entry.xchk = [...st.xchk]; st.entry.ovr = { ...st.ovr }; }
      const a = loadHist(); a.push(st.entry); saveHist(a);
    }
    mount(stage(stageTotal(), 'Examination results'), finishedCard(c, st.entry), assessCard(st.entry), extraCard(st.entry), resultsCard(c, st.entry, true),
      h('div', { class: 'row noprint' },
        h('button', { class: 'btn primary', id: 'again', text: 'New case', on: { click: home } }),
        h('button', { class: 'btn', id: 'pdf', text: 'Save as PDF', on: { click: doPrint } }),
        h('button', { class: 'btn', id: 'to-hist', text: 'History', on: { click: () => history() } })));
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
      h('h2', { class: 'sub', text: 'Answer key' }), keyBody(c, !!(o && o.ids)));
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
        d.addEventListener('toggle', () => { if (d.open && !d.querySelector('.full')) d.append(fullCase(c)); }); // built on first open: keeps the page light
        return d;
      }));
    };
    sel.addEventListener('change', paint); paint();
    mount(h('div', { class: 'row' }, h('button', { class: 'btn', id: 'back', text: '← Back', on: { click: home } })),
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
      st.cases = (data.cases || []).filter(validCase);
      if (!st.cases.length) throw new DataError(`${DATA_URL} has no valid cases.`);
      st.byId = new Map(st.cases.map((c) => [c.id, c]));
      st.user = loadUser();
      if (st.user) { registry.sync(); home(); } else userStage(home, false);
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

  (async () => {
    const saved = sess.get();
    if (saved) {
      try { st.key = await importKey(saved); load(); return; } catch (_) { sess.clear(); }
    }
    mount(viewLogin());
  })();
})();
