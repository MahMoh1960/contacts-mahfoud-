/* MAHFOUD's Contacts – logique pure (sans interface) */
var MC = (function () {
'use strict';

/* ---------- Normalisation de texte (latin + arabe) ---------- */
const ARDIAC = /[\u064B-\u065F\u0670\u0640]/g;
function norm(s) {
  if (s == null) return '';
  s = String(s).toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(ARDIAC, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function toLatinDigits(s) {
  return String(s == null ? '' : s).replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x6F0));
}

/* ---------- Numéros de téléphone ---------- */
const INVIS = /[\u200e\u200f\u202a-\u202e\s().\-\/]/g;
/* statuts : ok (déjà normalisé), fix (sera modifié), short (numéro court), special (poste, *, #),
   invalid (format inconnu), empty */
function normPhone(raw) {
  const orig = raw == null ? '' : String(raw);
  let s = toLatinDigits(orig).replace(INVIS, '');
  if (!s) return { out: orig, status: 'empty' };
  if (/[^+\d]/.test(s)) return { out: orig, status: 'special' };
  let plus = s.charAt(0) === '+';
  let d = s.replace(/\D/g, '');
  if (!plus && d.startsWith('00') && d.length > 4) { plus = true; d = d.slice(2); }
  const done = out => ({ out, status: out === orig ? 'ok' : 'fix' });
  if (plus) {
    if (d.startsWith('2120')) d = '212' + d.slice(4);
    if (d.length < 8 || d.length > 15) return { out: orig, status: 'invalid' };
    if (d.startsWith('212') && !/^212[5-8]\d{8}$/.test(d)) return { out: orig, status: 'invalid' };
    return done('+' + d);
  }
  if (/^0[5-8]\d{8}$/.test(d)) return done('+212' + d.slice(1));
  if (/^212[5-8]\d{8}$/.test(d)) return done('+' + d);
  if (/^[5-8]\d{8}$/.test(d)) return done('+212' + d);
  if (d.length <= 6) return { out: orig, status: 'short' };
  return { out: orig, status: 'invalid' };
}
/* clé de comparaison : 9 derniers chiffres pour le Maroc, sinon tous les chiffres ; null pour numéros courts */
function phoneKey(raw) {
  const r = normPhone(raw);
  if (r.status === 'short' || r.status === 'empty' || r.status === 'special') return null;
  let d = r.out.replace(/\D/g, '');
  if (r.status === 'invalid') {
    d = toLatinDigits(raw).replace(/\D/g, '');
    return d.length < 7 ? null : d.slice(-9);
  }
  return d.startsWith('212') ? d.slice(3) : d;
}
function dialNumber(raw) { return toLatinDigits(raw).replace(/[^\d+]/g, ''); }
function waNumber(raw) {
  const r = normPhone(raw);
  const s = (r.status === 'ok' || r.status === 'fix') ? r.out : toLatinDigits(raw);
  return s.replace(/\D/g, '');
}

/* ---------- Noms ---------- */
function dispName(c) {
  const n = c.name || {};
  let d = (n.display || '').trim();
  if (!d) d = [n.prefix, n.given, n.middle, n.family, n.suffix].filter(Boolean).join(' ').trim();
  if (!d && c.organization && c.organization.company) d = c.organization.company;
  if (!d && c.phones && c.phones[0] && c.phones[0].number) d = c.phones[0].number;
  if (!d && c.emails && c.emails[0] && c.emails[0].address) d = c.emails[0].address;
  return d || '';
}
function hasRealName(c) {
  const n = c.name || {};
  return !!((n.display || '').trim() || n.given || n.family || n.middle);
}
function nameKey(c) {
  const n = c.name || {};
  let t = [n.given, n.middle, n.family].filter(Boolean).join(' ');
  if (!t) t = n.display || '';
  const toks = norm(t).split(' ').filter(Boolean).sort();
  return toks.length >= 2 ? toks.join(' ') : '';
}
function fullKey(c) { return norm(dispName(c)).split(' ').filter(Boolean).sort().join(' '); }
function nameIsNumber(c) { return /^[+\d\s().\-]{5,}$/.test((dispName(c) || '').trim()) && !!(c.phones && c.phones.length); }
function initials(name) {
  const toks = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return toks.map(w => Array.from(w)[0].toUpperCase()).join('') || '#';
}
function cleanName(s) {
  if (!s) return s;
  let t = String(s).replace(/\s+/g, ' ').trim();
  if (/[A-Za-zÀ-ÿ]/.test(t) && !/[\u0600-\u06FF]/.test(t)) {
    const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (letters.length > 2 && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) {
      t = t.toLowerCase().replace(/(^|[\s'’\-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
    }
  }
  return t;
}

/* ---------- Conversion lecture -> saisie (plugin createContact) ---------- */
const PH_TYPES = new Set(['home', 'work', 'other', 'custom', 'mobile', 'fax_work', 'fax_home', 'pager', 'callback', 'car', 'company_main', 'isdn', 'main', 'other_fax', 'radio', 'telex', 'tty_tdd', 'work_mobile', 'work_pager', 'assistant', 'mms']);
const EM_TYPES = new Set(['home', 'work', 'other', 'custom', 'mobile']);
const AD_TYPES = new Set(['home', 'work', 'other', 'custom']);
function toInput(c) {
  const n = c.name || {};
  const name = { given: n.given || null, middle: n.middle || null, family: n.family || null, prefix: n.prefix || null, suffix: n.suffix || null };
  if (!name.given && !name.family && !name.middle) { const d = (n.display || '').trim(); if (d) name.given = d; }
  const out = { name };
  const o = c.organization;
  if (o && (o.company || o.jobTitle || o.department)) out.organization = { company: o.company || null, jobTitle: o.jobTitle || null, department: o.department || null };
  if (c.birthday && c.birthday.day && c.birthday.month) {
    out.birthday = { day: c.birthday.day, month: c.birthday.month };
    if (c.birthday.year) out.birthday.year = c.birthday.year;
  }
  if (c.note) out.note = c.note;
  out.phones = (c.phones || []).filter(p => p && p.number && String(p.number).trim()).map(p => ({ type: PH_TYPES.has(p.type) ? p.type : 'other', label: p.label || null, isPrimary: !!p.isPrimary, number: p.number }));
  out.emails = (c.emails || []).filter(e => e && e.address && String(e.address).trim()).map(e => ({ type: EM_TYPES.has(e.type) ? e.type : 'other', label: e.label || null, isPrimary: !!e.isPrimary, address: e.address }));
  out.postalAddresses = (c.postalAddresses || []).filter(a => a && (a.street || a.city || a.postcode || a.country || a.region || a.neighborhood)).map(a => ({ type: AD_TYPES.has(a.type) ? a.type : 'other', label: a.label || null, isPrimary: !!a.isPrimary, street: a.street || null, neighborhood: a.neighborhood || null, city: a.city || null, region: a.region || null, postcode: a.postcode || null, country: a.country || null }));
  out.urls = (c.urls || []).filter(u => u && String(u).trim());
  if (c.image && c.image.base64String) out.image = { base64String: c.image.base64String };
  return out;
}

/* ---------- Doublons ---------- */
function findDuplicates(list) {
  const parent = list.map((_, i) => i);
  const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const byPhone = new Map(), byName = new Map();
  list.forEach((c, i) => {
    const seen = new Set();
    (c.phones || []).forEach(p => {
      const k = phoneKey(p.number);
      if (k && !seen.has(k)) { seen.add(k); if (byPhone.has(k)) union(byPhone.get(k), i); else byPhone.set(k, i); }
    });
    const nk = nameKey(c);
    if (nk) { if (byName.has(nk)) union(byName.get(nk), i); else byName.set(nk, i); }
  });
  const groups = new Map();
  list.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
  const out = [];
  groups.forEach(m => {
    if (m.length < 2) return;
    const fk = m.map(fullKey);
    const sameName = fk[0] !== '' && fk.every(k => k === fk[0]);
    const cnt = new Map();
    m.forEach(c => { const s = new Set((c.phones || []).map(p => phoneKey(p.number)).filter(Boolean)); s.forEach(k => cnt.set(k, (cnt.get(k) || 0) + 1)); });
    const samePhone = [...cnt.values()].some(v => v > 1);
    out.push({ members: m, safe: sameName, reason: sameName && samePhone ? 'both' : (samePhone ? 'phone' : 'name') });
  });
  return out;
}
function richness(c) {
  return (c.phones || []).length * 2 + (c.emails || []).length * 2 + (c.postalAddresses || []).length + (c.note ? 1 : 0) +
    (c.organization && c.organization.company ? 1 : 0) + (c.birthday ? 1 : 0) + ((c.name && c.name.given && c.name.family) ? 2 : 0) + (c.image && c.image.base64String ? 1 : 0);
}
function bestPrimary(list) {
  let bi = 0, bs = -1;
  list.forEach((c, i) => { const s = richness(c); if (s > bs) { bs = s; bi = i; } });
  return bi;
}
function mergeContacts(list, primaryIndex) {
  const pi = primaryIndex == null ? bestPrimary(list) : primaryIndex;
  const ordered = [list[pi]].concat(list.filter((_, i) => i !== pi));
  const base = ordered[0];
  const out = { name: Object.assign({}, base.name || {}) };
  if (!hasRealName(base)) { const o = ordered.find(hasRealName); if (o) out.name = Object.assign({}, o.name); }
  out.organization = null; out.birthday = null; out.image = null;
  ordered.forEach(c => {
    if (!out.organization && c.organization && (c.organization.company || c.organization.jobTitle)) out.organization = c.organization;
    if (!out.birthday && c.birthday && c.birthday.day && c.birthday.month) out.birthday = c.birthday;
    if (!out.image && c.image && c.image.base64String) out.image = c.image;
  });
  const notes = [];
  ordered.forEach(c => { const n = (c.note || '').trim(); if (n && !notes.includes(n)) notes.push(n); });
  out.note = notes.join('\n');
  const phones = [], pk = new Set();
  ordered.forEach(c => (c.phones || []).forEach(p => {
    if (!p.number) return;
    const k = phoneKey(p.number) || ('raw' + toLatinDigits(p.number).replace(/\D/g, ''));
    if (!pk.has(k)) { pk.add(k); phones.push(p); }
  }));
  const emails = [], ek = new Set();
  ordered.forEach(c => (c.emails || []).forEach(e => {
    const k = (e.address || '').trim().toLowerCase();
    if (k && !ek.has(k)) { ek.add(k); emails.push(e); }
  }));
  const addrs = [], ak = new Set();
  ordered.forEach(c => (c.postalAddresses || []).forEach(a => {
    const k = norm([a.street, a.city, a.postcode].join(' '));
    if (k && !ak.has(k)) { ak.add(k); addrs.push(a); }
  }));
  const urls = [], uk = new Set();
  ordered.forEach(c => (c.urls || []).forEach(u => { if (u && !uk.has(u)) { uk.add(u); urls.push(u); } }));
  out.phones = phones; out.emails = emails; out.postalAddresses = addrs; out.urls = urls;
  return out;
}

/* ---------- Corrections automatiques ---------- */
function cleanContact(c, o) {
  const inp = toInput(c);
  const base = JSON.stringify(inp);
  const ch = new Set();
  const collapse = s => (s == null ? s : String(s).replace(/\s+/g, ' ').trim() || null);
  if (o.names) {
    ['given', 'middle', 'family', 'prefix', 'suffix'].forEach(k => {
      const v = inp.name[k]; if (!v) return;
      let n = collapse(v); if (o.caps) n = cleanName(n);
      if (n !== v) { inp.name[k] = n; ch.add('names'); }
    });
    if (inp.organization) ['company', 'jobTitle', 'department'].forEach(k => {
      const v = inp.organization[k]; if (!v) return;
      const n = collapse(v); if (n !== v) { inp.organization[k] = n; ch.add('names'); }
    });
  }
  if (o.phones) inp.phones.forEach(p => { const r = normPhone(p.number); if (r.status === 'fix') { p.number = r.out; ch.add('phones'); } });
  if (o.dedupe) {
    const seen = new Set(), ph = [];
    inp.phones.forEach(p => {
      const k = phoneKey(p.number) || ('raw' + toLatinDigits(p.number).replace(/\D/g, ''));
      if (!seen.has(k)) { seen.add(k); ph.push(p); } else { ch.add('dedupe'); const f = ph.find(x => (phoneKey(x.number) || ('raw' + toLatinDigits(x.number).replace(/\D/g, ''))) === k); if (f && p.isPrimary) f.isPrimary = true; }
    });
    inp.phones = ph;
    const es = new Set(), em = [];
    inp.emails.forEach(e => { const k = e.address.trim().toLowerCase(); if (!es.has(k)) { es.add(k); em.push(e); } else ch.add('dedupe'); });
    inp.emails = em;
  }
  if (o.emails) inp.emails.forEach(e => { const n = e.address.trim().toLowerCase(); if (n !== e.address) { e.address = n; ch.add('emails'); } });
  return { input: inp, changes: [...ch], changed: JSON.stringify(inp) !== base };
}

/* ---------- vCard ---------- */
function unesc(v) { return String(v).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function splitSemi(v) { return String(v).split(/(?<!\\);/).map(unesc); }
function qpDecode(str, charset) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(str.substr(i + 1, 2))) { bytes.push(parseInt(str.substr(i + 1, 2), 16)); i += 2; }
    else bytes.push(str.charCodeAt(i) & 255);
  }
  try { return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes)); } catch (e) { return String.fromCharCode.apply(null, bytes); }
}
function typeTokens(params) {
  const t = [];
  params.forEach(p => {
    const eq = p.indexOf('=');
    if (eq >= 0) { const k = p.slice(0, eq).toUpperCase(); if (k === 'TYPE') p.slice(eq + 1).split(',').forEach(x => t.push(x.toLowerCase())); }
    else t.push(p.toLowerCase());
  });
  return t;
}
function phoneTypeFrom(tk) {
  const has = x => tk.includes(x);
  if (has('fax')) return has('home') ? 'fax_home' : 'fax_work';
  if (has('pager')) return 'pager';
  if (has('cell') || has('mobile')) return has('work') ? 'work_mobile' : 'mobile';
  if (has('home')) return 'home';
  if (has('work')) return 'work';
  if (has('pref') && !has('voice')) return 'main';
  return 'other';
}
function parseBday(v) {
  v = String(v).trim();
  let m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  m = v.match(/^--(\d{2})-?(\d{2})/);
  if (m) return { month: +m[1], day: +m[2] };
  return null;
}
function parseVcf(text) {
  const raw = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = [];
  for (const l of raw) {
    if ((l.startsWith(' ') || l.startsWith('\t')) && lines.length) { lines[lines.length - 1] += l.slice(1); continue; }
    if (lines.length && /QUOTED-PRINTABLE/i.test(lines[lines.length - 1]) && /=$/.test(lines[lines.length - 1])) { lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + l; continue; }
    lines.push(l);
  }
  const cards = []; let cur = null;
  for (const line of lines) {
    const U = line.trim().toUpperCase();
    if (U === 'BEGIN:VCARD') { cur = { name: {}, phones: [], emails: [], postalAddresses: [], urls: [] }; continue; }
    if (U === 'END:VCARD') { if (cur) cards.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':'); if (idx < 0) continue;
    const left = line.slice(0, idx).split(';');
    let prop = left[0].toUpperCase(); const dot = prop.indexOf('.'); if (dot >= 0) prop = prop.slice(dot + 1);
    const params = left.slice(1);
    let val = line.slice(idx + 1);
    const pj = params.join(';');
    if (/QUOTED-PRINTABLE/i.test(pj)) { const cs = (pj.match(/CHARSET=([^;]+)/i) || [])[1]; val = qpDecode(val, cs); }
    const tk = typeTokens(params);
    if (prop === 'N') { const p = splitSemi(val); cur.name.family = p[0] || null; cur.name.given = p[1] || null; cur.name.middle = p[2] || null; cur.name.prefix = p[3] || null; cur.name.suffix = p[4] || null; }
    else if (prop === 'FN') cur.fn = unesc(val).trim();
    else if (prop === 'TEL') { const n = unesc(val).replace(/^tel:/i, '').trim(); if (n) cur.phones.push({ type: phoneTypeFrom(tk), label: null, isPrimary: false, number: n }); }
    else if (prop === 'EMAIL') { const a = unesc(val).trim(); if (a) cur.emails.push({ type: tk.includes('home') ? 'home' : tk.includes('work') ? 'work' : 'other', label: null, isPrimary: false, address: a }); }
    else if (prop === 'ADR') { const p = splitSemi(val); cur.postalAddresses.push({ type: tk.includes('home') ? 'home' : tk.includes('work') ? 'work' : 'other', label: null, isPrimary: false, street: [p[1], p[2]].filter(Boolean).join(' ') || null, city: p[3] || null, region: p[4] || null, postcode: p[5] || null, country: p[6] || null }); }
    else if (prop === 'ORG') { const p = splitSemi(val); cur.organization = Object.assign(cur.organization || {}, { company: p[0] || null, department: p[1] || null }); }
    else if (prop === 'TITLE') cur.organization = Object.assign(cur.organization || {}, { jobTitle: unesc(val).trim() || null });
    else if (prop === 'BDAY') { const b = parseBday(val); if (b) cur.birthday = b; }
    else if (prop === 'NOTE') cur.note = unesc(val);
    else if (prop === 'URL') { const u = unesc(val).trim(); if (u) cur.urls.push(u); }
    else if (prop === 'PHOTO') { if (/ENCODING=(B|BASE64)|^B$|BASE64/i.test(pj) && !/^https?:/i.test(val)) { const b = val.replace(/\s+/g, ''); if (b.length > 20) cur.image = { base64String: b }; } }
  }
  return cards.map(c => {
    const n = c.name;
    if (!n.given && !n.family && !n.middle && c.fn) n.given = c.fn;
    n.display = c.fn || [n.prefix, n.given, n.middle, n.family, n.suffix].filter(Boolean).join(' ');
    delete c.fn;
    return c;
  }).filter(c => dispName(c) || c.phones.length || c.emails.length);
}
function vesc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function fold(line) {
  if (line.length <= 74) return line;
  let out = line.slice(0, 74), rest = line.slice(74);
  while (rest.length) { out += '\r\n ' + rest.slice(0, 73); rest = rest.slice(73); }
  return out;
}
const V_PH = { mobile: 'CELL', home: 'HOME', work: 'WORK', fax_work: 'FAX,WORK', fax_home: 'FAX,HOME', pager: 'PAGER', main: 'PREF', work_mobile: 'WORK,CELL' };
function toVcf(c, opts) {
  opts = opts || {};
  const n = c.name || {}, L = [];
  L.push('BEGIN:VCARD', 'VERSION:3.0');
  L.push('N:' + [n.family, n.given, n.middle, n.prefix, n.suffix].map(vesc).join(';'));
  L.push('FN:' + vesc(dispName(c)));
  const o = c.organization;
  if (o && (o.company || o.department)) L.push('ORG:' + vesc(o.company) + (o.department ? ';' + vesc(o.department) : ''));
  if (o && o.jobTitle) L.push('TITLE:' + vesc(o.jobTitle));
  (c.phones || []).forEach(p => { if (p.number) L.push('TEL;TYPE=' + (V_PH[p.type] || 'VOICE') + ':' + vesc(p.number)); });
  (c.emails || []).forEach(e => { if (e.address) L.push('EMAIL;TYPE=INTERNET' + (e.type === 'home' ? ',HOME' : e.type === 'work' ? ',WORK' : '') + ':' + vesc(e.address)); });
  (c.postalAddresses || []).forEach(a => L.push('ADR;TYPE=' + (a.type === 'work' ? 'WORK' : 'HOME') + ':;;' + [a.street, a.city, a.region, a.postcode, a.country].map(vesc).join(';')));
  const b = c.birthday;
  if (b && b.day && b.month) L.push('BDAY:' + (b.year ? String(b.year).padStart(4, '0') + '-' : '--') + String(b.month).padStart(2, '0') + '-' + String(b.day).padStart(2, '0'));
  if (c.note) L.push('NOTE:' + vesc(c.note));
  (c.urls || []).forEach(u => { if (u) L.push('URL:' + vesc(u)); });
  if (opts.photo && c.image && c.image.base64String) L.push('PHOTO;ENCODING=b;TYPE=JPEG:' + c.image.base64String);
  L.push('END:VCARD');
  return L.map(fold).join('\r\n');
}
function toVcfAll(list, opts) { return list.map(c => toVcf(c, opts)).join('\r\n') + '\r\n'; }

/* ---------- CSV / TXT ---------- */
function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
function toCsv(list, tagsOf) {
  const head = ['Nom', 'Prénom', 'Nom affiché', 'Société', 'Fonction', 'Téléphones', 'E-mails', 'Adresses', 'Anniversaire', 'Notes', 'Groupes'];
  const rows = list.map(c => {
    const n = c.name || {}, o = c.organization || {}, b = c.birthday;
    return [n.family, n.given, dispName(c), o.company, o.jobTitle,
      (c.phones || []).map(p => p.number).filter(Boolean).join(' | '),
      (c.emails || []).map(e => e.address).filter(Boolean).join(' | '),
      (c.postalAddresses || []).map(a => [a.street, a.postcode, a.city, a.country].filter(Boolean).join(' ')).join(' | '),
      b && b.day ? (b.year ? b.year + '-' : '') + String(b.month).padStart(2, '0') + '-' + String(b.day).padStart(2, '0') : '',
      (c.note || '').replace(/\r?\n/g, ' '), (tagsOf ? tagsOf(c) : []).join(' | ')].map(csvCell).join(';');
  });
  return '\uFEFF' + [head.map(csvCell).join(';')].concat(rows).join('\r\n') + '\r\n';
}
function toTxt(list) {
  return list.map(c => {
    const o = c.organization || {};
    const l = [dispName(c)];
    if (o.company || o.jobTitle) l.push('  ' + [o.company, o.jobTitle].filter(Boolean).join(' – '));
    (c.phones || []).forEach(p => l.push('  ☎ ' + p.number));
    (c.emails || []).forEach(e => l.push('  ✉ ' + e.address));
    return l.join('\n');
  }).join('\n\n') + '\n';
}

/* ---------- Anniversaires ---------- */
function nextBirthday(b, now) {
  now = now || new Date();
  if (!b || !b.day || !b.month) return null;
  for (let k = 0; k < 3; k++) {
    const y = now.getFullYear() + k;
    let d = b.day;
    if (b.month === 2 && d === 29 && new Date(y, 1, 29).getMonth() !== 1) d = 28;
    const date = new Date(y, b.month - 1, d, 8, 0, 0);
    if (date >= now) return { date, age: b.year ? y - b.year : null, days: Math.round((new Date(y, b.month - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000) };
  }
  return null;
}

/* ---------- Code PIN ---------- */
async function pinHash(pin, salt) {
  const enc = new TextEncoder();
  const cr = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : null;
  if (cr) {
    const key = await cr.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await cr.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261; const s = salt + pin;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'f' + (h >>> 0).toString(16);
}

return { norm, toLatinDigits, normPhone, phoneKey, dialNumber, waNumber, dispName, hasRealName, nameKey, nameIsNumber, initials, cleanName,
  toInput, findDuplicates, mergeContacts, bestPrimary, cleanContact, parseVcf, toVcf, toVcfAll, toCsv, toTxt, nextBirthday, pinHash };
})();
