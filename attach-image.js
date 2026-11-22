// Usage: node attach-image.js bank.json <question-id> <where> <image> [<image> ...]
//   where = stem | explanation | option:A | option:B | ...
// Embeds the image(s) in bank.json as data URIs; then run encrypt-bank.js and upload only bank.enc.
// Tip: shrink images first (about 900 px wide, JPEG or PNG) so the bank stays small.
const fs = require('fs');
const path = require('path');
const [, , file, id, where, ...imgs] = process.argv;
if (!file || !id || !where || !imgs.length) { console.error('Usage: node attach-image.js bank.json <id> <stem|explanation|option:A> <image> [...]'); process.exit(1); }
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const uri = (f) => { const m = mime[path.extname(f).toLowerCase()]; if (!m) throw new Error(`Unsupported image type: ${f}`); return `data:${m};base64,${fs.readFileSync(f).toString('base64')}`; };
const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
const q = bank.find((x) => x.id === id);
if (!q) { console.error(`No question with id ${id}`); process.exit(1); }
const list = imgs.map(uri);
if (where === 'stem') q.images = [...(q.images || []), ...list];
else if (where === 'explanation') q.explanationImages = [...(q.explanationImages || []), ...list];
else if (/^option:[A-Z]$/i.test(where)) {
  const i = where.split(':')[1].toUpperCase().charCodeAt(0) - 65;
  if (i >= q.options.length) { console.error('That option does not exist.'); process.exit(1); }
  q.optionImages = q.optionImages && q.optionImages.length === q.options.length ? q.optionImages : q.options.map(() => '');
  q.optionImages[i] = list[0];
} else { console.error('where must be stem, explanation, or option:A'); process.exit(1); }
fs.writeFileSync(file, JSON.stringify(bank));
console.log(`${id}: ${imgs.length} image(s) added to ${where}.`);
