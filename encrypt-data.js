// Usage: node encrypt-data.js cases.json cases.enc "<id>" "<password>"
// Encrypts the OSCE case database (PBKDF2-SHA256, 600k iterations -> AES-256-GCM).
// Upload only cases.enc to the repository, never the plain cases.json.
const fs = require('fs');
const { webcrypto: c } = require('crypto');
const [, , input, output, id, password] = process.argv;
if (!input || !output || !id || !password) {
  console.error('Usage: node encrypt-data.js cases.json cases.enc "<id>" "<password>"');
  process.exit(1);
}
(async () => {
  const data = fs.readFileSync(input, 'utf8');
  JSON.parse(data); // refuse to encrypt invalid JSON
  const iter = 600000;
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const base = await c.subtle.importKey('raw', new TextEncoder().encode(`${id.trim().toLowerCase()}:${password}`), 'PBKDF2', false, ['deriveKey']);
  const key = await c.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(data)));
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  fs.writeFileSync(output, JSON.stringify({ v: 1, iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  console.log(`Wrote ${output} (${fs.statSync(output).size} bytes)`);
})();
