// Usage: node encrypt-bank.js bank.json bank.enc "<id>" "<password>"
// Encrypts the question bank (PBKDF2-SHA256, 600k iterations -> AES-256-GCM).
// Upload only the .enc files to the repository, never the plain bank.json.
// A large bank is split over bank.enc, bank.2.enc, bank.3.enc ... (each under 12 MB) because GitHub's web upload refuses files over 25 MB.
// Upload ALL of the parts that were written and delete older parts that are no longer produced.
const fs = require('fs');
const { webcrypto: c } = require('crypto');
const [, , input, output, id, password] = process.argv;
if (!input || !output || !id || !password) {
  console.error('Usage: node encrypt-bank.js bank.json bank.enc "<id>" "<password>"');
  process.exit(1);
}
(async () => {
  const data = fs.readFileSync(input, 'utf8');
  JSON.parse(data); // refuse to encrypt invalid JSON
  const iter = 600000;
  // Keep the salt of the file being replaced: admin edits are sealed with a key derived from it, so a new salt would make every earlier edit unreadable.
  // Salts of older files stay listed in "prev" so edits made under them can still be opened.
  let salt = c.getRandomValues(new Uint8Array(16));
  let prev = [];
  try {
    const old = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (old && typeof old.salt === 'string' && Number.isInteger(old.iter) && old.iter === iter) { salt = Buffer.from(old.salt, 'base64'); prev = Array.isArray(old.prev) ? old.prev.filter((x) => typeof x === 'string') : []; }
  } catch (_) { /* first run */ }
  const addPrev = (s) => { if (s && !prev.includes(s) && s !== Buffer.from(salt).toString('base64')) prev.push(s); };
  (process.env.EXTRA_PREV || '').split(',').map((x) => x.trim()).filter(Boolean).forEach(addPrev);
  const iv = c.getRandomValues(new Uint8Array(12));
  const base = await c.subtle.importKey('raw', new TextEncoder().encode(`${id.trim().toLowerCase()}:${password}`), 'PBKDF2', false, ['deriveKey']);
  const key = await c.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(data)));
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  const all = b64(ct);
  const SIZE = 12000000; // characters per part, a multiple of 4 so the base64 pieces can be joined again
  const n = Math.max(1, Math.ceil(all.length / SIZE));
  const set = Buffer.from(c.getRandomValues(new Uint8Array(4))).toString('hex');
  const nameOf = (k) => (k === 1 ? output : output.replace(/\.enc$/, `.${k}.enc`));
  for (let k = 1; k <= n; k++) {
    const piece = all.slice((k - 1) * SIZE, k * SIZE);
    const obj = k === 1
      ? (n > 1 ? { v: 1, iter, salt: b64(salt), ...(prev.length ? { prev } : {}), iv: b64(iv), parts: n, set, ct: piece } : { v: 1, iter, salt: b64(salt), ...(prev.length ? { prev } : {}), iv: b64(iv), ct: piece })
      : { v: 1, part: k, set, ct: piece };
    fs.writeFileSync(nameOf(k), JSON.stringify(obj));
    console.log(`Wrote ${nameOf(k)} (${fs.statSync(nameOf(k)).size} bytes)`);
  }
  for (let k = n + 1; fs.existsSync(nameOf(k)); k++) { fs.unlinkSync(nameOf(k)); console.log(`Removed old ${nameOf(k)}`); }
})();
