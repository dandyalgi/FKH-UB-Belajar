/* OSCE Practice, single-player mode: the examinee works alone (no examiner, no scoring rubric).
   Stage 1: read the case (2 min). Stage 2: 18 min, six steps with an owner chatbot for the history.
   Stage 3: no timer, your answers next to the answer key plus everything you did not ask or look at. */
(() => {
  'use strict';
  const API = () => window.OSCE_API;
  const T1 = 120; const T2 = 1080;

  /* ---------- owner chatbot: keyword matching on the case's history answers and on the case text ---------- */
  const STOP = new Set(['apakah', 'apa', 'bagaimana', 'gimana', 'yang', 'di', 'ke', 'dari', 'dan', 'atau', 'ada', 'itu', 'ini', 'dok', 'dokter', 'pak', 'bu', 'bapak', 'ibu', 'sudah', 'udah', 'pernah', 'nya', 'kah', 'sih', 'ya', 'saja', 'aja', 'dengan', 'untuk', 'pada', 'seperti', 'sedang', 'lagi', 'mau', 'bisa', 'boleh', 'tolong', 'minta', 'tanya', 'kasih', 'anda', 'kamu', 'saya', 'hewan', 'peliharaan', 'owner', 'klien', 'the', 'is', 'sama', 'tidak', 'belum', 'ada', 'kucing', 'anjing', 'sapi', 'kambing', 'kuda', 'kelinci', 'ayam', 'burung', 'hamster', 'domba', 'berapa', 'seberapa']);
  const GROUPS = [
    ['pakan', ['makan', 'pakan', 'nafsu', 'diet', 'kibble', 'dry', 'wet', 'food', 'snack', 'camilan', 'konsumsi', 'menu', 'asupan']],
    ['minum', ['minum', 'air', 'haus', 'polidipsi', 'hidrasi']],
    ['vaksin', ['vaksin', 'imunisasi', 'vaccin']],
    ['cacing', ['cacing', 'deworm', 'worm', 'antelmintik', 'obat cacing']],
    ['kutu', ['kutu', 'pinjal', 'ektoparasit', 'tungau', 'caplak', 'flea', 'tick']],
    ['muntah', ['muntah', 'vomit', 'mual', 'regurgit']],
    ['feses', ['feses', 'tinja', 'diare', 'mencret', 'bab', 'berak', 'defekasi', 'tai', 'kotoran', 'konstipasi', 'sembelit']],
    ['urin', ['urin', 'kencing', 'pipis', 'bak', 'urinasi', 'kemih', 'ngompol']],
    ['lingkungan', ['lingkungan', 'indoor', 'outdoor', 'kandang', 'dilepas', 'liar', 'kontak', 'rumah', 'hewan lain', 'pelihara', 'pemeliharaan', 'tinggal', 'kucing lain', 'anjing lain', 'sekandang']],
    ['berat', ['berat', 'bobot', 'kurus', 'gemuk', 'turun', 'bb']],
    ['riwayat', ['riwayat', 'terdahulu', 'sebelumnya', 'dulu', 'sakit', 'penyakit', 'kronis']],
    ['pengobatan', ['obat', 'terapi', 'pengobatan', 'diobati', 'suplemen', 'vitamin', 'antibiotik']],
    ['durasi', ['sejak', 'kapan', 'lama', 'durasi', 'mulai', 'awal', 'hari']],
    ['napas', ['batuk', 'bersin', 'pilek', 'sesak', 'napas', 'nafas', 'ingus', 'mengi', 'respirasi']],
    ['keluhan', ['keluhan', 'utama', 'kenapa', 'masalah', 'gejala', 'datang']],
    ['reproduksi', ['steril', 'kastrasi', 'kawin', 'hamil', 'bunting', 'melahirkan', 'anak', 'birahi', 'estrus', 'menyusui', 'lahir']],
    ['kulit', ['gatal', 'garuk', 'rontok', 'kulit', 'bulu', 'kerak', 'luka', 'benjolan', 'botak']],
    ['aktivitas', ['lemas', 'lesu', 'aktivitas', 'aktif', 'main', 'tidur', 'perilaku']],
    ['mata', ['mata', 'belekan', 'keruh', 'kornea']],
    ['telinga', ['telinga', 'kuping', 'otitis']],
    ['signalemen', ['nama', 'umur', 'usia', 'tahun', 'ras', 'jenis kelamin', 'kelamin', 'jantan', 'betina', 'spesies', 'breed']],
  ];
  const stem = (t) => {
    let s = t;
    s = s.replace(/(nya|kah|lah|kan|an|i)$/, (m) => (s.length - m.length >= 4 ? '' : m));
    s = s.replace(/^(meny|meng|mem|men|me|di|ber|ter|per|pe|se|ke)/, (m) => (s.length - m.length >= 4 ? '' : m));
    return s;
  };
  const canon = (t) => {
    const s = stem(t);
    for (const [name, words] of GROUPS) {
      for (const w of words) { if (w.length >= 3 && (t === w || s === w || (w.length >= 4 && (t.startsWith(w) || s.startsWith(w))))) return `#${name}`; }
    }
    return s;
  };
  const tokens = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9À-ɏ\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));
  const canonSet = (text) => {
    const raw = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const out = new Set(tokens(text).map(canon).filter((t) => t.length >= 3 || t.startsWith('#')));
    // two-word phrases
    for (const [name, words] of GROUPS) for (const w of words) if (w.includes(' ') && raw.includes(w)) out.add(`#${name}`);
    return out;
  };
  const GENERIC = new Set(['#riwayat', '#durasi', '#keluhan', '#pengobatan', '#signalemen']);
  const weight = (t) => (t.startsWith('#') ? (GENERIC.has(t) ? 1 : 2) : 1);
  /** Match score plus how many specific words of the question the item does not contain (those make a generic match unreliable). */
  function scoreAgainst(userSet, qSet, aSet) {
    let sc = 0; let miss = 0;
    for (const t of userSet) {
      if (qSet.has(t)) sc += weight(t); else if (aSet && aSet.has(t)) sc += weight(t) / 2;
      else if (t.startsWith('#') || t.length >= 4) miss++;
    }
    return (sc >= 1.5 || (sc >= 1 && miss === 0)) ? sc : 0;
  }
  const ownerVoice = (a) => String(a || '').replace(/^Owner\b/, 'Saya').replace(/\bowner\b/gi, 'saya').replace(/\bOwner\b/g, 'Saya');
  const cap = (s) => { const t = String(s).trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const FALLBACKS = ['Hmm, soal itu saya kurang tahu, Dok.', 'Sepertinya tidak ada yang khusus soal itu, Dok.', 'Maaf Dok, saya tidak memperhatikan hal itu.', 'Kalau itu saya tidak begitu ingat, Dok. Mungkin bisa ditanyakan hal lain?'];

  function makeBot(c) {
    const items = c.anamnesis.map((x, i) => ({ i, q: canonSet(x.q), a: canonSet(x.a), ans: x.a }));
    const frags = String(c.brief.text || '').split(/[.;]|,\s/).map((f) => f.trim()).filter((f) => f.length >= 8).map((f) => ({ txt: f, q: canonSet(f) }));
    let fb = 0;
    return {
      ask(text) {
        const raw = String(text || '').toLowerCase();
        if (/^\s*(halo|hai|hallo|selamat|permisi|assalam|pagi|siang|sore)/.test(raw) && tokens(raw).length <= 3) return { text: 'Halo Dok, terima kasih sudah mau memeriksa hewan saya.', hits: [] };
        if (/(terima kasih|makasih|trimakasih)/.test(raw) && tokens(raw).length <= 3) return { text: 'Sama-sama, Dok.', hits: [] };
        const u = canonSet(text);
        if (!u.size) return { text: FALLBACKS[fb++ % FALLBACKS.length], hits: [] };
        const sc = items.map((it) => ({ it, s: scoreAgainst(u, it.q, it.a) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
        if (sc.length) {
          const top = sc[0].s; const pick = sc.filter((x) => x.s >= top * 0.9).slice(0, 2);
          return { text: pick.map((x) => cap(ownerVoice(x.it.ans))).join(' '), hits: pick.map((x) => x.it.i) };
        }
        const fs = frags.map((f) => ({ f, s: scoreAgainst(u, f.q, null) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
        if (fs.length) return { text: `Seperti yang saya sampaikan tadi, Dok: ${fs[0].f.txt.replace(/^(seekor|seorang)\s+/i, '')}.`, hits: [] };
        return { text: FALLBACKS[fb++ % FALLBACKS.length], hits: [] };
      },
    };
  }

  /* ---------- diagnostic tests: the case's real tests mixed with decoys ---------- */
  const DECOYS = [
    ['Hematologi', /hematolog|cbc|darah lengkap/i], ['Kimia darah', /kimia|biokimia/i], ['Urinalisis', /urin/i], ['Ulas darah', /ulas|apus|gambaran darah/i],
    ['X-Ray', /x-?ray|rontgen|radiograf/i], ['USG', /usg|ultraso/i], ['EKG', /ekg|elektrokardio/i], ['Sitologi', /sitolog|fna/i], ['Skin scraping', /skin|kerok/i],
    ['Pemeriksaan feses', /feses|fecal/i], ['Kultur bakteri', /kultur/i], ['Biopsi / histopatologi', /biopsi|histopat/i], ['Mikroskopis', /mikroskop|natif/i],
    ['Fluorescence (Wood’s lamp)', /fluoresc|wood/i], ['Elektrolit', /elektrolit/i], ['Pengukuran tekanan darah', /tekanan darah/i],
    ['Test kit FIV / FeLV', /fiv|felv/i], ['Test kit Parvovirus / Distemper', /parvo|cdv|distemper/i], ['Test kit Babesia, Ehrlichia, Anaplasma', /babesia|ehrlichia|anaplasma/i],
    ['Test kit Giardia', /giardia/i], ['PCR panel virus', /pcr/i],
  ];
  const DECOY_TEXT = 'Hasil tidak menunjukkan kelainan bermakna yang berkaitan dengan kasus ini.';
  function buildTests(c) {
    const real = c.tests.filter((t) => t.label !== 'Pemeriksaan fisik').map((t) => ({ key: `r:${t.label}`, label: t.label, real: t }));
    const decoys = DECOYS.filter(([, re]) => !real.some((r) => re.test(r.label))).map(([label]) => ({ key: `d:${label}`, label, real: null }));
    return [...real, ...decoys].sort((a, b) => a.label.localeCompare(b.label, 'id'));
  }

  /* ---------- state ---------- */
  let S = null; let timer = null;
  const stopTimer = () => { if (timer) clearInterval(timer); timer = null; };
  const fmt = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
  function runTimer(secs, node, onEnd) {
    stopTimer();
    const end = Date.now() + secs * 1000;
    const paint = () => { const left = Math.ceil((end - Date.now()) / 1000); node.textContent = fmt(left); node.classList.toggle('low', left <= 60); if (left <= 0) { stopTimer(); onEnd(); } };
    paint(); timer = setInterval(paint, 500);
  }

  function start(caseId) {
    const { st } = API();
    const c = st.byId.get(caseId) || st.cases[0];
    if (!c) return;
    S = {
      c, bot: makeBot(c), chat: [{ who: 'owner', text: 'Selamat datang, Dok. Tolong periksa hewan saya.' }], asked: new Set(), nq: 0, tab: 0,
      pat: { nama: '', spesies: '', ras: '', kelamin: '', umur: '' }, anam: '',
      vit: { bb: '', suhu: '', napas: '', nadi: '', turgor: '', crt: '', mukosa: '' }, sys: {},
      ddx: '', tests: buildTests(c), opened: [], interp: {}, cur: null, dx: '', prog: '', tx: '', rx: [''], edu: '', nextT: 0,
    };
    stage1();
  }

  const SYSTEMS = ['General appearance', 'Kepala & leher', 'Mata', 'Telinga', 'Rongga mulut', 'Respirasi', 'Kardiovaskular', 'Gastrointestinal', 'Urogenital', 'Muskuloskeletal', 'Kulit & bulu', 'Limfonodus', 'Sistem saraf'];
  const TABS = ['1. Anamnesis', '2. Pemeriksaan fisik', '3. Pemeriksaan penunjang', '4. Diagnosis & prognosis', '5. Terapi & resep', '6. Edukasi klien'];
  const PROGS = ['Fausta', 'Dubius ad bonam', 'Dubius', 'Dubius ad malam', 'Infausta'];

  const exit = () => { stopTimer(); S = null; API().home(); };

  /* ---------- stage 1: read the case ---------- */
  function stage1() {
    const { h, mount } = API(); const c = S.c;
    const tm = h('div', { class: 'solo-timer', 'aria-label': 'Sisa waktu membaca' });
    const go = () => { stopTimer(); stage2(); };
    const pe = c.tests.find((t) => t.label === 'Pemeriksaan fisik');
    mount(
      h('p', { class: 'stage', text: 'Tahap 1 dari 3 · Membaca soal (2 menit)' }),
      h('section', { class: 'card solo-card' },
        h('div', { class: 'row between' }, h('h2', { text: 'Baca skenario' }), tm),
        h('p', { class: 'muted', text: 'Pelajari kasusnya dulu. Setelah 2 menit, tahap pengerjaan 18 menit dimulai otomatis.' }),
        h('p', { class: 'problem', text: c.brief.text }),
        pe && h('div', { class: 'pe' }, h('h3', { text: 'Pemeriksaan fisik' }), (pe.quote || []).map((q) => h('p', { class: 'problem', text: q }))),
        h('h3', { text: 'Tugas' }),
        h('ol', { class: 'solo-tasks' }, ['Lakukan anamnesis dengan menanyai pemilik hewan di kolom chat.', 'Isi hasil pemeriksaan fisik.', 'Tentukan diagnosis banding, lalu pilih pemeriksaan penunjang dan interpretasikan hasilnya.', 'Tentukan diagnosis akhir dan prognosis.', 'Susun rencana terapi dan resep.', 'Berikan edukasi kepada klien.'].map((t) => h('li', { text: t }))),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'solo-go', text: 'Mulai lebih awal →', on: { click: go } }), h('button', { class: 'btn', text: 'Batal', on: { click: exit } }))));
    runTimer(T1, tm, go);
  }

  /* ---------- stage 2 ---------- */
  function stage2() {
    const { h, mount, scenario } = API(); const c = S.c;
    const tm = h('div', { class: 'solo-timer', 'aria-label': 'Sisa waktu' });
    const content = h('div', { class: 'solo-content' });
    const tabs = h('div', { class: 'solo-tabs', role: 'tablist' });
    const log = h('div', { class: 'chat-log', id: 'chat-log', 'aria-live': 'polite' });
    const count = h('span', { class: 'muted', id: 'chat-count' });
    const input = h('input', { id: 'chat-in', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'Tulis pertanyaan untuk pemilik…' });
    const paintChat = () => {
      log.replaceChildren(...S.chat.map((m) => h('div', { class: `msg ${m.who}` }, h('div', { class: 'who', text: m.who === 'owner' ? 'PEMILIK HEWAN' : 'DOKTER' }), h('div', { text: m.text }))));
      log.scrollTop = log.scrollHeight;
      count.textContent = `${S.nq} pertanyaan diajukan`;
    };
    const send = (e) => {
      e.preventDefault();
      const t = input.value.trim(); if (!t) return;
      S.chat.push({ who: 'doctor', text: t }); S.nq++;
      const r = S.bot.ask(t); r.hits.forEach((i) => S.asked.add(i));
      S.chat.push({ who: 'owner', text: r.text }); input.value = ''; paintChat(); input.focus();
    };
    const paintTabs = () => tabs.replaceChildren(...TABS.map((t, i) => h('button', { class: `solo-tab${S.tab === i ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': S.tab === i ? 'true' : 'false', text: t, on: { click: () => goTab(i) } })));
    const goTab = (i) => { S.tab = i; paintTabs(); content.replaceChildren(panel(i, goTab, finish)); window.scrollTo({ top: 0 }); };
    const finish = () => { stopTimer(); stage3(); };
    const ref = h('details', { class: 'solo-ref' }, h('summary', { text: 'Lihat kembali soal' }), scenario(c));
    mount(
      h('p', { class: 'stage', text: 'Tahap 2 dari 3 · Pengerjaan (18 menit, otomatis lanjut ke hasil saat waktu habis)' }),
      h('div', { class: 'solo-bar' }, h('strong', { text: `No. ${API().numOf(c)} · ${c.title}` }), tm, h('button', { class: 'btn', type: 'button', text: 'Keluar', on: { click: () => { if (window.confirm('Keluar dari mode single-player? Jawabanmu akan hilang.')) exit(); } } })),
      h('div', { class: 'solo-grid' },
        h('section', { class: 'card solo-chat' }, h('h2', { text: 'Konsultasi dengan pemilik' }), h('p', { class: 'muted', text: 'Tanyakan riwayat. Pemilik hanya menjawab bila pertanyaanmu mengandung kata kunci yang tepat.' }), log,
          h('form', { class: 'chat-form', on: { submit: send } }, input, h('button', { class: 'btn primary', type: 'submit', id: 'chat-send', text: 'Kirim' })), count),
        h('div', { class: 'solo-main' }, ref, tabs, content)));
    paintChat(); paintTabs(); content.replaceChildren(panel(0, goTab, finish));
    runTimer(T2, tm, finish);
  }

  function field(h, label, node, id) { return h('div', { class: 'solo-field' }, h('label', { for: id, text: label }), node); }
  function textIn(h, id, get, set, attrs) {
    const n = h('input', { id, type: 'text', maxlength: '120', autocomplete: 'off', ...(attrs || {}) }); n.value = get();
    n.addEventListener('input', () => set(n.value)); return n;
  }
  function area(h, id, get, set, ph, rows) {
    const n = h('textarea', { id, rows: String(rows || 5), maxlength: '3000', placeholder: ph || '' }); n.value = get();
    n.addEventListener('input', () => set(n.value)); return n;
  }
  function selectIn(h, id, opts, get, set) {
    const n = h('select', { id }, h('option', { value: '', text: '— pilih —' }), opts.map((o) => h('option', { value: o, text: o }))); n.value = get();
    n.addEventListener('change', () => set(n.value)); return n;
  }
  function nav(h, i, goTab, finish) {
    return h('div', { class: 'row solo-nav' },
      i > 0 && h('button', { class: 'btn', type: 'button', text: '← Kembali', on: { click: () => goTab(i - 1) } }),
      i < 5 ? h('button', { class: 'btn primary', type: 'button', id: 'solo-next', text: 'Lanjut →', on: { click: () => goTab(i + 1) } })
        : h('button', { class: 'btn primary', type: 'button', id: 'solo-finish', text: 'Selesai dan lihat hasil', on: { click: () => { if (window.confirm('Selesai dan lihat hasil? Setelah ini jawaban tidak bisa diubah.')) finish(); } } }));
  }

  function panel(i, goTab, finish) {
    const { h } = API();
    const card = (...k) => h('section', { class: 'card solo-card' }, ...k);
    if (i === 0) {
      return card(h('h2', { text: 'Anamnesis' }),
        h('p', { class: 'muted', text: 'Gali informasi lewat chat di sebelah, lalu tuliskan ringkasannya di sini.' }),
        h('h3', { text: 'Data pasien' }),
        h('div', { class: 'solo-fields' },
          field(h, 'Nama pasien', textIn(h, 'p-nama', () => S.pat.nama, (v) => { S.pat.nama = v; }), 'p-nama'),
          field(h, 'Spesies', textIn(h, 'p-sp', () => S.pat.spesies, (v) => { S.pat.spesies = v; }), 'p-sp'),
          field(h, 'Ras / breed', textIn(h, 'p-ras', () => S.pat.ras, (v) => { S.pat.ras = v; }), 'p-ras'),
          field(h, 'Jenis kelamin', selectIn(h, 'p-jk', ['Jantan', 'Betina'], () => S.pat.kelamin, (v) => { S.pat.kelamin = v; }), 'p-jk'),
          field(h, 'Umur', textIn(h, 'p-umur', () => S.pat.umur, (v) => { S.pat.umur = v; }), 'p-umur')),
        h('h3', { text: 'Hasil anamnesis' }),
        area(h, 'anam', () => S.anam, (v) => { S.anam = v; }, 'Keluhan utama, onset, riwayat penyakit, pakan, vaksinasi, lingkungan…', 7), nav(h, 0, goTab, finish));
    }
    if (i === 1) {
      const v = S.vit;
      const sysBox = (name) => {
        const st = S.sys[name] || (S.sys[name] = { s: '', t: '' });
        const wrap = h('div', { class: 'solo-sys' });
        const paint = () => {
          wrap.replaceChildren(h('strong', { text: name }),
            h('div', { class: 'row' }, ['Normal', 'Abnormal'].map((o) => h('button', { class: `btn tog${st.s === o ? ' on' : ''}${st.s === o && o === 'Abnormal' ? ' bad' : ''}`, type: 'button', 'aria-pressed': st.s === o ? 'true' : 'false', text: o, on: { click: () => { st.s = st.s === o ? '' : o; paint(); } } }))),
            st.s === 'Abnormal' && (() => { const t = h('textarea', { rows: '2', maxlength: '500', placeholder: 'Temuan abnormal…', 'aria-label': `Temuan ${name}` }); t.value = st.t; t.addEventListener('input', () => { st.t = t.value; }); return t; })());
        };
        paint(); return wrap;
      };
      return card(h('h2', { text: 'Pemeriksaan fisik' }), h('p', { class: 'muted', text: 'Isi tanda vital dan temuan tiap sistem sesuai data pada soal (buka “Lihat kembali soal” di atas).' }),
        h('h3', { text: 'Tanda vital' }),
        h('div', { class: 'solo-fields' },
          field(h, 'Berat badan (kg)', textIn(h, 'v-bb', () => v.bb, (x) => { v.bb = x; }), 'v-bb'),
          field(h, 'Suhu tubuh (°C)', textIn(h, 'v-suhu', () => v.suhu, (x) => { v.suhu = x; }), 'v-suhu'),
          field(h, 'Frekuensi napas (/menit)', textIn(h, 'v-napas', () => v.napas, (x) => { v.napas = x; }), 'v-napas'),
          field(h, 'Frekuensi pulsus/jantung (/menit)', textIn(h, 'v-nadi', () => v.nadi, (x) => { v.nadi = x; }), 'v-nadi'),
          field(h, 'Turgor kulit', selectIn(h, 'v-turgor', ['< 2 detik', '> 2 detik'], () => v.turgor, (x) => { v.turgor = x; }), 'v-turgor'),
          field(h, 'CRT', selectIn(h, 'v-crt', ['< 2 detik', '> 2 detik'], () => v.crt, (x) => { v.crt = x; }), 'v-crt'),
          field(h, 'Warna mukosa', selectIn(h, 'v-mukosa', ['Merah muda', 'Pucat', 'Ikterus', 'Sianotik', 'Hiperemis', 'Petekie'], () => v.mukosa, (x) => { v.mukosa = x; }), 'v-mukosa')),
        h('h3', { text: 'Pemeriksaan per sistem' }), h('div', { class: 'solo-systems' }, SYSTEMS.map(sysBox)), nav(h, 1, goTab, finish));
    }
    if (i === 2) return testsPanel(card, goTab, finish);
    if (i === 3) {
      return card(h('h2', { text: 'Diagnosis & prognosis' }), h('p', { class: 'muted', text: 'Tentukan diagnosis akhir dan prognosis pasien.' }),
        field(h, 'Diagnosis', area(h, 'dx', () => S.dx, (x) => { S.dx = x; }, 'Diagnosis akhir…', 4), 'dx'),
        field(h, 'Prognosis', selectIn(h, 'prog', PROGS, () => S.prog, (x) => { S.prog = x; }), 'prog'), nav(h, 3, goTab, finish));
    }
    if (i === 4) {
      const list = h('div', { class: 'solo-rx' });
      const paint = () => {
        list.replaceChildren(...S.rx.map((r, k) => { const t = h('textarea', { rows: '3', maxlength: '600', placeholder: `R/ …\nm.f. …\nS …`, 'aria-label': `Resep ${k + 1}` }); t.value = r; t.addEventListener('input', () => { S.rx[k] = t.value; });
          return h('div', { class: 'solo-rx-row' }, h('strong', { text: `R/ ${k + 1}` }), t, S.rx.length > 1 && h('button', { class: 'btn', type: 'button', text: 'Hapus', on: { click: () => { S.rx.splice(k, 1); paint(); } } })); }),
        h('button', { class: 'btn', type: 'button', id: 'rx-add', text: '+ Tambah resep', on: { click: () => { S.rx.push(''); paint(); } } }));
      };
      paint();
      return card(h('h2', { text: 'Rencana terapi & resep' }), h('p', { class: 'muted', text: 'Susun rencana terapi sesuai kondisi pasien, lalu tuliskan resepnya.' }),
        field(h, 'Rencana terapi', area(h, 'tx', () => S.tx, (x) => { S.tx = x; }, 'Terapi / tindakan dan alasannya…', 6), 'tx'), h('h3', { text: 'Resep' }), list, nav(h, 4, goTab, finish));
    }
    return card(h('h2', { text: 'Edukasi klien' }), h('p', { class: 'muted', text: 'Tuliskan edukasi yang kamu sampaikan kepada pemilik.' }),
      area(h, 'edu', () => S.edu, (x) => { S.edu = x; }, 'Edukasi untuk pemilik…', 8), nav(h, 5, goTab, finish));
  }

  function testsPanel(card, goTab, finish) {
    const { h, resultBody } = API();
    const used = h('span', { class: 'badge', id: 'used-count' });
    const grid = h('div', { class: 'solo-tests' });
    const view = h('div', { class: 'solo-tview', id: 'tview' });
    const note = h('p', { class: 'notice', id: 'over-note', hidden: true, text: 'Kamu sudah memakai 5 pemeriksaan penunjang. Pemeriksaan berikutnya tetap bisa dilihat, tetapi ditandai sebagai berlebihan.' });
    const paint = () => {
      used.textContent = `${S.opened.length} / 5 terpakai`; used.className = `badge${S.opened.length > 5 ? ' over' : ''}`; note.hidden = S.opened.length <= 5;
      grid.replaceChildren(...S.tests.map((t) => { const idx = S.opened.indexOf(t.key); const over = idx >= 5;
        return h('button', { class: `btn solo-t${S.cur === t.key ? ' on' : ''}${idx >= 0 ? ' seen' : ''}${over ? ' over' : ''}`, type: 'button', 'data-test': t.label, text: `${t.label}${idx >= 0 ? (over ? ' ⚑' : ' ✓') : ''}`, on: { click: () => open(t) } }); }));
    };
    const open = (t) => {
      if (!S.opened.includes(t.key)) S.opened.push(t.key);
      S.cur = t.key; paint();
      const idx = S.opened.indexOf(t.key);
      const ta = h('textarea', { rows: '6', maxlength: '1500', id: 'interp', placeholder: 'Tulis interpretasi hasil pemeriksaan ini…' }); ta.value = S.interp[t.key] || ''; ta.addEventListener('input', () => { S.interp[t.key] = ta.value; });
      view.replaceChildren(h('div', { class: 'solo-tres' },
        h('div', {}, h('h3', {}, t.label, idx >= 5 && h('span', { class: 'badge over', text: ' Berlebihan' })), t.real ? resultBody(t.real, false) : h('p', { class: 'result-text', text: DECOY_TEXT })),
        h('div', {}, h('label', { for: 'interp', text: 'Interpretasi hasil pemeriksaan' }), ta)));
    };
    paint();
    return card(h('h2', { text: 'Diagnosis banding & pemeriksaan penunjang' }),
      field(h, 'Diagnosis banding (pisahkan dengan koma)', area(h, 'ddx', () => S.ddx, (x) => { S.ddx = x; }, 'Diagnosis banding…', 3), 'ddx'),
      h('div', { class: 'row between' }, h('h3', { text: 'Pemeriksaan penunjang' }), used),
      h('p', { class: 'muted', text: 'Pilih pemeriksaan yang diperlukan. Daftar ini memuat banyak pemeriksaan pengecoh, jadi pilih dengan cermat.' }), note, grid, view, nav(h, 2, goTab, finish));
  }

  /* ---------- stage 3: your answers against the key ---------- */
  function stage3() {
    const { h, mount, resultBody, lines } = API(); const c = S.c;
    const mine = (t) => (String(t || '').trim() ? h('p', { class: 'solo-mine', text: String(t).trim() }) : h('p', { class: 'muted', text: '(kosong)' }));
    const pair = (a, b) => h('div', { class: 'solo-cmp' }, h('div', {}, h('h4', { text: 'Jawabanmu' }), a), h('div', {}, h('h4', { text: 'Kunci jawaban' }), b));
    const sec = (title, open, ...kids) => h('details', { class: 'card solo-sec', open }, h('summary', {}, h('strong', { text: title })), ...kids);
    const aiNote = (k) => ((c.ai || []).includes(k) ? h('span', { class: 'badge ai', text: 'Jawaban dibuat AI' }) : null);

    const askedN = S.asked.size;
    const anam = sec('1. Anamnesis', true,
      h('p', { class: 'muted', text: `Kamu mengajukan ${S.nq} pertanyaan dan menggali ${askedN} dari ${c.anamnesis.length} informasi penting.` }),
      c.anamnesis.length ? c.anamnesis.map((x, i) => h('div', { class: `qa solo-qa ${S.asked.has(i) ? 'got' : 'miss'}` }, h('div', { class: 'q' }, h('span', { class: 'badge', text: S.asked.has(i) ? '✓ Ditanyakan' : '✗ Belum ditanyakan' }), ` ${x.q}`), h('div', { text: x.a }))) : h('p', { class: 'muted', text: 'Tidak ada jawaban anamnesis pada sumber kasus ini.' }),
      h('h4', { text: 'Ringkasan anamnesismu' }), mine(S.anam),
      S.chat.length > 1 && h('details', {}, h('summary', { text: 'Percakapanmu dengan pemilik' }), S.chat.map((m) => h('p', {}, h('strong', { text: m.who === 'owner' ? 'Pemilik: ' : 'Kamu: ' }), m.text))));

    const pe = c.tests.find((t) => t.label === 'Pemeriksaan fisik');
    const v = S.vit; const vit = [['Berat badan', v.bb && `${v.bb} kg`], ['Suhu', v.suhu && `${v.suhu} °C`], ['Frekuensi napas', v.napas && `${v.napas} /menit`], ['Frekuensi pulsus', v.nadi && `${v.nadi} /menit`], ['Turgor kulit', v.turgor], ['CRT', v.crt], ['Warna mukosa', v.mukosa]].filter((x) => x[1]);
    const sysFilled = SYSTEMS.map((n) => [n, S.sys[n]]).filter(([, s]) => s && s.s);
    const peSec = sec('2. Pemeriksaan fisik', false, pair(
      h('div', {}, vit.length ? h('ul', {}, vit.map(([k, x]) => h('li', { text: `${k}: ${x}` }))) : h('p', { class: 'muted', text: '(tanda vital kosong)' }),
        sysFilled.length ? h('ul', {}, sysFilled.map(([n, s]) => h('li', { text: `${n}: ${s.s}${s.s === 'Abnormal' && s.t ? ` · ${s.t}` : ''}` }))) : h('p', { class: 'muted', text: '(pemeriksaan per sistem kosong)' })),
      pe ? (pe.quote || []).map((q) => h('p', { class: 'solo-key', text: q })) : h('p', { class: 'muted', text: 'Tidak ada data pemeriksaan fisik pada sumber kasus ini.' })));

    const realTests = S.tests.filter((t) => t.real); const decoyUsed = S.tests.filter((t) => !t.real && S.opened.includes(t.key));
    const seen = (t) => S.opened.indexOf(t.key);
    const tests = sec('3. Diagnosis banding & pemeriksaan penunjang', true,
      pair(mine(S.ddx), h('ul', {}, (c.differential || []).map((x) => h('li', { text: x })))),
      h('p', { class: S.opened.length > 5 ? 'notice' : 'muted', text: `Kamu memakai ${S.opened.length} pemeriksaan penunjang${S.opened.length > 5 ? `, ${S.opened.length - 5} di antaranya berlebihan (di atas 5)` : ''}.` }),
      decoyUsed.length ? h('p', {}, h('strong', { text: 'Pemeriksaan pengecoh yang kamu pilih: ' }), decoyUsed.map((t) => t.label).join(', ')) : h('p', { class: 'muted', text: 'Kamu tidak memilih pemeriksaan pengecoh.' }),
      h('h4', { text: 'Pemeriksaan yang dibutuhkan kasus ini' }),
      realTests.length ? realTests.map((t) => h('details', { class: 'qd solo-test', open: seen(t) < 0 },
        h('summary', {}, h('strong', { text: t.label }), ' ', h('span', { class: `badge ${seen(t) >= 0 ? 'acc' : 'no'}`, text: seen(t) >= 0 ? '✓ Kamu lihat' : '✗ Tidak kamu lihat' }), t.real.ai && h('span', { class: 'badge ai', text: 'Contoh data dibuat AI' })),
        S.interp[t.key] && S.interp[t.key].trim() ? h('div', {}, h('h4', { text: 'Interpretasimu' }), mine(S.interp[t.key])) : null,
        h('div', { class: 'full' }, resultBody(t.real, true)))) : h('p', { class: 'muted', text: 'Tidak ada data pemeriksaan penunjang pada sumber kasus ini.' }));

    const dxSec = sec('4. Diagnosis & prognosis', true, pair(h('div', {}, h('h4', { text: 'Diagnosis' }), mine(S.dx), h('h4', { text: 'Prognosis' }), mine(S.prog)),
      h('div', {}, h('h4', { text: 'Diagnosis' }), h('p', { class: 'solo-key', text: c.diagnosis }), h('h4', {}, 'Prognosis ', aiNote('prognosis')), h('p', { class: 'solo-key', text: c.prognosis }))));

    const rxMine = S.rx.map((r) => r.trim()).filter(Boolean);
    const txSec = sec('5. Terapi & resep', true,
      pair(mine(S.tx), h('div', {}, h('h4', {}, 'Terapi ', aiNote('treatment')), lines(c.treatment))),
      h('h4', {}, 'Resep'),
      pair(rxMine.length ? rxMine.map((r) => h('pre', { class: 'rx', text: r })) : h('p', { class: 'muted', text: '(kosong)' }),
        h('div', {}, aiNote('prescription'), (c.prescription || []).map((r) => h('pre', { class: 'rx', text: r })), c.rxFooter && h('pre', { class: 'rx foot', text: c.rxFooter }))));

    const eduSec = sec('6. Edukasi klien', true, pair(mine(S.edu), h('div', {}, aiNote('education'), lines(c.education))),
      (c.refs || []).length ? h('details', {}, h('summary', { text: 'Referensi' }), lines(c.refs)) : null);

    mount(
      h('p', { class: 'stage', text: 'Tahap 3 dari 3 · Pembahasan (tanpa batas waktu)' }),
      h('section', { class: 'card solo-card' }, h('h2', { text: `Pembahasan: No. ${API().numOf(c)} · ${c.title}` }),
        h('p', { class: 'muted', text: 'Mode single-player tidak memakai rubrik penilaian. Bandingkan jawabanmu dengan kunci jawaban di bawah, termasuk anamnesis yang belum kamu tanyakan dan pemeriksaan penunjang yang belum kamu lihat.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', id: 'solo-again', text: 'Ulangi kasus ini', on: { click: () => start(c.id) } }),
          h('button', { class: 'btn', id: 'solo-other', text: 'Kasus lain', on: { click: () => { const { st } = API(); const pool = st.cases.filter((x) => x.id !== c.id); start(pool[Math.floor(Math.random() * pool.length)].id); } } }),
          h('button', { class: 'btn', id: 'solo-menu', text: 'Menu utama', on: { click: exit } }))),
      anam, peSec, tests, dxSec, txSec, eduSec, API().caseReportControl(c));
  }

  window.OSCE_SOLO = { start };
})();
