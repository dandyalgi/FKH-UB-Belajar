(() => {
  'use strict';

  /* ======================================================================
   * Config
   * ==================================================================== */
  const BANK_URL = 'bank.enc'; // AES-GCM encrypted question bank (see encrypt-bank.js)
  const FETCH_TIMEOUT_MS = 10000;
  const DEFAULT_COUNT = 10;
  /** Google Apps Script web-app URL that stores participant names (see config.js). Empty = names stay on this device only. */
  const REGISTRY_URL = String((window.QUIZ_CONFIG && window.QUIZ_CONFIG.registryUrl) || '');
  /** Newest first. Add an entry here whenever the app changes. */
  const CHANGELOG = [
    { date: '2026-11-07', items: [
      'Report a question: next to "Mark for review" there is now a "Report" button (incorrect question, answer choices, answer key, explanation, category, or other, plus an optional comment). Reports go to the admin\'s Google Sheet.',
      'New "How Quiz Time works" card on the main menu: the workflow, where your data is stored, and how to move your progress to another device.' ] },
    { date: '2026-11-05', items: [
      'Source names: "Sigap" is now "External 1" (batch numbers unchanged).',
      'The question code (for example q12) is shown next to the category and source.',
      'Added this changelog to the main menu.',
      'After login you enter your name and university once; the main menu shows how many participants have used Quiz Time.',
      'All menus are now in English.' ] },
    { date: '2026-11-04', items: [
      'New checkbox when starting a test: include questions already answered correctly.',
      'Exam history: see every finished exam (answered questions only) and retake the same questions.',
      'Login now lasts for the current tab only; use Import / export to back up or move your progress.' ] },
    { date: 'Earlier', items: [
      'Question bank is encrypted and needs the ID and password.',
      'Category and source selection with checkboxes, in the test form and in Browse.',
      'Review after a test is grouped (incorrect, correct, unanswered) with an option to show answers and explanations.',
      'Option to include AI-generated questions and answers.',
      'Typos and broken options in the bank were fixed.' ] },
  ];
  const MAX_OPTIONS = 5; // A to E
  const ALL = '__all__';
  const KEYS = Object.freeze({
    progress: 'quiz.progress.v1', // { [questionId]: 'correct' | 'incorrect' }
    session: 'quiz.session.v1',   // { ids: string[], index: number, answers: { [id]: number } }
    key: 'quiz.key.v1',           // derived decryption key (base64); kept for this tab only (sessionStorage)
    custom: 'quiz.custom.v1',     // questions imported in this browser
    user: 'quiz.user.v1',         // { id, name } of the participant on this browser
    edits: 'quiz.edits.v1',       // answer-key edits made in this browser
    history: 'quiz.history.v1',   // [{ t, ids, a }] completed exams, newest last
  });
  const STATUS_LABEL = Object.freeze({
    correct: 'Correct',
    incorrect: 'Incorrect',
    unattempted: 'Not attempted',
  });

  class DataError extends Error {}
  class AuthError extends Error {}

  /* ======================================================================
   * Crypto: the bank is stored encrypted (PBKDF2-SHA256 -> AES-256-GCM).
   * The key comes from "id:password", so the data is unreadable without them.
   * ==================================================================== */
  const enc = new TextEncoder();
  const b64d = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  const b64e = (u8) => {
    let out = '';
    for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(out);
  };
  async function deriveKey(id, password, env) {
    const base = await crypto.subtle.importKey('raw', enc.encode(`${id.trim().toLowerCase()}:${password}`), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64d(env.salt), iterations: env.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  const importKey = (b64) => crypto.subtle.importKey('raw', b64d(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  async function decryptBank(env, key) {
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct)); }
    catch (_) { throw new AuthError('wrong key'); }
    try { return JSON.parse(new TextDecoder().decode(plain)); }
    catch (_) { throw new DataError(`${BANK_URL} is not valid JSON.`); }
  }
  async function encryptBank(env, key, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data, null, 2) + '\n'));
    return { v: 1, iter: env.iter, salt: env.salt, iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
  }

  /* ======================================================================
   * Storage (never throws)
   * ==================================================================== */
  const storage = (() => {
    let available = true;
    return {
      read(key, fallback) {
        let raw;
        try { raw = window.localStorage.getItem(key); } catch (_) { available = false; return fallback; }
        if (raw === null) return fallback;
        try { return JSON.parse(raw); } catch (_) { return fallback; }
      },
      write(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (_) { available = false; return false; }
      },
      remove(key) {
        try { window.localStorage.removeItem(key); } catch (_) { available = false; }
      },
      get available() { return available; },
    };
  })();

  /** Login key lives in sessionStorage: closing the tab logs out, saved progress is untouched. */
  const sess = {
    get() { try { return window.sessionStorage.getItem(KEYS.key); } catch (_) { return null; } },
    set(v) { try { window.sessionStorage.setItem(KEYS.key, v); } catch (_) { /* login just won't survive a reload */ } },
    clear() { try { window.sessionStorage.removeItem(KEYS.key); } catch (_) { /* ignore */ } },
  };
  storage.remove(KEYS.key); // earlier versions kept the key in localStorage

  /* ======================================================================
   * Pure helpers and domain logic (no DOM)
   * ==================================================================== */
  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const letter = (i) => String.fromCharCode(65 + i);
  /** "Category · Source · code", where Source is "-" when the question has none. */
  const labelOf = (q) => `${q.category} · ${q.source} · ${q.id}`;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Validates one raw question. Returns { value } (frozen) or { error }. */
  function normalizeQuestion(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an object' };
    if (!isText(raw.id)) return { error: 'missing "id"' };
    if (!isText(raw.question)) return { error: 'missing "question"' };
    if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > MAX_OPTIONS || !raw.options.every(isText)) {
      return { error: `"options" must be 2 to ${MAX_OPTIONS} non-empty strings (A to ${letter(MAX_OPTIONS - 1)})` };
    }
    if (!Number.isInteger(raw.correctIndex) || raw.correctIndex < 0 || raw.correctIndex >= raw.options.length) {
      return { error: '"correctIndex" must be a whole number pointing to an option (null is not allowed)' };
    }
    return {
      value: Object.freeze({
        id: raw.id.trim(),
        category: isText(raw.category) ? raw.category.trim() : 'Uncategorized',
        source: isText(raw.source) ? raw.source.trim() : '-',
        question: raw.question,
        options: Object.freeze([...raw.options]),
        correctIndex: raw.correctIndex,
        explanation: typeof raw.explanation === 'string' ? raw.explanation : '',
        aiGenerated: raw.aiGenerated === true,
      }),
    };
  }

  function parseBank(raw) {
    if (!Array.isArray(raw)) throw new DataError(`${BANK_URL} must contain a JSON array of questions.`);
    const valid = [];
    const problems = [];
    const seen = new Set();
    raw.forEach((item, i) => {
      const label = item && typeof item.id === 'string' ? item.id : `#${i + 1}`;
      const r = normalizeQuestion(item);
      if (r.error) { problems.push(`${label}: ${r.error}`); return; }
      if (seen.has(r.value.id)) { problems.push(`${label}: duplicate id`); return; }
      seen.add(r.value.id);
      valid.push(r.value);
    });
    if (!valid.length) throw new DataError(`${BANK_URL} has no valid questions.`);
    return { valid, problems };
  }

  function computeStats(questions, progress) {
    const total = { total: 0, correct: 0, incorrect: 0, unattempted: 0 };
    const cats = new Map();
    for (const q of questions) {
      const s = progress[q.id] || 'unattempted';
      if (!cats.has(q.category)) {
        cats.set(q.category, { category: q.category, total: 0, correct: 0, incorrect: 0, unattempted: 0 });
      }
      const c = cats.get(q.category);
      c.total++; c[s]++;
      total.total++; total[s]++;
    }
    const categories = [...cats.values()].sort((a, b) => a.category.localeCompare(b.category));
    return { total, categories };
  }

  /**
   * Questions for a new test: not attempted yet or answered incorrectly.
   * If everything in the selection is already correct, the whole selection
   * becomes available again (repeat = true).
   */
  const inSet = (set, v) => set === null || set.has(v);

  /** scope = { cats, srcs }: each is null (everything) or a Set of selected values. */
  function examPool(questions, progress, scope, includeAi = true, includeCorrect = false) {
    const inScope = questions.filter((q) => inSet(scope.cats, q.category) && inSet(scope.srcs, q.source) && (includeAi || !q.aiGenerated));
    if (includeCorrect) return { pool: inScope, repeat: false };
    const fresh = inScope.filter((q) => progress[q.id] !== 'correct');
    if (fresh.length || !inScope.length) return { pool: fresh, repeat: false };
    return { pool: inScope, repeat: true };
  }

  /** Random draw that rotates across categories so each is represented evenly. */
  function balancedDraw(pool, n) {
    const groups = new Map();
    for (const q of shuffle(pool)) {
      if (!groups.has(q.category)) groups.set(q.category, []);
      groups.get(q.category).push(q);
    }
    let lists = [...groups.values()];
    const picked = [];
    while (picked.length < n && lists.length) {
      lists = shuffle(lists);
      for (const list of lists) {
        if (picked.length >= n) break;
        picked.push(list.pop());
      }
      lists = lists.filter((l) => l.length);
    }
    return shuffle(picked);
  }

  const toPlain = (q) => ({
    id: q.id,
    category: q.category,
    source: q.source,
    question: q.question,
    options: [...q.options],
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    aiGenerated: q.aiGenerated,
  });

  /* ======================================================================
   * State (private to this closure) and state machine
   * ==================================================================== */
  const TRANSITIONS = Object.freeze({
    INIT: ['LOADING', 'ERROR'],
    LOADING: ['SETUP', 'ACTIVE', 'RESULTS', 'ERROR'],
    SETUP: ['ACTIVE', 'ERROR'],
    ACTIVE: ['RESULTS', 'SETUP', 'ERROR'],
    RESULTS: ['SETUP', 'ERROR'],
    ERROR: ['LOADING'],
  });

  /** UI-only state for the SETUP screen: panel = 'home' | 'browse' | 'manage'. */
  function freshUi(panel = 'home') {
    return { panel, notice: null, filter: { status: 'all', cats: null, srcs: null, query: '', reveal: false } };
  }

  const state = {
    machine: 'INIT',
    bank: [],
    problems: [],
    custom: [],
    edits: Object.create(null), // { [id]: { correctIndex, explanation, aiGenerated } }
    baseById: new Map(),        // questions as stored in bank.json / imports, before edits
    questions: [],              // effective questions (base + edits)
    byId: new Map(),
    progress: Object.create(null),
    session: null,
    includeAi: true,
    includeCorrect: false,
    history: [],
    key: null,                  // CryptoKey once logged in
    env: null,                  // envelope of the loaded bank (salt, iterations)
    scope: { cats: null, srcs: null }, // exam setup selection; null = everything
    error: null,
    ui: freshUi(),
    user: null,                 // { id, name }
    participants: null,         // number of participants, when the registry is configured
  };

  function transition(to) {
    if (!TRANSITIONS[state.machine].includes(to)) {
      throw new Error(`Illegal transition ${state.machine} -> ${to}`);
    }
    state.machine = to;
  }

  function applyEdit(q) {
    const e = state.edits[q.id];
    if (!e || !Number.isInteger(e.correctIndex) || e.correctIndex < 0 || e.correctIndex >= q.options.length) return q;
    return Object.freeze({
      ...q,
      correctIndex: e.correctIndex,
      explanation: typeof e.explanation === 'string' ? e.explanation : q.explanation,
      aiGenerated: e.aiGenerated === true,
    });
  }

  function rebuildQuestions() {
    const seen = new Set();
    const base = [];
    for (const q of [...state.bank, ...state.custom]) {
      if (!seen.has(q.id)) { seen.add(q.id); base.push(q); }
    }
    state.baseById = new Map(base.map((q) => [q.id, q]));
    state.questions = base.map(applyEdit);
    state.byId = new Map(state.questions.map((q) => [q.id, q]));
    // The bank changed (load or import): any category/source it adds must be selectable, so go back to "all".
    state.scope = { cats: null, srcs: null };
    if (state.ui && state.ui.filter) { state.ui.filter.cats = null; state.ui.filter.srcs = null; }
  }

  function nextIdNumber() {
    let max = 0;
    for (const q of state.questions) {
      const m = /^q(\d+)$/.exec(q.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  /* ---- persistence ---- */
  const saveProgress = () => storage.write(KEYS.progress, state.progress);
  const saveCustom = () => storage.write(KEYS.custom, state.custom.map(toPlain));
  const saveEdits = () => storage.write(KEYS.edits, state.edits);
  function saveSession() {
    if (state.session) storage.write(KEYS.session, state.session);
    else storage.remove(KEYS.session);
  }

  const HISTORY_MAX = 200;
  const saveHistory = () => storage.write(KEYS.history, state.history);
  function loadHistory() {
    const raw = storage.read(KEYS.history, []);
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const e of raw) {
      if (!e || typeof e !== 'object' || !Array.isArray(e.ids) || !Array.isArray(e.a)) continue;
      if (!Number.isFinite(e.t) || !e.ids.length || e.ids.length !== e.a.length) continue;
      if (!e.ids.every((id) => typeof id === 'string') || !e.a.every((x) => Number.isInteger(x))) continue;
      out.push({ t: e.t, ids: e.ids, a: e.a });
    }
    return out.slice(-HISTORY_MAX);
  }

  /* ---- participants (name + count, stored in a Google Sheet through an Apps Script web app) ---- */
  function loadUser() {
    const raw = storage.read(KEYS.user, null);
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    return { id: raw.id, name: raw.name.trim().slice(0, 60), university: typeof raw.university === 'string' ? raw.university.trim().slice(0, 80) : '' };
  }
  function newDeviceId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* fall through */ }
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const registry = {
    async call(init) {
      if (!REGISTRY_URL) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(REGISTRY_URL, { ...init, signal: ctrl.signal, redirect: 'follow' });
        const data = await res.json();
        return data && data.ok ? data : null;
      } catch (_) { return null; } finally { clearTimeout(timer); }
    },
    /** Upsert this participant (also counts a visit). Never blocks the app; failures are retried on the next start. */
    async sync() {
      if (!state.user) return;
      const data = await this.call({ method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ id: state.user.id, name: state.user.name, university: state.user.university || '' }) });
      if (data && Number.isInteger(data.count)) setParticipants(data.count);
    },
    async count() {
      const data = await this.call({ method: 'GET' });
      if (data && Number.isInteger(data.count)) setParticipants(data.count);
      return data ? data.count : null;
    },
  };
  function setParticipants(n) {
    state.participants = n;
    const el = document.getElementById('participants');
    if (el) el.textContent = participantsText();
  }
  const participantsText = () => (state.participants === null ? '' : `${state.participants} participant${state.participants === 1 ? ' has' : 's have'} used Quiz Time.`);

  function loadProgress() {
    const raw = storage.read(KEYS.progress, {});
    const out = Object.create(null);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, v] of Object.entries(raw)) {
        if (v === 'correct' || v === 'incorrect') out[id] = v;
      }
    }
    return out;
  }

  function loadCustom() {
    const raw = storage.read(KEYS.custom, []);
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      const r = normalizeQuestion(item);
      if (r.value && !seen.has(r.value.id)) { seen.add(r.value.id); out.push(r.value); }
    }
    return out;
  }

  function loadEdits() {
    const raw = storage.read(KEYS.edits, {});
    const out = Object.create(null);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, e] of Object.entries(raw)) {
        if (e && Number.isInteger(e.correctIndex) && typeof e.explanation === 'string') {
          out[id] = { correctIndex: e.correctIndex, explanation: e.explanation, aiGenerated: e.aiGenerated === true };
        }
      }
    }
    return out;
  }

  /** Drops edits whose question is gone or that now match the committed bank.json. */
  function pruneEdits() {
    let changed = false;
    for (const [id, e] of Object.entries(state.edits)) {
      const base = state.baseById.get(id);
      const same = base && e.correctIndex === base.correctIndex
        && e.explanation === base.explanation && e.aiGenerated === base.aiGenerated;
      if (!base || same) { delete state.edits[id]; changed = true; }
    }
    if (changed) saveEdits();
  }

  function loadSession() {
    const raw = storage.read(KEYS.session, null);
    if (!raw || !Array.isArray(raw.ids)) return null;
    const ids = [...new Set(raw.ids.filter((id) => typeof id === 'string' && state.byId.has(id)))];
    if (!ids.length) return null;
    const answers = Object.create(null);
    const rawAnswers = raw.answers && typeof raw.answers === 'object' ? raw.answers : {};
    for (const id of ids) {
      const c = rawAnswers[id];
      if (Number.isInteger(c) && c >= 0 && c < state.byId.get(id).options.length) answers[id] = c;
    }
    let index = Number.isInteger(raw.index) ? raw.index : 0;
    const legacyFinished = raw.submitted === undefined && index >= ids.length;
    index = Math.max(0, Math.min(index, ids.length - 1));
    const marked = Object.create(null);
    const rawMarked = raw.marked && typeof raw.marked === 'object' ? raw.marked : {};
    for (const id of ids) if (rawMarked[id] === true) marked[id] = true;
    return { ids, index, answers, marked, submitted: raw.submitted === true || legacyFinished };
  }

  /* ---- loading ---- */
  async function fetchEnvelope() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS * 3);
    try {
      const res = await fetch(BANK_URL, { cache: 'no-cache', signal: ctrl.signal });
      if (!res.ok) throw new DataError(`Could not load ${BANK_URL} (HTTP ${res.status}).`);
      let env;
      try { env = await res.json(); }
      catch (_) { throw new DataError(`${BANK_URL} is not valid.`); }
      if (!env || !env.salt || !env.iv || !env.ct || !Number.isInteger(env.iter)) throw new DataError(`${BANK_URL} is not valid.`);
      return env;
    } catch (err) {
      if (err instanceof DataError) throw err;
      if (err && err.name === 'AbortError') throw new DataError('Loading timed out. Check your connection and retry.');
      throw new DataError('Network error while loading questions. Check your connection and retry.');
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchBank() {
    if (!state.key) throw new AuthError('not logged in');
    const env = await fetchEnvelope();
    const data = await decryptBank(env, state.key);
    state.env = env;
    return data;
  }

  async function boot() {
    transition('LOADING');
    render();
    try {
      const { valid, problems } = parseBank(await fetchBank());
      state.bank = valid;
      state.problems = problems;

      // Local imports that are now part of the committed bank are dropped.
      const bankIds = new Set(valid.map((q) => q.id));
      const custom = loadCustom();
      state.custom = custom.filter((q) => !bankIds.has(q.id));
      if (state.custom.length !== custom.length) saveCustom();

      state.edits = loadEdits();
      rebuildQuestions();
      pruneEdits();
      state.progress = loadProgress();
      state.session = loadSession();
      registry.sync();
      state.history = loadHistory();
      state.ui = freshUi();

      if (!state.session) transition('SETUP');
      else transition(state.session.submitted ? 'RESULTS' : 'ACTIVE');
    } catch (err) {
      if (err instanceof AuthError) { showLogin(); return; }
      state.error = err instanceof DataError ? err.message : 'Unexpected error while starting the app.';
      if (!(err instanceof DataError)) console.error(err);
      transition('ERROR');
    }
    render();
  }

  /* ---- actions ---- */
  function startTest(scope, count, includeAi, includeCorrect) {
    resetReport();
    const { pool } = examPool(state.questions, state.progress, scope, includeAi, includeCorrect);
    if (!pool.length) return;
    const n = Math.max(1, Math.min(count, pool.length));
    const ids = balancedDraw(pool, n).map((q) => q.id);
    state.session = { ids, index: 0, answers: Object.create(null), marked: Object.create(null), submitted: false };
    saveSession();
    transition('ACTIVE');
    render();
  }

  /** Start an exam from a fixed list of question ids (retake). Returns how many ids were skipped. */
  function startFromIds(rawIds) {
    resetReport();
    const ids = rawIds.filter((id) => state.byId.has(id));
    if (!ids.length) return -1;
    state.session = { ids, index: 0, answers: Object.create(null), marked: Object.create(null), submitted: false };
    saveSession();
    transition('ACTIVE');
    render();
    return rawIds.length - ids.length;
  }

  function currentQuestion() {
    return state.byId.get(state.session.ids[state.session.index]);
  }

  /* Exam mode: choices are drafts until the exam is submitted. */
  function selectOption(i) {
    const q = currentQuestion();
    state.session.answers[q.id] = i;
    saveSession();
    render(`button.option[data-i="${i}"]`);
  }

  function clearAnswer() {
    delete state.session.answers[currentQuestion().id];
    saveSession();
    render('#mark-btn');
  }

  function toggleMark() {
    const id = currentQuestion().id;
    const marked = state.session.marked;
    if (marked[id]) delete marked[id]; else marked[id] = true;
    saveSession();
    render('#mark-btn');
  }

  function goTo(i) {
    const s = state.session;
    s.index = Math.max(0, Math.min(i, s.ids.length - 1));
    saveSession();
    render();
  }

  /** Grades the exam. Only answered questions change status; unanswered ones keep theirs. */
  function submitExam() {
    resetReport();
    const s = state.session;
    for (const id of s.ids) {
      const choice = s.answers[id];
      if (choice === undefined) continue;
      state.progress[id] = choice === state.byId.get(id).correctIndex ? 'correct' : 'incorrect';
    }
    s.submitted = true;
    const answered = s.ids.filter((id) => s.answers[id] !== undefined);
    if (answered.length) {
      state.history.push({ t: Date.now(), ids: answered, a: answered.map((id) => s.answers[id]) });
      if (state.history.length > HISTORY_MAX) state.history = state.history.slice(-HISTORY_MAX);
      saveHistory();
    }
    saveProgress();
    saveSession();
    transition('RESULTS');
    render();
  }

  function leaveTest() {
    resetReport();
    state.session = null;
    saveSession();
    state.ui = freshUi();
    transition('SETUP');
    render();
  }

  function retakeFromResults() {
    const ids = state.session.ids.slice();
    state.session = null;
    state.ui = freshUi();
    transition('SETUP');
    startFromIds(ids);
  }

  function resetProgress() {
    state.progress = Object.create(null);
    saveProgress();
    render();
  }

  /* ---- progress backup (export / import) ---- */
  const PROGRESS_FORMAT = 'quiz-trainer-progress';

  function exportProgress() {
    const data = {
      app: PROGRESS_FORMAT,
      v: 1,
      exportedAt: new Date().toISOString(),
      progress: state.progress,
      edits: state.edits,
      custom: state.custom.map(toPlain),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `progress-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Restores a progress backup. Merge keeps current progress and lets the file win on conflicts. */
  function importProgress(text, replace) {
    let data;
    try { data = JSON.parse(text); } catch (_) { return { ok: false, message: 'That file is not valid JSON.' }; }
    if (!data || data.app !== PROGRESS_FORMAT || !data.progress || typeof data.progress !== 'object' || Array.isArray(data.progress)) {
      return { ok: false, message: 'That is not a progress backup made by this app.' };
    }
    const progress = replace ? Object.create(null) : Object.assign(Object.create(null), state.progress);
    let restored = 0;
    let skipped = 0;

    // Questions that were imported locally on the other device come first so their progress can attach.
    if (Array.isArray(data.custom)) {
      const toAdd = [];
      for (const raw of data.custom) {
        const r = normalizeQuestion(raw);
        if (r.value && !state.byId.has(r.value.id) && !toAdd.some((q) => q.id === r.value.id)) toAdd.push(r.value);
      }
      if (toAdd.length) addCustom(toAdd);
    }
    for (const [id, v] of Object.entries(data.progress)) {
      if ((v === 'correct' || v === 'incorrect') && state.byId.has(id)) { progress[id] = v; restored++; } else skipped++;
    }
    if (data.edits && typeof data.edits === 'object' && !Array.isArray(data.edits)) {
      if (replace) state.edits = Object.create(null);
      for (const [id, e] of Object.entries(data.edits)) {
        const base = state.baseById.get(id);
        if (base && e && Number.isInteger(e.correctIndex) && e.correctIndex >= 0 && e.correctIndex < base.options.length && typeof e.explanation === 'string') {
          state.edits[id] = { correctIndex: e.correctIndex, explanation: e.explanation, aiGenerated: e.aiGenerated === true };
        }
      }
      rebuildQuestions();
      pruneEdits();
      saveEdits();
    }
    state.progress = progress;
    saveProgress();
    return {
      ok: true,
      message: `Restored progress for ${restored} question(s)${skipped ? `; ${skipped} entr${skipped === 1 ? 'y' : 'ies'} skipped (question no longer in the bank)` : ''}.`
        + (storage.available ? '' : ' Warning: browser storage is unavailable, so this will be lost on refresh.'),
    };
  }

  /* ---- report a question (sent to the Google Sheet through the same Apps Script) ---- */
  const REPORT_TYPES = ['Incorrect question', 'Incorrect answer choices', 'Incorrect answer key', 'Incorrect explanation', 'Incorrect category', 'Other'];
  const reportDraft = { id: null, open: false, types: new Set(), comment: '', sending: false, msg: null };
  const reportedIds = new Set(); // questions reported during this visit
  function resetReport() { reportDraft.id = null; reportDraft.open = false; reportDraft.types.clear(); reportDraft.comment = ''; reportDraft.sending = false; reportDraft.msg = null; }
  function toggleReport() {
    const q = currentQuestion();
    if (reportDraft.id !== q.id) { resetReport(); reportDraft.id = q.id; }
    reportDraft.open = !reportDraft.open;
    render(reportDraft.open ? '#report-box input' : '#report-btn');
  }
  async function sendReport() {
    const q = currentQuestion();
    const d = reportDraft;
    const fail = (text) => { d.msg = { type: 'err', text }; render('#report-send'); };
    if (d.sending) return;
    if (!d.types.size) return fail('Select at least one type of error.');
    if (d.types.size === 1 && d.types.has('Other') && !d.comment.trim()) return fail('Please describe the problem in the comment box.');
    if (!REGISTRY_URL) return fail('Reporting is not available: this site is not connected to the report sheet.');
    d.sending = true; d.msg = { type: 'ok', text: 'Sending…' }; render('#report-send');
    const reporter = state.user ? `${state.user.name}${state.user.university ? ` (${state.user.university})` : ''}` : 'Unknown';
    const res = await registry.call({
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'report', reporter, code: q.id, types: [...d.types], category: q.category,
        question: q.question, choices: q.options.map((t, i) => `${letter(i)}. ${t}`).join('\n'),
        answerKey: `${letter(q.correctIndex)}. ${q.options[q.correctIndex]}`, explanation: q.explanation || '', comment: d.comment.trim().slice(0, 1000),
      }),
    });
    d.sending = false;
    if (res) { reportedIds.add(q.id); resetReport(); render('#report-btn'); } else fail('Could not send the report. Check your connection and try again.');
  }
  function reportPanel(q) {
    const d = reportDraft;
    return h('div', { class: 'report-box', id: 'report-box' },
      h('h3', { text: 'Report this question' }),
      h('p', { class: 'muted', text: 'What looks wrong? Select everything that applies.' }),
      REPORT_TYPES.map((t) => h('label', { class: 'inline-check' },
        h('input', { type: 'checkbox', 'data-type': t, checked: d.types.has(t), on: { change: (e) => { if (e.target.checked) d.types.add(t); else d.types.delete(t); } } }), t)),
      h('label', { for: 'report-comment', text: 'Additional comments (optional)' }),
      h('textarea', { id: 'report-comment', maxlength: '1000', placeholder: 'For example: the answer key should be C because…', value: d.comment, on: { input: (e) => { d.comment = e.target.value; } } }),
      d.msg && h('div', { class: `notice ${d.msg.type}`, role: 'alert' }, h('p', { text: d.msg.text })),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', id: 'report-send', text: d.sending ? 'Sending…' : 'Send report', disabled: d.sending, on: { click: sendReport } }),
        h('button', { class: 'btn', type: 'button', id: 'report-cancel', text: 'Cancel', on: { click: toggleReport } })));
  }

  /* ---- answer-key edits ---- */
  function finishEdit(id, prev) {
    saveEdits();
    rebuildQuestions();
    const changedKey = state.byId.get(id).correctIndex !== prev.correctIndex;
    // A stored status was graded against the old key, so it can no longer be trusted.
    if (changedKey && state.progress[id]) { delete state.progress[id]; saveProgress(); }
    return { changedKey };
  }

  function saveEdit(id, edit) {
    const base = state.baseById.get(id);
    const prev = state.byId.get(id);
    if (!base || !prev || !Number.isInteger(edit.correctIndex)
        || edit.correctIndex < 0 || edit.correctIndex >= base.options.length) return { changedKey: false };
    const next = { correctIndex: edit.correctIndex, explanation: edit.explanation, aiGenerated: edit.aiGenerated };
    if (next.correctIndex === base.correctIndex && next.explanation === base.explanation && next.aiGenerated === base.aiGenerated) {
      delete state.edits[id];
    } else {
      state.edits[id] = next;
    }
    return finishEdit(id, prev);
  }

  function revertEdit(id) {
    const prev = state.byId.get(id);
    if (!prev) return { changedKey: false };
    delete state.edits[id];
    return finishEdit(id, prev);
  }

  /* ---- question import / export ---- */
  function addCustom(list) {
    state.custom.push(...list);
    const saved = saveCustom();
    rebuildQuestions();
    return saved;
  }

  function importQuestions(text, reassign) {
    let data;
    try { data = JSON.parse(text); }
    catch (_) { return { ok: false, message: 'Nothing imported: that is not valid JSON.' }; }
    if (!Array.isArray(data) || !data.length) {
      return { ok: false, message: 'Nothing imported: expected a non-empty JSON array.' };
    }

    const existing = new Set(state.questions.map((q) => q.id));
    const seen = new Set();
    const problems = [];
    const items = [];

    data.forEach((raw, i) => {
      const candidate = reassign && raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw, id: 'tmp' } : raw;
      const r = normalizeQuestion(candidate);
      const label = `Item ${i + 1}`;
      if (r.error) problems.push(`${label}: ${r.error}`);
      else if (!reassign && (existing.has(r.value.id) || seen.has(r.value.id))) {
        problems.push(`${label}: id "${r.value.id}" already exists`);
      } else {
        seen.add(r.value.id);
        items.push(r.value);
      }
    });

    if (problems.length) {
      const shown = problems.slice(0, 15);
      if (problems.length > shown.length) shown.push(`...and ${problems.length - shown.length} more`);
      return { ok: false, message: `Nothing imported: ${problems.length} problem(s) found.`, details: shown };
    }

    let toAdd = items;
    if (reassign) {
      let n = nextIdNumber();
      toAdd = items.map((q) => Object.freeze({ ...q, id: `q${n++}` }));
    }
    const saved = addCustom(toAdd);
    return {
      ok: true,
      message: `Imported ${toAdd.length} question(s) as ${toAdd[0].id}${toAdd.length > 1 ? ` to ${toAdd[toAdd.length - 1].id}` : ''}.`
        + (saved ? '' : ' Warning: browser storage is unavailable, so they will be lost on refresh.'),
    };
  }

  async function exportBank() {
    if (!state.key || !state.env) return;
    const env = await encryptBank(state.env, state.key, state.questions.map(toPlain));
    const url = URL.createObjectURL(new Blob([JSON.stringify(env)], { type: 'application/json' }));
    const a = h('a', { href: url, download: 'bank.enc' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ======================================================================
   * DOM helpers
   * ==================================================================== */
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app container');

  /** Error boundary for event handlers. */
  const guard = (fn) => (...args) => {
    try { fn(...args); } catch (err) { console.error(err); renderFatal(); }
  };

  /** Tiny element factory. Event handlers go through `on: { click: fn }`. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, guard(fn));
      else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    const add = (kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) kid.forEach(add);
      else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    };
    kids.forEach(add);
    return el;
  }

  const mount = (nodes) => app.replaceChildren(...nodes);

  const refs = { notice: null };

  function noticeNode(n) {
    if (!n) return null;
    return h('div', { class: `notice ${n.type}`, role: n.type === 'err' ? 'alert' : 'status' },
      h('p', { text: n.text }),
      n.details && h('ul', {}, n.details.map((d) => h('li', { text: d })))
    );
  }

  function paintNotice(type, text, details) {
    state.ui.notice = { type, text, details };
    if (refs.notice) refs.notice.replaceChildren(...[noticeNode(state.ui.notice)].filter(Boolean));
  }

  /* ======================================================================
   * Shared view pieces
   * ==================================================================== */
  function explanationNode(q, open = false) {
    return h('details', { class: 'explanation', open: open && Boolean(q.explanation) },
      h('summary', { text: 'Show explanation' }),
      q.explanation
        ? h('p', { text: q.explanation })
        : h('p', { class: 'muted', text: 'No explanation provided for this question.' })
    );
  }

  function aiNote(q) {
    return q.aiGenerated
      ? h('p', { class: 'ai-note', text: 'AI-generated answer and explanation. Verify before relying on it.' })
      : null;
  }

  /** Read-only option list. Marks the correct option and, if given, the user's wrong pick. */
  function staticOptions(q, chosen, reveal = true) {
    return h('ul', { class: 'options' }, q.options.map((text, i) => {
      let cls = 'option static';
      let mark = null;
      if (!reveal) { if (i === chosen) { cls += ' chosen'; mark = '●'; } }
      else if (i === q.correctIndex) { cls += ' correct'; mark = '✓'; }
      else if (i === chosen) { cls += ' wrong'; mark = '✗'; }
      return h('li', {}, h('div', { class: cls },
        h('span', { class: 'letter', text: letter(i) }),
        h('span', { text }),
        mark && h('span', { class: 'mark', 'aria-hidden': 'true', text: mark })
      ));
    }));
  }

  const statusBadge = (s) => h('span', { class: `badge status-${s}`, text: STATUS_LABEL[s] });

  function stackedBar(t) {
    const bar = h('div', {
      class: 'bar', role: 'img',
      'aria-label': `${t.correct} correct, ${t.incorrect} incorrect, ${t.unattempted} not attempted`,
    });
    for (const [cls, n] of [['correct', t.correct], ['incorrect', t.incorrect]]) {
      const seg = h('span', { class: `seg ${cls}` });
      seg.style.width = `${t.total ? (n / t.total) * 100 : 0}%`;
      bar.append(seg);
    }
    return bar;
  }

  function backButton() {
    return h('div', { class: 'row' },
      h('button', {
        class: 'btn', type: 'button', id: 'back', text: '← Back',
        on: { click: () => { state.ui = freshUi(); refs.notice = null; render(); } },
      }));
  }

  /* ======================================================================
   * Views (state -> DOM). They read state, never mutate it directly.
   * ==================================================================== */
  function viewLoading() {
    return [h('p', { class: 'status' }, 'Loading questions…')];
  }

  function viewError() {
    return [h('section', { class: 'card' },
      h('h2', { text: 'Could not start' }),
      h('p', { text: state.error || 'Something went wrong.' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', id: 'retry', text: 'Retry', on: { click: boot } })
      )
    )];
  }

  function legend(t) {
    const item = (cls, label, n) => h('li', {}, h('span', { class: `dot ${cls}` }), `${label}: ${n}`);
    return h('ul', { class: 'legend' },
      item('correct', 'Correct', t.correct),
      item('incorrect', 'Incorrect', t.incorrect),
      item('', 'Not attempted', t.unattempted)
    );
  }

  function categoryTable(categories) {
    const th = (text, num) => h('th', { class: num ? 'num' : '', text });
    return h('section', { class: 'card' },
      h('h2', { text: 'By category' }),
      h('div', { class: 'table-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {},
            th('Category'), th('Progress'), th('Correct', true), th('Incorrect', true), th('New', true), th('Total', true))),
          h('tbody', {}, categories.map((c) => h('tr', {},
            h('td', { text: c.category }),
            h('td', {}, stackedBar(c)),
            h('td', { class: 'num', text: c.correct }),
            h('td', { class: 'num', text: c.incorrect }),
            h('td', { class: 'num', text: c.unattempted }),
            h('td', { class: 'num', text: c.total })
          )))
        )
      )
    );
  }

  const sortedUnique = (list) => [...new Set(list)].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));

  /**
   * Checkbox list for choosing a subset. `sel` is null (everything) or a Set of
   * selected values; the "All" box toggles between everything and nothing.
   */
  function multiCheck(id, title, items, getSel, setSel, onChange) {
    const values = items.map((it) => it.value);
    const summary = h('span', { class: 'muted check-sum' });
    const allBox = h('input', { type: 'checkbox', id: `${id}-all` });
    const rows = items.map((it, i) => {
      const cb = h('input', { type: 'checkbox', id: `${id}-${i}`, 'data-value': it.value });
      const txt = h('span');
      cb.addEventListener('change', guard(() => {
        const cur = getSel();
        const next = new Set(cur === null ? values : cur);
        if (cb.checked) next.add(it.value); else next.delete(it.value);
        setSel(next.size === values.length ? null : next);
        onChange();
      }));
      return { it, cb, txt, el: h('label', { class: 'inline-check', for: cb.id }, cb, txt) };
    });
    allBox.addEventListener('change', guard(() => {
      setSel(allBox.checked ? null : new Set());
      onChange();
    }));
    function refresh() {
      const sel = getSel();
      let n = 0;
      for (const r of rows) {
        r.cb.checked = sel === null || sel.has(r.it.value);
        if (r.cb.checked) n++;
        r.txt.textContent = r.it.label();
      }
      allBox.checked = n === values.length;
      allBox.indeterminate = n > 0 && n < values.length;
      summary.textContent = `${n} of ${values.length} selected`;
    }
    refresh();
    const node = h('fieldset', { class: 'check-group', id },
      h('legend', { text: title }),
      h('div', { class: 'check-head' },
        h('label', { class: 'inline-check', for: allBox.id }, allBox, `All ${title.toLowerCase()}`),
        summary),
      h('div', { class: 'check-list' }, rows.map((r) => r.el)));
    return { node, refresh };
  }

  function testForm(stats) {
    const scope = state.scope;
    const sources = sortedUnique(state.questions.map((q) => q.source));
    const count = h('input', { id: 'count', type: 'number', min: '1', step: '1', inputmode: 'numeric' });
    const aiBox = h('input', { id: 'include-ai', type: 'checkbox', checked: state.includeAi });
    const corBox = h('input', { id: 'include-correct', type: 'checkbox', checked: state.includeCorrect });
    const info = h('p', { class: 'muted', id: 'pool-info' });
    const start = h('button', { class: 'btn primary', type: 'submit', id: 'start', text: 'Start test' });

    const avail = (sc) => state.questions.filter((q) => inSet(sc.cats, q.category) && inSet(sc.srcs, q.source)
      && (aiBox.checked || !q.aiGenerated) && (corBox.checked || state.progress[q.id] !== 'correct')).length;
    const tag = (n) => (n ? `${n} available` : (corBox.checked ? 'none' : 'none new'));

    const catGroup = multiCheck('x-cat', 'Categories',
      stats.categories.map((c) => ({ value: c.category, label: () => `${c.category} (${tag(avail({ cats: new Set([c.category]), srcs: scope.srcs }))})` })),
      () => scope.cats, (v) => { scope.cats = v; }, () => sync());
    const srcGroup = multiCheck('x-src', 'Sources',
      sources.map((v) => ({ value: v, label: () => `${v} (${tag(avail({ cats: scope.cats, srcs: new Set([v]) }))})` })),
      () => scope.srcs, (v) => { scope.srcs = v; }, () => sync());

    const sync = () => {
      state.includeAi = aiBox.checked;
      state.includeCorrect = corBox.checked;
      catGroup.refresh();
      srcGroup.refresh();
      const { pool, repeat } = examPool(state.questions, state.progress, scope, aiBox.checked, corBox.checked);
      count.max = String(pool.length);
      const cur = parseInt(count.value, 10);
      if (!Number.isInteger(cur) || cur < 1 || cur > pool.length) {
        count.value = pool.length ? String(Math.min(DEFAULT_COUNT, pool.length)) : '';
      }
      count.disabled = start.disabled = pool.length === 0;
      if (!pool.length) info.textContent = 'No questions in this selection. Tick at least one category and one source.';
      else if (repeat) info.textContent = `Everything here is already answered correctly. A new test will repeat ${pool.length} question(s) for practice.`;
      else if (corBox.checked) info.textContent = `${pool.length} question(s) available, including ones already answered correctly.`;
      else info.textContent = `${pool.length} question(s) available: not attempted yet or answered incorrectly.`;
    };
    aiBox.addEventListener('change', guard(sync));
    corBox.addEventListener('change', guard(sync));
    sync();

    return h('form', {
      class: 'card', id: 'start-form', novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          const { pool } = examPool(state.questions, state.progress, scope, aiBox.checked, corBox.checked);
          const n = parseInt(count.value, 10);
          if (!pool.length) return;
          startTest(scope, Number.isInteger(n) ? n : Math.min(DEFAULT_COUNT, pool.length), aiBox.checked, corBox.checked);
        },
      },
    },
      h('h2', { text: 'Start a new test' }),
      catGroup.node,
      srcGroup.node,
      h('label', { for: 'count', text: 'Number of questions' }), count,
      h('label', { class: 'inline-check', for: 'include-ai' }, aiBox, 'Include AI-generated questions and answers'),
      h('label', { class: 'inline-check', for: 'include-correct' }, corBox, 'Include questions already answered correctly'),
      info,
      h('div', { class: 'form-actions' }, start)
    );
  }

  function viewSetup() {
    if (state.ui.panel === 'manage') return viewManage();
    if (state.ui.panel === 'browse') return viewBrowse();
    if (state.ui.panel === 'history') return viewHistory();
    const stats = computeStats(state.questions, state.progress);
    const t = stats.total;
    const nodes = [];

    if (!storage.available) {
      nodes.push(h('div', { class: 'notice err', role: 'alert' },
        h('p', { text: 'Browser storage is unavailable (private mode or blocked). Progress will not be saved.' })));
    }
    if (state.problems.length) {
      const n = state.problems.length;
      nodes.push(h('div', { class: 'notice warn' },
        h('p', { text: `${n} entr${n === 1 ? 'y' : 'ies'} in ${BANK_URL} ${n === 1 ? 'was' : 'were'} skipped as invalid.` }),
        h('details', {}, h('summary', { text: 'Show details' }),
          h('ul', {}, state.problems.slice(0, 20).map((p) => h('li', { text: p }))))));
    }

    nodes.push(h('section', { class: 'card' },
      h('h2', { text: 'Your progress' }),
      h('p', { class: 'big', text: `${t.correct} of ${t.total} answered correctly (${pct(t.correct, t.total)}%)` }),
      stackedBar(t),
      legend(t),
      h('p', { class: 'muted', id: 'user-line' }, state.user ? `Signed in as ${state.user.name}${state.user.university ? ` (${state.user.university})` : ''}. ` : '',
        h('button', { class: 'linkbtn', type: 'button', id: 'change-name', text: 'Change name / university', on: { click: () => showNamePage(() => { render(); }) } })),
      h('p', { class: 'muted', id: 'participants', text: participantsText() })
    ));
    nodes.push(categoryTable(stats.categories));
    nodes.push(testForm(stats));
    nodes.push(h('div', { class: 'row' },
      h('button', {
        class: 'btn', type: 'button', id: 'browse', text: 'Browse all questions',
        on: { click: () => { state.ui = freshUi('browse'); render(); } },
      }),
      h('button', {
        class: 'btn', type: 'button', id: 'history-btn', text: `History (${state.history.length})`,
        on: { click: () => { state.ui = freshUi('history'); render(); } },
      }),
      h('button', {
        class: 'btn', type: 'button', id: 'manage', text: 'Import / export',
        on: { click: () => { state.ui = freshUi('manage'); render(); } },
      }),
      h('button', {
        class: 'btn', type: 'button', id: 'logout', text: 'Log out',
        on: { click: () => { sess.clear(); window.location.reload(); } },
      }),
      h('button', {
        class: 'btn danger', type: 'button', id: 'reset', text: 'Reset progress',
        on: { click: () => { if (window.confirm('Reset all progress? Every question goes back to "not attempted".')) resetProgress(); } },
      })
    ));
    nodes.push(backupCard());
    nodes.push(howItWorksCard());
    nodes.push(changelogCard());
    return nodes;
  }

  /** Workflow, where data lives, and how to move progress to another device. */
  function howItWorksCard() {
    return h('section', { class: 'card howto', id: 'howto' },
      h('details', {},
        h('summary', { text: 'How Quiz Time works' }),
        h('h3', { text: 'Workflow' }),
        h('ol', {}, [
          'Log in with the ID and password (this lasts for the current tab only).',
          'Enter your name and university once. They are saved in this browser.',
          'On the main menu you see your progress per category. Choose categories and sources, the number of questions and the options (AI-generated questions, include questions already answered correctly), then start a test.',
          'During the test, choose answers, use "Mark for review" for questions you want to revisit, and "Report" if a question, choice, answer key, explanation or category looks wrong. Answers are drafts until you submit.',
          'Submit the exam. Only the questions you answered change status (correct or incorrect). Review the result by group, with answers and explanations if you want them.',
          'History keeps your finished exams so you can retake the same questions. "Browse all questions" lets you read the whole bank.',
        ].map((t) => h('li', { text: t }))),
        h('h3', { text: 'Where your data is stored' }),
        h('ul', {}, [
          'Your progress is stored only in this browser, on this device (browser storage). It includes the status of each question, your exam history, an exam in progress, imported questions and answer-key edits.',
          'It is not saved on a server and not tied to your login. The ID and password only unlock the question bank.',
          'Only your name, university, a random device code and your question reports are sent to the admin\'s Google Sheet.',
          'Progress is lost if you clear the browser\'s site data, use private mode, open the app in another browser or on another device, or press "Reset progress". Export a backup from time to time.',
        ].map((t) => h('li', { text: t }))),
        h('h3', { text: 'Move your progress to another device' }),
        h('ol', {}, [
          'On the old device, open the main menu and find "Back up your progress". Press "Export progress". A file named progress-(date).json is downloaded.',
          'Send that file to the new device (WhatsApp, email, Google Drive, USB cable, anything that keeps the file as it is).',
          'On the new device, open Quiz Time, log in and enter your name and university.',
          'On the main menu, under "Back up your progress", choose the .json file in "Import progress".',
          'Leave "Replace current progress" unchecked to merge with what is already there. Tick it only if you want the file to overwrite everything.',
          'Check the message that says how many questions were restored, and your progress bar.',
        ].map((t) => h('li', { text: t }))),
        h('p', { class: 'muted', text: 'The backup contains question progress, answer-key edits and imported questions. It does not contain exam history, an exam in progress, or your name and university; those stay on the old device.' })));
  }

  function changelogCard() {
    return h('section', { class: 'card', id: 'changelog' },
      h('details', {},
        h('summary', { text: `Changelog (latest: ${CHANGELOG[0].date}, build e)` }),
        CHANGELOG.map((e) => h('div', { class: 'cl-entry' },
          h('h3', { text: e.date }),
          h('ul', {}, e.items.map((t) => h('li', { text: t })))))));
  }

  function backupCard() {
    const slot = h('div', { class: 'notice-slot' }, noticeNode(state.ui.notice));
    refs.notice = slot;
    const replace = h('input', { id: 'pg-replace', type: 'checkbox' });
    const fileIn = h('input', {
      id: 'pg-file', type: 'file', accept: '.json,application/json',
      on: {
        change: () => {
          const file = fileIn.files && fileIn.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = guard(() => {
            if (replace.checked && !window.confirm('Replace all current progress with the backup?')) { fileIn.value = ''; return; }
            const res = importProgress(String(reader.result), replace.checked);
            state.ui.notice = { type: res.ok ? 'ok' : 'err', text: res.message };
            render();
          });
          reader.onerror = guard(() => paintNotice('err', 'Could not read that file.'));
          reader.readAsText(file);
        },
      },
    });
    return h('section', { class: 'card', id: 'backup' },
      h('h2', { text: 'Back up your progress' }),
      h('p', { class: 'muted', text: 'Progress is stored in this browser only. Export it to keep a copy or to move to another device or browser, then import it there.' }),
      slot,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', id: 'pg-export', text: 'Export progress', on: { click: exportProgress } })),
      h('label', { for: 'pg-file', text: 'Import progress (.json)' }), fileIn,
      h('label', { class: 'inline-check', for: 'pg-replace' }, replace, 'Replace current progress instead of merging')
    );
  }

  /** The whole question database, filterable by status, category and text. */
  function viewBrowse() {
    const f = state.ui.filter;
    const categories = sortedUnique(state.questions.map((q) => q.category));
    const sources = sortedUnique(state.questions.map((q) => q.source));
    const totalBy = (key) => {
      const m = new Map();
      for (const q of state.questions) m.set(q[key], (m.get(q[key]) || 0) + 1);
      return m;
    };
    const catTotals = totalBy('category');
    const srcTotals = totalBy('source');

    const status = h('select', { id: 'b-status' },
      h('option', { value: 'all', text: 'All statuses' }),
      h('option', { value: 'correct', text: STATUS_LABEL.correct }),
      h('option', { value: 'incorrect', text: STATUS_LABEL.incorrect }),
      h('option', { value: 'unattempted', text: STATUS_LABEL.unattempted })
    );
    const query = h('input', { id: 'b-query', type: 'text', placeholder: 'Search question text', autocomplete: 'off' });
    status.value = f.status;
    query.value = f.query;

    const count = h('p', { class: 'muted', id: 'b-count' });
    const list = h('ul', { class: 'review', id: 'b-list' });
    const note = h('p', { class: 'muted', id: 'b-note', role: 'status' });
    let editingId = null;

    const editorNode = (q) => {
      const sel = h('select', { id: 'e-correct' },
        q.options.map((t, i) => h('option', { value: String(i), text: `${letter(i)}. ${t}` })));
      sel.value = String(q.correctIndex);
      const expl = h('textarea', { id: 'e-expl' });
      expl.value = q.explanation;
      const ai = h('input', { id: 'e-ai', type: 'checkbox', checked: q.aiGenerated });
      return h('div', { class: 'editor' },
        h('label', { for: 'e-correct', text: 'Correct answer' }), sel,
        h('label', { for: 'e-expl', text: 'Explanation' }), expl,
        h('label', { class: 'inline-check' }, ai, 'Still AI-generated (untick once you have verified it)'),
        h('div', { class: 'row form-actions' },
          h('button', {
            class: 'btn primary', type: 'button', id: 'e-save', text: 'Save',
            on: {
              click: () => {
                const res = saveEdit(q.id, { correctIndex: Number(sel.value), explanation: expl.value.trim(), aiGenerated: ai.checked });
                editingId = null;
                note.textContent = res.changedKey
                  ? `${q.id}: answer key changed. Its status was reset to not attempted.`
                  : `${q.id}: saved.`;
                paint();
              },
            },
          }),
          h('button', { class: 'btn', type: 'button', id: 'e-cancel', text: 'Cancel', on: { click: () => { editingId = null; paint(); } } }),
          state.edits[q.id] && h('button', {
            class: 'btn danger', type: 'button', id: 'e-revert', text: `Revert to ${BANK_URL}`,
            on: {
              click: () => {
                const res = revertEdit(q.id);
                editingId = null;
                note.textContent = res.changedKey
                  ? `${q.id}: reverted. Its status was reset to not attempted.`
                  : `${q.id}: reverted.`;
                paint();
              },
            },
          })
        )
      );
    };

    const itemNode = (q) => {
      const s = state.progress[q.id] || 'unattempted';
      const li = h('li', { class: `review-item${s === 'incorrect' ? ' wrong' : ''}` },
        h('div', { class: 'q-head' },
          h('span', { text: labelOf(q) }),
          h('span', { class: 'badges' },
            state.edits[q.id] && h('span', { class: 'badge edited', text: 'Edited' }),
            statusBadge(s))
        ),
        h('p', { class: 'question-text', text: q.question }),
        staticOptions(q, undefined, f.reveal),
        f.reveal && aiNote(q),
        f.reveal && explanationNode(q)
      );
      if (editingId === q.id) li.append(editorNode(q));
      else {
        li.append(h('div', { class: 'row item-actions' }, h('button', {
          class: 'btn', type: 'button', 'data-edit': q.id, text: 'Edit answer key',
          on: { click: () => { editingId = q.id; note.textContent = ''; paint(); } },
        })));
      }
      return li;
    };

    const paint = () => {
      f.status = status.value;
      f.query = query.value;
      const needle = f.query.trim().toLowerCase();
      const rows = state.questions.filter((q) => {
        const s = state.progress[q.id] || 'unattempted';
        return (f.status === 'all' || s === f.status)
          && inSet(f.cats, q.category) && inSet(f.srcs, q.source)
          && (!needle || q.question.toLowerCase().includes(needle) || q.id.toLowerCase() === needle);
      });
      count.textContent = `Showing ${rows.length} of ${state.questions.length} questions.`;
      list.replaceChildren(...(rows.length
        ? rows.map(itemNode)
        : [h('li', { class: 'muted', text: 'No questions match these filters.' })]));
    };
    const revealBox = h('input', { id: 'b-reveal', type: 'checkbox', checked: f.reveal });
    revealBox.addEventListener('change', guard(() => { f.reveal = revealBox.checked; paint(); }));
    status.addEventListener('change', guard(paint));
    query.addEventListener('input', guard(paint));
    const catGroup = multiCheck('b-cat', 'Categories',
      categories.map((c) => ({ value: c, label: () => `${c} (${catTotals.get(c)})` })),
      () => f.cats, (v) => { f.cats = v; }, () => { catGroup.refresh(); paint(); });
    const srcGroup = multiCheck('b-src', 'Sources',
      sources.map((v) => ({ value: v, label: () => `${v} (${srcTotals.get(v)})` })),
      () => f.srcs, (v) => { f.srcs = v; }, () => { srcGroup.refresh(); paint(); });
    paint();

    const field = (label, id, control) => h('div', {}, h('label', { for: id, text: label }), control);
    return [
      backButton(),
      h('section', { class: 'card' },
        h('h2', { text: 'All questions' }),
        h('div', { class: 'filters' },
          field('Status', 'b-status', status),
          field('Search', 'b-query', query)
        ),
        catGroup.node,
        srcGroup.node,
        h('label', { class: 'inline-check', for: 'b-reveal' }, revealBox, 'Show correct answers and explanations'),
        count,
        note
      ),
      list,
    ];
  }

  function viewManage() {
    const slot = h('div', { class: 'notice-slot' }, noticeNode(state.ui.notice));
    refs.notice = slot;

    const importText = h('textarea', { id: 'import-text', placeholder: 'Paste a JSON array here, or load a .json file' });
    const fileIn = h('input', {
      id: 'import-file', type: 'file', accept: '.json,application/json',
      on: {
        change: () => {
          const file = fileIn.files && fileIn.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = guard(() => {
            importText.value = String(reader.result);
            paintNotice('ok', `Loaded ${file.name}. Review it, then click Import.`);
          });
          reader.onerror = guard(() => paintNotice('err', 'Could not read that file.'));
          reader.readAsText(file);
        },
      },
    });
    const reassign = h('input', { id: 'import-reassign', type: 'checkbox' });
    const importBtn = h('button', {
      class: 'btn primary', type: 'button', id: 'import-btn', text: 'Import',
      on: {
        click: () => {
          const res = importQuestions(importText.value, reassign.checked);
          if (res.ok) { state.ui.notice = { type: 'ok', text: res.message }; render(); }
          else paintNotice('err', res.message, res.details);
        },
      },
    });

    const localCount = state.custom.length;
    return [
      backButton(),
      slot,
      h('section', { class: 'card' },
        h('h2', { text: 'Import questions (JSON)' }),
        h('p', { class: 'muted', text: 'Expected format: an array of { id, category, question, options, correctIndex, explanation }.' }),
        h('label', { for: 'import-file', text: 'Load from file' }), fileIn,
        h('label', { for: 'import-text', text: 'Or paste JSON' }), importText,
        h('label', { class: 'inline-check' }, reassign, 'Assign new IDs automatically (ignore the IDs in the JSON)'),
        h('div', { class: 'form-actions' }, importBtn)
      ),
      h('section', { class: 'card' },
        h('h2', { text: 'Save to your site' }),
        h('p', { id: 'bank-info', text: `${state.questions.length} questions total, ${localCount} imported in this browser and not yet in ${BANK_URL}.` }),
        h('p', { id: 'edits-info', text: `${Object.keys(state.edits).length} answer-key edit(s) made in this browser and not yet in ${BANK_URL}.` }),
        h('p', { class: 'muted', text: `Download the merged file (it includes your answer-key edits), replace ${BANK_URL} in your repository, and commit. Local imports and edits are cleaned up automatically once they appear in the committed file.` }),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', id: 'export', text: `Download updated ${BANK_URL}`, on: { click: exportBank } }),
          h('button', {
            class: 'btn danger', type: 'button', id: 'clear-local', text: 'Discard local imports', disabled: localCount === 0,
            on: {
              click: () => {
                if (!window.confirm(`Discard ${localCount} locally imported question(s)?`)) return;
                state.custom = [];
                saveCustom();
                rebuildQuestions();
                state.ui.notice = { type: 'ok', text: 'Local imports discarded.' };
                render();
              },
            },
          })
        )
      ),
    ];
  }

  /** Exam screen: no feedback, free navigation, marks. Grading happens on submit. */
  function viewActive() {
    const s = state.session;
    const q = currentQuestion();
    const total = s.ids.length;
    const chosen = s.answers[q.id];
    const answeredCount = s.ids.filter((id) => s.answers[id] !== undefined).length;
    const markedCount = s.ids.filter((id) => s.marked[id]).length;
    const isMarked = Boolean(s.marked[q.id]);

    const track = h('div', { class: 'bar thin', role: 'img', 'aria-label': `${answeredCount} of ${total} answered` });
    const fill = h('span', { class: 'seg fill' });
    fill.style.width = `${(answeredCount / total) * 100}%`;
    track.append(fill);

    const options = h('ul', { class: 'options' }, q.options.map((text, i) => h('li', {},
      h('button', {
        class: `option${chosen === i ? ' selected' : ''}`, type: 'button',
        'data-i': i, 'aria-pressed': chosen === i ? 'true' : 'false',
        on: { click: () => selectOption(i) },
      },
        h('span', { class: 'letter', text: letter(i) }),
        h('span', { text }),
        chosen === i && h('span', { class: 'mark', 'aria-hidden': 'true', text: '●' })
      )
    )));

    const navigator = h('div', { class: 'navgrid', role: 'group', 'aria-label': 'Question navigator' },
      s.ids.map((id, i) => {
        const answered = s.answers[id] !== undefined;
        const marked = Boolean(s.marked[id]);
        const status = marked ? 'marked' : answered ? 'answered' : 'unanswered';
        const label = `Question ${i + 1}: ${answered ? 'answered' : 'unanswered'}${marked ? ', marked for review' : ''}`;
        return h('button', {
          class: `navbtn ${status}${i === s.index ? ' current' : ''}`, type: 'button',
          title: label, 'aria-label': label, 'aria-current': i === s.index ? 'true' : null,
          text: String(i + 1), on: { click: () => goTo(i) },
        });
      })
    );
    const navLegend = h('ul', { class: 'legend' },
      h('li', {}, h('span', { class: 'dot unanswered' }), 'Unanswered'),
      h('li', {}, h('span', { class: 'dot answered' }), 'Answered'),
      h('li', {}, h('span', { class: 'dot marked' }), 'Marked for review')
    );

    const confirmSubmit = () => {
      const unanswered = total - answeredCount;
      const parts = ['Submit your exam now? You will not be able to change your answers.'];
      if (unanswered) parts.push(`${unanswered} question(s) are unanswered.`);
      if (markedCount) parts.push(`${markedCount} question(s) are still marked for review.`);
      if (window.confirm(parts.join('\n'))) submitExam();
    };

    return [
      h('section', { class: 'card' },
        h('div', { class: 'q-head' },
          h('span', { text: `Question ${s.index + 1} of ${total}` }),
          h('span', { class: 'badge', text: labelOf(q) })
        ),
        track,
        h('p', { class: 'question-text', text: q.question }),
        options,
        h('div', { class: 'row between form-actions' },
          h('button', {
            class: 'btn', type: 'button', id: 'prev', text: '← Previous',
            disabled: s.index === 0, on: { click: () => goTo(s.index - 1) },
          }),
          h('button', {
            class: `btn${isMarked ? ' marked-on' : ''}`, type: 'button', id: 'mark-btn',
            'aria-pressed': isMarked ? 'true' : 'false',
            text: isMarked ? 'Unmark review' : 'Mark for review', on: { click: toggleMark },
          }),
          h('button', {
            class: 'btn', type: 'button', id: 'report-btn', 'aria-expanded': reportDraft.open && reportDraft.id === q.id ? 'true' : 'false',
            text: reportedIds.has(q.id) ? 'Reported ✓' : 'Report', on: { click: toggleReport },
          }),
          h('button', {
            class: 'btn', type: 'button', id: 'next', text: 'Next →',
            disabled: s.index >= total - 1, on: { click: () => goTo(s.index + 1) },
          })
        ),
        reportedIds.has(q.id) && !(reportDraft.open && reportDraft.id === q.id) && h('p', { class: 'muted', id: 'report-thanks', text: 'Thanks, your report was sent.' }),
        reportDraft.open && reportDraft.id === q.id && reportPanel(q),
        chosen !== undefined && h('div', { class: 'row' },
          h('button', { class: 'btn link', type: 'button', id: 'clear-answer', text: 'Clear answer', on: { click: clearAnswer } }))
      ),
      h('section', { class: 'card' },
        h('h2', { text: 'Questions' }),
        navigator,
        navLegend
      ),
      h('section', { class: 'card' },
        h('p', {
          id: 'exam-summary',
          text: `Answered ${answeredCount} of ${total}${markedCount ? ` · ${markedCount} marked for review` : ''}`,
        }),
        h('div', { class: 'row between' },
          h('button', {
            class: 'btn link', type: 'button', id: 'quit', text: 'Quit without submitting',
            on: { click: () => { if (window.confirm('Quit without submitting? Your answers for this exam will be discarded.')) leaveTest(); } },
          }),
          h('button', { class: 'btn primary', type: 'button', id: 'submit', text: 'Submit exam', on: { click: confirmSubmit } })
        )
      ),
    ];
  }

  /** After a test: every question from the session, incorrect ones first and in red. */
  /** One dropdown of review items with its own "show answers" checkbox. */
  function reviewGroup(key, title, qs, answers, ids) {
    const box = h('input', { id: `rv-${key}-reveal`, type: 'checkbox' });
    const list = h('ul', { class: 'review', id: `rv-${key}-list` });
    const paint = () => {
      const reveal = box.checked;
      list.replaceChildren(...(qs.length ? qs.map((q) => {
        const chosen = answers[q.id];
        const answered = chosen !== undefined;
        const wrong = answered && chosen !== q.correctIndex;
        return h('li', { class: `review-item${reveal && wrong ? ' wrong' : ''}` },
          h('div', { class: 'q-head' }, h('span', { text: `Question ${ids.indexOf(q.id) + 1} · ${labelOf(q)}` })),
          h('p', { class: 'question-text', text: q.question }),
          staticOptions(q, chosen, reveal),
          reveal && aiNote(q),
          reveal && wrong && h('p', { class: 'your-answer', text: `Your answer: ${letter(chosen)}. ${q.options[chosen]}` }),
          reveal && explanationNode(q, true)
        );
      }) : [h('li', { class: 'muted', text: 'None.' })]));
    };
    box.addEventListener('change', guard(paint));
    paint();
    return h('div', { class: 'review-group', id: `rv-${key}` },
      h('div', { class: 'group-bar' },
        h('details', { class: 'group', open: key === 'incorrect' && qs.length > 0 },
          h('summary', { text: `${title} (${qs.length})` }), list),
        h('label', { class: 'inline-check group-check', for: `rv-${key}-reveal` }, box, 'Show answers & explanation')));
  }

  function reviewSection(ids, answers, hideUnanswered = false) {
    const items = ids.map((id) => state.byId.get(id)).filter(Boolean);
    const rank = (q) => (answers[q.id] === undefined ? 1 : answers[q.id] === q.correctIndex ? 2 : 0);
    const ordered = items
      .map((q, i) => ({ q, i }))
      .sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i)
      .map((x) => x.q);
    return h('section', {},
      h('h2', { text: `Review all ${items.length} questions` }),
      h('p', { class: 'muted', text: 'Open a group to see its questions. Tick the box next to it to show the correct answers and explanations.' }),
      reviewGroup('incorrect', 'Answered incorrectly', ordered.filter((q) => rank(q) === 0), answers, ids),
      reviewGroup('correct', 'Answered correctly', ordered.filter((q) => rank(q) === 2), answers, ids),
      !hideUnanswered && reviewGroup('unanswered', 'Unanswered', ordered.filter((q) => rank(q) === 1), answers, ids));
  }

  function histScore(e) {
    let correct = 0; let known = 0;
    e.ids.forEach((id, i) => {
      const q = state.byId.get(id);
      if (!q) return;
      known++;
      if (e.a[i] === q.correctIndex) correct++;
    });
    return { correct, known };
  }

  function viewHistory() {
    const back = backButton();
    const sel = state.ui.histIndex;
    if (Number.isInteger(sel) && state.history[sel]) {
      const e = state.history[sel];
      const answers = Object.create(null);
      e.ids.forEach((id, i) => { if (e.a[i] >= 0) answers[id] = e.a[i]; });
      const { correct, known } = histScore(e);
      return [
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', id: 'hist-back', text: '← History',
            on: { click: () => { state.ui.histIndex = null; render(); } } })),
        h('section', { class: 'card' },
          h('h2', { text: new Date(e.t).toLocaleString() }),
          h('p', { class: 'big', id: 'hist-score', text: `${correct} / ${known} correct (${pct(correct, known)}%)` }),
          known < e.ids.length && h('p', { class: 'muted', text: `${e.ids.length - known} question(s) no longer exist in the bank.` }),
          h('div', { class: 'form-actions' },
            h('button', { class: 'btn primary', type: 'button', id: 'hist-retake', text: 'Retake same questions',
              on: { click: () => startFromIds(e.ids) } }))),
        reviewSection(e.ids, answers, true),
      ];
    }
    const rows = state.history.map((e, i) => ({ e, i })).reverse().map(({ e, i }) => {
      const { correct, known } = histScore(e);
      return h('li', { class: 'hist-item' },
        h('div', {},
          h('strong', { text: new Date(e.t).toLocaleString() }),
          h('span', { class: 'muted', text: ` · ${correct} / ${known} correct (${pct(correct, known)}%)` })),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', text: 'Details', on: { click: () => { state.ui.histIndex = i; render(); } } }),
          h('button', { class: 'btn primary', type: 'button', text: 'Retake', on: { click: () => startFromIds(e.ids) } })));
    });
    return [
      back,
      h('section', { class: 'card', id: 'history' },
        h('h2', { text: 'Exam history' }),
        h('p', { class: 'muted', text: `Last ${HISTORY_MAX} completed exams are kept in this browser; only answered questions are saved. Scores use the current answer keys.` }),
        h('ul', { class: 'hist-list' }, rows.length ? rows : [h('li', { class: 'muted', text: 'No completed exams yet.' })]),
        state.history.length ? h('div', { class: 'form-actions' },
          h('button', { class: 'btn danger', type: 'button', id: 'hist-clear', text: 'Clear history',
            on: { click: () => { if (window.confirm('Delete all exam history? Progress is not affected.')) { state.history = []; saveHistory(); render(); } } } })) : null),
    ];
  }

  function viewResults() {
    const { ids, answers } = state.session;
    const items = ids.map((id) => state.byId.get(id));
    const rank = (q) => (answers[q.id] === undefined ? 1 : answers[q.id] === q.correctIndex ? 2 : 0);
    const ordered = items
      .map((q, i) => ({ q, i }))
      .sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i)
      .map((x) => x.q);
    const correct = items.filter((q) => rank(q) === 2).length;
    const wrong = items.filter((q) => rank(q) === 0).length;
    const skipped = items.filter((q) => rank(q) === 1).length;

    return [
      h('section', { class: 'card' },
        h('h2', { text: 'Results' }),
        h('p', { class: 'big', id: 'score', text: `${correct} / ${items.length} correct (${pct(correct, items.length)}%)` }),
        h('p', { class: 'muted', id: 'score-detail',
          text: `${wrong} incorrect${skipped ? `, ${skipped} unanswered` : ''}. Incorrect questions stay in the pool for your next tests.${skipped ? ' Unanswered questions keep their previous status.' : ''}` }),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn primary', type: 'button', id: 'done', text: 'Back to menu', on: { click: leaveTest } }),
          h('button', { class: 'btn', type: 'button', id: 'retake', text: 'Retake same questions', on: { click: retakeFromResults } }))
      ),
      reviewSection(ids, answers),
    ];
  }

  /* ======================================================================
   * Render
   * ==================================================================== */
  function render(focusSel) {
    try {
      if (state.machine !== 'SETUP' || state.ui.panel !== 'manage') refs.notice = null;
      switch (state.machine) {
        case 'INIT':
        case 'LOADING': mount(viewLoading()); break;
        case 'ERROR': mount(viewError()); break;
        case 'SETUP': mount(viewSetup()); break;
        case 'ACTIVE': mount(viewActive()); break;
        case 'RESULTS': mount(viewResults()); break;
        default: throw new Error(`Unknown state ${state.machine}`);
      }
      if (focusSel) {
        const el = app.querySelector(focusSel);
        if (el) el.focus();
      }
    } catch (err) {
      console.error(err);
      renderFatal();
    }
  }

  /** Last-resort screen that does not depend on app state. */
  function renderFatal() {
    app.replaceChildren(
      h('section', { class: 'card' },
        h('h2', { text: 'Something went wrong' }),
        h('p', { text: 'An unexpected error occurred. Reload the page to continue. Your saved progress is not affected.' }),
        h('button', { class: 'btn primary', type: 'button', text: 'Reload', on: { click: () => window.location.reload() } })
      )
    );
  }

  function showNamePage(done) {
    mount([viewName(done, state.machine === 'SETUP')]);
    registry.count();
  }

  const UNIVERSITIES = ['IPB', 'UB', 'UGM', 'UNAIR', 'UNDANA', 'UNHAS', 'UNPAD', 'UNUD', 'USK', 'Other'];
  function viewName(done, canCancel) {
    const err = h('p', { class: 'notice err', role: 'alert', hidden: true });
    const name = h('input', { id: 'user-name', type: 'text', maxlength: '60', autocomplete: 'name', value: state.user ? state.user.name : '' });
    const uni = h('input', { id: 'user-uni', type: 'text', maxlength: '80', list: 'uni-list', autocomplete: 'organization', value: state.user ? state.user.university || '' : '' });
    const list = h('datalist', { id: 'uni-list' }, UNIVERSITIES.map((u) => h('option', { value: u })));
    const count = h('p', { class: 'muted', id: 'participants', text: participantsText() });
    const btn = h('button', { class: 'btn primary', type: 'submit', id: 'name-btn', text: 'Continue' });
    return h('form', {
      class: 'card', id: 'name-form', novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          const v = name.value.replace(/\s+/g, ' ').trim();
          const u = uni.value.replace(/\s+/g, ' ').trim();
          if (v.length < 2) { err.hidden = false; err.textContent = 'Enter your name (at least 2 characters).'; name.focus(); return; }
          if (u.length < 2) { err.hidden = false; err.textContent = 'Enter your university (at least 2 characters).'; uni.focus(); return; }
          state.user = { id: state.user ? state.user.id : newDeviceId(), name: v.slice(0, 60), university: u.slice(0, 80) };
          storage.write(KEYS.user, state.user);
          done();
        },
      },
    },
      h('h2', { text: 'Who are you?' }),
      h('p', { class: 'muted', text: 'Your name and university are recorded so the admin knows who has used Quiz Time.' }),
      h('label', { for: 'user-name', text: 'Name' }), name,
      h('label', { for: 'user-uni', text: 'University' }), uni, list,
      err,
      h('div', { class: 'form-actions' }, btn, canCancel && h('button', { class: 'btn', type: 'button', id: 'name-cancel', text: 'Cancel', on: { click: () => render() } })),
      count);
  }

  /** After a successful login: ask for a name once per browser, then start. */
  function proceed() {
    state.user = loadUser();
    if (state.user && state.user.university) boot(); else showNamePage(boot);
  }

  function showLogin() {
    state.key = null;
    sess.clear();
    state.machine = 'INIT';
    mount(viewLogin());
  }

  function viewLogin() {
    const err = h('p', { class: 'notice err', role: 'alert', hidden: true });
    const id = h('input', { id: 'login-id', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
    const pw = h('input', { id: 'login-pw', type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primary', type: 'submit', id: 'login-btn', text: 'Log in' });
    const fail = (msg) => { err.hidden = false; err.textContent = msg; pw.value = ''; btn.disabled = false; btn.textContent = 'Log in'; pw.focus(); };
    return [h('form', {
      class: 'card', id: 'login-form', novalidate: true,
      on: {
        submit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          btn.disabled = true;
          btn.textContent = 'Checking…';
          try {
            const env = await fetchEnvelope();
            const key = await deriveKey(id.value, pw.value, env);
            await decryptBank(env, key); // throws AuthError when the ID/password is wrong
            state.key = key;
            sess.set(b64e(new Uint8Array(await crypto.subtle.exportKey('raw', key))));
            proceed();
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
      h('div', { class: 'form-actions' }, btn),
      h('p', { class: 'muted thanks', text: 'Thanks to: Allah SWT, Claude AI, and every question bank that went into my chat.' })
    )];
  }

  (async () => {
    const saved = sess.get();
    if (saved) {
      try { state.key = await importKey(saved); proceed(); return; }
      catch (_) { sess.clear(); }
    }
    mount(viewLogin());
  })();
})();
