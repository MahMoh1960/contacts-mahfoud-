/* MAHFOUD's Contacts – interface et accès au répertoire */
(function () {
'use strict';

/* ---------- Utilitaires ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const CAP = () => window.Capacitor || {};
const PL = () => CAP().Plugins || {};
const isNative = () => !!(CAP().isNativePlatform && CAP().isNativePlatform());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SKIP = { skip: true };
const FULL = { name: true, organization: true, birthday: true, note: true, phones: true, emails: true, urls: true, postalAddresses: true };

/* ---------- État ---------- */
const S = {
  settings: Object.assign({ lang: 'fr', sort: 'name', pin: null, bday: false }, lsGet('mc_settings', {})),
  meta: Object.assign({ fav: {}, tags: {}, custom: {}, groups: [] }, lsGet('mc_meta', {})),
  useful: lsGet('mc_useful', []),
  contacts: [], tab: 'contacts', q: '', group: null, ack: false, an: null, dupLimit: 40,
  fix: { phones: true, names: true, caps: false, emails: true, dedupe: true }, hiddenAt: 0
};
const saveSettings = () => lsSet('mc_settings', S.settings);
const saveMeta = () => lsSet('mc_meta', S.meta);
const t = (k, ...a) => { const v = (I18N[S.settings.lang] || I18N.fr)[k]; if (v === undefined) return k; return typeof v === 'function' ? v(...a) : v; };

/* ---------- Petites interfaces : toast, feuilles, dialogues ---------- */
function toast(msg, ms) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, ms || 2600);
}
const sheetStack = [];
function openSheet(html, cls) {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = '<div class="sheet ' + (cls || '') + '">' + html + '</div>';
  el.addEventListener('click', e => { if (e.target === el && !el._lock) closeSheet(el); });
  document.body.appendChild(el); sheetStack.push(el);
  return el;
}
function closeSheet(el) {
  const i = sheetStack.indexOf(el); if (i >= 0) sheetStack.splice(i, 1);
  el.remove(); if (el._onclose) { const f = el._onclose; el._onclose = null; f(); }
}
function confirmSheet(msg, okLabel) {
  return new Promise(res => {
    const el = openSheet('<p class="msg">' + esc(msg) + '</p><div class="actions"><button class="btn sec" data-x="0">' + esc(t('cancel')) + '</button><button class="btn" data-x="1">' + esc(okLabel || t('ok')) + '</button></div>');
    el._onclose = () => res(false);
    el.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (!b) return; el._onclose = null; closeSheet(el); res(b.dataset.x === '1'); });
  });
}
function alertSheet(msg) {
  const el = openSheet('<p class="msg">' + esc(msg).replace(/\n/g, '<br>') + '</p><div class="actions"><button class="btn" data-x="1">' + esc(t('ok')) + '</button></div>');
  el.addEventListener('click', e => { if (e.target.closest('[data-x]')) closeSheet(el); });
}
function askText(label, value, type) {
  return new Promise(res => {
    const el = openSheet('<label>' + esc(label) + '<input id="askin" type="' + (type || 'text') + '" value="' + esc(value || '') + '"></label><div class="actions"><button class="btn sec" data-x="0">' + esc(t('cancel')) + '</button><button class="btn" data-x="1">' + esc(t('ok')) + '</button></div>');
    el._onclose = () => res(null);
    setTimeout(() => { const i = $('#askin', el); if (i) i.focus(); }, 50);
    el.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (!b) return; const v = $('#askin', el).value.trim(); el._onclose = null; closeSheet(el); res(b.dataset.x === '1' ? v : null); });
  });
}
function progressSheet() {
  const el = openSheet('<p class="msg" id="pgt"></p><div class="bar"><i id="pgb"></i></div><div class="actions"><button class="btn sec" data-x="1">' + esc(t('stop')) + '</button></div>');
  el._lock = true;
  const o = { cancelled: false, el, set(i, n) { $('#pgt', el).textContent = t('progress', i, n); $('#pgb', el).style.width = Math.round(100 * i / Math.max(1, n)) + '%'; }, close() { closeSheet(el); } };
  el.addEventListener('click', e => { if (e.target.closest('[data-x]')) { o.cancelled = true; $('#pgt', el).textContent = '…'; } });
  o.set(0, 1);
  return o;
}
function warnModify() {
  return new Promise(res => {
    const el = openSheet('<h2>' + esc(t('warnTitle')) + '</h2><div class="warn">' + esc(t('warnText')).replace(/\n/g, '<br>') + '</div><label class="chk"><input type="checkbox" id="ackbox"' + (S.ack ? ' checked' : '') + '><span>' + esc(t('ack')) + '</span></label><div class="actions"><button class="btn sec" data-x="0">' + esc(t('cancel')) + '</button><button class="btn" id="goBtn" data-x="1"' + (S.ack ? '' : ' disabled') + '>' + esc(t('go')) + '</button></div>');
    el._onclose = () => res(false);
    $('#ackbox', el).onchange = e => { $('#goBtn', el).disabled = !e.target.checked; };
    el.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (!b || b.disabled) return; if (b.dataset.x === '1') S.ack = true; el._onclose = null; closeSheet(el); res(b.dataset.x === '1'); });
  });
}

/* ---------- Accès au répertoire : téléphone (plugin) ou mode local (démonstration) ---------- */
const localAll = () => lsGet('mc_local', []);
const localSave = a => lsSet('mc_local', a);
function inputToPayload(inp, id) {
  const n = inp.name || {};
  return { contactId: id, name: Object.assign({ display: [n.prefix, n.given, n.middle, n.family, n.suffix].filter(Boolean).join(' ') }, n),
    organization: inp.organization || { company: null, jobTitle: null, department: null }, birthday: inp.birthday || null, note: inp.note || null,
    phones: (inp.phones || []).slice(), emails: (inp.emails || []).slice(), urls: (inp.urls || []).slice(), postalAddresses: (inp.postalAddresses || []).slice(), image: inp.image };
}
const Backend = {
  mode: 'local', C: null, granted: true,
  async init() {
    const C = PL().Contacts;
    if (isNative() && C) {
      this.mode = 'native'; this.C = C;
      try {
        let p = await C.checkPermissions();
        if (p.contacts !== 'granted' && p.contacts !== 'limited') p = await C.requestPermissions();
        this.granted = (p.contacts === 'granted' || p.contacts === 'limited');
      } catch (e) { this.granted = false; }
    } else { this.mode = 'local'; this.granted = true; }
  },
  async list() { return this.mode === 'native' ? ((await this.C.getContacts({ projection: FULL })).contacts || []) : localAll(); },
  async listWithImages() { return this.mode === 'native' ? ((await this.C.getContacts({ projection: Object.assign({}, FULL, { image: true }) })).contacts || []) : localAll(); },
  async get(id, img) {
    if (this.mode === 'native') return (await this.C.getContact({ contactId: id, projection: Object.assign({}, FULL, { image: !!img }) })).contact;
    const c = localAll().find(x => x.contactId === id); if (!c) throw new Error('introuvable'); return c;
  },
  async create(inp) {
    if (this.mode === 'native') return (await this.C.createContact({ contact: inp })).contactId;
    const id = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const a = localAll(); a.push(inputToPayload(inp, id));
    if (!localSave(a)) throw new Error('stockage plein');
    return id;
  },
  async remove(id) {
    if (this.mode === 'native') { await this.C.deleteContact({ contactId: id }); return; }
    localSave(localAll().filter(c => c.contactId !== id));
  }
};

/* ---------- Sauvegardes internes (IndexedDB) ---------- */
const Snaps = {
  db: null, mem: [],
  open() {
    if (this.db || !window.indexedDB) return Promise.resolve(this.db);
    return new Promise(res => {
      try {
        const r = indexedDB.open('mc', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 'id' });
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  },
  async put(s) {
    const db = await this.open();
    if (!db) { const i = this.mem.findIndex(x => x.id === s.id); if (i >= 0) this.mem[i] = s; else this.mem.push(s); return; }
    return new Promise((res, rej) => { const tx = db.transaction('snaps', 'readwrite'); tx.objectStore('snaps').put(s); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  },
  async all() {
    const db = await this.open();
    if (!db) return this.mem.slice().sort((a, b) => b.id - a.id);
    return new Promise(res => { const r = db.transaction('snaps').objectStore('snaps').getAll(); r.onsuccess = () => res(r.result.sort((a, b) => b.id - a.id)); r.onerror = () => res([]); });
  },
  async del(id) {
    const db = await this.open();
    if (!db) { this.mem = this.mem.filter(x => x.id !== id); return; }
    return new Promise(res => { const tx = db.transaction('snaps', 'readwrite'); tx.objectStore('snaps').delete(id); tx.oncomplete = res; tx.onerror = res; });
  },
  async prune(keep) { const a = await this.all(); for (const s of a.slice(keep || 10)) await this.del(s.id); }
};

/* ---------- Chargement et préparation des contacts ---------- */
function prep(c) {
  c._name = MC.dispName(c);
  c._n = MC.norm(c._name);
  const o = c.organization || {};
  c._o = MC.norm(o.company);
  c._s = MC.norm([c._name, o.company, o.jobTitle, (c.emails || []).map(e => e.address).join(' '), c.note].join(' '));
  const v = [];
  (c.phones || []).forEach(p => {
    const d = MC.toLatinDigits(p.number).replace(/\D/g, ''); const k = MC.phoneKey(p.number);
    v.push(d); if (k) { v.push(k, '0' + k, '212' + k); }
  });
  c._p = v.join(' ');
  return c;
}
function showLoader(on) { $('#loader').hidden = !on; }
async function loadContacts() {
  showLoader(true);
  try { S.contacts = (await Backend.list()).map(prep); S.an = null; }
  catch (e) { S.contacts = []; alertSheet(String(e && e.message || e)); }
  finally { showLoader(false); }
  render(); scheduleBirthdays();
}
function matches(c, q) {
  const nq = MC.norm(q); const toks = nq.split(' ').filter(Boolean);
  if (toks.length && toks.every(tk => c._s.includes(tk))) return true;
  const dq = MC.toLatinDigits(q).replace(/\D/g, '');
  return dq.length >= 3 && /^[\d\s+().\-]+$/.test(q.trim()) && c._p.includes(dq);
}
function visible() {
  let l = S.contacts;
  if (S.tab === 'fav') l = l.filter(c => S.meta.fav[c.contactId]);
  if (S.tab === 'groups' && S.group) l = l.filter(c => (S.meta.tags[c.contactId] || []).includes(S.group));
  const q = S.q.trim(); if (q) l = l.filter(c => matches(c, q));
  const key = S.settings.sort === 'org' ? c => (c._o || '~') + ' ' + c._n : c => c._n;
  return l.slice().sort((a, b) => key(a).localeCompare(key(b), 'fr'));
}
function letterOf(c) {
  const k = S.settings.sort === 'org' ? (c._o || c._n) : c._n; const ch = k.charAt(0);
  if (!ch) return '#'; if (/[a-z]/.test(ch)) return ch.toUpperCase(); if (/[؀-ۿ]/.test(ch)) return ch; return '#';
}

/* ---------- Rendu général ---------- */
const TABS = ['contacts', 'fav', 'groups', 'clean', 'bday', 'stats', 'sos'];
const TAB_KEYS = { contacts: 'tContacts', fav: 'tFav', groups: 'tGroups', clean: 'tClean', bday: 'tBday', stats: 'tStats', sos: 'tSos' };
function setTab(tab) { S.tab = tab; S.group = null; render(); const v = $('#view'); if (v) v.scrollTop = 0; window.scrollTo(0, 0); }
function render() {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  const showSearch = ['contacts', 'fav', 'groups'].includes(S.tab) && (S.tab !== 'groups' || S.group);
  $('#searchbar').hidden = !showSearch;
  $('#fab').hidden = !(S.tab === 'contacts' || S.tab === 'fav' || (S.tab === 'groups' && S.group) || S.tab === 'sos');
  $('#index').hidden = true;
  if (!Backend.granted && S.tab !== 'sos') { renderPerm(); return; }
  ({ contacts: renderList, fav: renderList, groups: renderGroups, clean: renderClean, bday: renderBday, stats: renderStats, sos: renderSos })[S.tab]();
}
function renderPerm() {
  $('#view').innerHTML = '<div class="card"><h3>' + esc(t('permTitle')) + '</h3><p>' + esc(t('permText')) + '</p><div class="actions"><button class="btn" data-act="retryperm">' + esc(t('retry')) + '</button><button class="btn sec" data-act="impvcf">' + esc(t('impVcf')) + '</button></div></div>';
}
function rowHTML(c) {
  const nm = c._name || t('noName');
  const sub = [(c.organization && c.organization.company) || '', (c.phones && c.phones[0] && c.phones[0].number) || ''].filter(Boolean).join(' · ');
  return '<div class="crow" data-id="' + esc(c.contactId) + '"><div class="av">' + esc(MC.initials(nm)) + '</div><div class="mid"><b>' + esc(nm) + '</b><small>' + esc(sub) + '</small></div>' + (S.meta.fav[c.contactId] ? '<span class="fs">★</span>' : '') + '</div>';
}
function renderList() {
  const l = visible();
  let h = '';
  if (Backend.mode === 'local') h += '<div class="card note">' + esc(t('demo')) + '</div>';
  if (!S.contacts.length) {
    h += '<div class="empty">' + esc(t('empty')) + '</div><div class="actions c"><button class="btn" data-act="impvcf">' + esc(t('impVcf')) + '</button></div>';
    $('#view').innerHTML = h; return;
  }
  if (!l.length) { h += '<div class="empty">' + esc(S.tab === 'fav' && !S.q ? t('noFav') : t('noResult')) + '</div>'; $('#view').innerHTML = h; return; }
  h += '<div class="count">' + esc(t('nContacts', l.length)) + '</div>';
  let last = null; const letters = [];
  l.forEach(c => {
    const L = letterOf(c);
    if (L !== last) { h += '<div class="sec" data-sec="' + esc(L) + '">' + esc(L) + '</div>'; letters.push(L); last = L; }
    h += rowHTML(c);
  });
  $('#view').innerHTML = h;
  if (l.length > 25) { $('#index').innerHTML = letters.map(x => '<a data-l="' + esc(x) + '">' + esc(x) + '</a>').join(''); $('#index').hidden = false; }
}

/* ---------- Fiche d'un contact ---------- */
const PH_LABEL = { mobile: 'ty_mobile', home: 'ty_home', work: 'ty_work', main: 'ty_main', other: 'ty_other', fax_work: 'ty_fax', fax_home: 'ty_fax', other_fax: 'ty_fax', work_mobile: 'ty_work_mobile' };
const tyLabel = (type, label) => label || (PH_LABEL[type] ? t(PH_LABEL[type]) : (type || ''));
async function openDetail(id) {
  const c = S.contacts.find(x => x.contactId === id); if (!c) return;
  const el = openSheet('', 'big');
  const draw = () => {
    const nm = c._name || t('noName'), o = c.organization || {}, tags = S.meta.tags[id] || [], cu = S.meta.custom[id] || {};
    let h = '<div class="dhead"><div class="av lg" id="dav">' + esc(MC.initials(nm)) + '</div><div class="dt"><h2>' + esc(nm) + '</h2><div class="sub">' + esc([o.company, o.jobTitle].filter(Boolean).join(' · ')) + '</div></div><button class="star" data-a="fav">' + (S.meta.fav[id] ? '★' : '☆') + '</button></div>';
    (c.phones || []).forEach(p => {
      const dn = MC.dialNumber(p.number), wa = MC.waNumber(p.number);
      h += '<div class="line"><span class="ty">' + esc(tyLabel(p.type, p.label)) + '</span><span class="val">' + esc(p.number) + '</span><span class="acts"><a href="tel:' + esc(dn) + '" title="' + esc(t('call')) + '">📞</a><a href="sms:' + esc(dn) + '" title="' + esc(t('sms')) + '">💬</a><a href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener" title="' + esc(t('wa')) + '">WA</a></span></div>';
    });
    (c.emails || []).forEach(e => { h += '<div class="line"><span class="ty">' + esc(t('email')) + '</span><span class="val">' + esc(e.address) + '</span><span class="acts"><a href="mailto:' + esc(e.address) + '">✉</a></span></div>'; });
    (c.postalAddresses || []).forEach(a => {
      const txt = [a.street, a.postcode, a.city, a.country].filter(Boolean).join(', ');
      if (txt) h += '<div class="line"><span class="ty">📍</span><span class="val">' + esc(txt) + '</span><span class="acts"><a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(txt) + '" target="_blank" rel="noopener">🗺</a></span></div>';
    });
    const b = c.birthday;
    if (b && b.day && b.month) h += '<div class="line"><span class="ty">🎂</span><span class="val">' + String(b.day).padStart(2, '0') + '/' + String(b.month).padStart(2, '0') + (b.year ? '/' + b.year : '') + '</span></div>';
    if (c.note) h += '<div class="line"><span class="ty">📝</span><span class="val">' + esc(c.note) + '</span></div>';
    h += '<div class="lbl">' + esc(t('groups')) + '</div><div class="chips">' + S.meta.groups.map(g => '<button class="chip' + (tags.includes(g) ? ' on' : '') + '" data-a="tag" data-g="' + esc(g) + '">' + esc(g) + '</button>').join('') + '<button class="chip" data-a="newtag">' + esc(t('gNew')) + '</button></div>';
    h += '<div class="lbl">' + esc(t('custom')) + '</div>' + Object.keys(cu).map(k => '<div class="line"><span class="ty">' + esc(k) + '</span><span class="val">' + esc(cu[k]) + '</span><span class="acts"><a data-a="delfield" data-k="' + esc(k) + '">×</a></span></div>').join('') + '<button class="chip" data-a="addfield">' + esc(t('addField')) + '</button>';
    h += '<div class="actions wrap"><button class="btn sec" data-a="share">' + esc(t('share')) + '</button><button class="btn sec" data-a="del">' + esc(t('del')) + '</button><button class="btn" data-a="edit">' + esc(t('edit')) + '</button></div>';
    $('.sheet', el).innerHTML = h;
    if (el._img) { const d = $('#dav', el); d.innerHTML = '<img alt="" src="data:image/jpeg;base64,' + el._img + '">'; }
  };
  draw();
  Backend.get(id, true).then(f => { el._full = f; if (f && f.image && f.image.base64String) { el._img = f.image.base64String; if (el.isConnected) draw(); } }).catch(() => {});
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'fav') { S.meta.fav[id] = !S.meta.fav[id]; if (!S.meta.fav[id]) delete S.meta.fav[id]; saveMeta(); draw(); render(); }
    else if (act === 'tag') { const g = a.dataset.g; const arr = S.meta.tags[id] || []; S.meta.tags[id] = arr.includes(g) ? arr.filter(x => x !== g) : arr.concat(g); if (!S.meta.tags[id].length) delete S.meta.tags[id]; saveMeta(); draw(); render(); }
    else if (act === 'newtag') { const n = await askText(t('gName')); if (n && !S.meta.groups.includes(n)) { S.meta.groups.push(n); S.meta.tags[id] = (S.meta.tags[id] || []).concat(n); saveMeta(); draw(); render(); } }
    else if (act === 'addfield') { const k = await askText(t('fieldName')); if (!k) return; const v = await askText(t('fieldValue')); if (v == null) return; S.meta.custom[id] = Object.assign({}, S.meta.custom[id], { [k]: v }); saveMeta(); draw(); }
    else if (act === 'delfield') { delete S.meta.custom[id][a.dataset.k]; if (!Object.keys(S.meta.custom[id]).length) delete S.meta.custom[id]; saveMeta(); draw(); }
    else if (act === 'edit') { closeSheet(el); openEditor(id); }
    else if (act === 'share') { try { const f = el._full || await Backend.get(id, true); await saveFile((c._name || 'contact').replace(/[^\p{L}\p{N}]+/gu, '_') + '.vcf', 'text/vcard', MC.toVcf(f, { photo: true })); } catch (er) { toast(String(er && er.message || er)); } }
    else if (act === 'del') { if (await confirmSheet(t('confirmDel', c._name || t('noName')), t('del'))) { closeSheet(el); await performOps([{ oldIds: [id], input: null }], 'Suppression : ' + c._name); } }
  });
}

/* ---------- Création / modification d'un contact ---------- */
function phoneRow(p) {
  const types = ['mobile', 'home', 'work', 'main', 'other'];
  const ty = types.includes(p.type) ? p.type : (p.type ? p.type : 'mobile');
  const opts = (types.includes(ty) ? types : types.concat(ty)).map(x => '<option value="' + x + '"' + (x === ty ? ' selected' : '') + '>' + esc(tyLabel(x)) + '</option>').join('');
  return '<div class="erow"><select class="pty">' + opts + '</select><input class="pnum" type="tel" inputmode="tel" value="' + esc(p.number || '') + '"><button type="button" class="x" data-a="rm">×</button></div>';
}
function emailRow(e) { return '<div class="erow"><input class="eadr" type="email" value="' + esc(e.address || '') + '"><button type="button" class="x" data-a="rm">×</button></div>'; }
async function openEditor(id) {
  let c;
  try { c = id ? await Backend.get(id, true) : { name: {}, phones: [], emails: [], postalAddresses: [], urls: [] }; } catch (e) { toast(String(e.message || e)); return; }
  const n = c.name || {}, o = c.organization || {}, b = c.birthday || {}, a0 = (c.postalAddresses || [])[0] || {};
  const onlyDisp = !n.given && !n.family && !n.middle;
  const given = n.given || (onlyDisp && n.display && n.display !== o.company ? n.display : '');
  const el = openSheet('<h2>' + esc(id ? t('editContact') : t('newContact')) + '</h2><form id="ef">' +
    '<div class="row2"><label>' + esc(t('given')) + '<input id="eg" value="' + esc(given) + '"></label><label>' + esc(t('family')) + '<input id="ef2" value="' + esc(n.family || '') + '"></label></div>' +
    '<div class="row2"><label>' + esc(t('company')) + '<input id="eo" value="' + esc(o.company || '') + '"></label><label>' + esc(t('jobTitle')) + '<input id="ej" value="' + esc(o.jobTitle || '') + '"></label></div>' +
    '<div class="lbl">' + esc(t('phones')) + '</div><div id="phr">' + (c.phones && c.phones.length ? c.phones : [{}]).map(phoneRow).join('') + '</div><button type="button" class="chip" data-a="addph">' + esc(t('addPhone')) + '</button>' +
    '<div class="lbl">' + esc(t('emails')) + '</div><div id="emr">' + (c.emails && c.emails.length ? c.emails : []).map(emailRow).join('') + '</div><button type="button" class="chip" data-a="addem">' + esc(t('addEmail')) + '</button>' +
    '<div class="lbl">' + esc(t('addresses')) + '</div><label>' + esc(t('street')) + '<input id="as" value="' + esc(a0.street || '') + '"></label>' +
    '<div class="row2"><label>' + esc(t('city')) + '<input id="ac" value="' + esc(a0.city || '') + '"></label><label>' + esc(t('postcode')) + '<input id="ap" value="' + esc(a0.postcode || '') + '"></label></div>' +
    '<label>' + esc(t('country')) + '<input id="ay" value="' + esc(a0.country || '') + '"></label>' +
    '<div class="lbl">' + esc(t('birthday')) + '</div><div class="row3"><input id="bd" type="number" min="1" max="31" placeholder="' + esc(t('day')) + '" value="' + esc(b.day || '') + '"><input id="bm" type="number" min="1" max="12" placeholder="' + esc(t('month')) + '" value="' + esc(b.month || '') + '"><input id="by" type="number" min="1900" max="2100" placeholder="' + esc(t('year')) + '" value="' + esc(b.year || '') + '"></div>' +
    '<label>' + esc(t('note')) + '<textarea id="en" rows="2">' + esc(c.note || '') + '</textarea></label>' +
    '<div class="actions"><button type="button" class="btn sec" data-a="cancel">' + esc(t('cancel')) + '</button><button type="submit" class="btn">' + esc(t('save')) + '</button></div></form>', 'big');
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'rm') a.parentElement.remove();
    else if (a.dataset.a === 'addph') $('#phr', el).insertAdjacentHTML('beforeend', phoneRow({}));
    else if (a.dataset.a === 'addem') $('#emr', el).insertAdjacentHTML('beforeend', emailRow({}));
    else if (a.dataset.a === 'cancel') closeSheet(el);
  });
  $('#ef', el).addEventListener('submit', async e => {
    e.preventDefault();
    const v = i => $(i, el).value.trim();
    const phones = $$('#phr .erow', el).map(r => ({ type: $('.pty', r).value, label: null, isPrimary: false, number: $('.pnum', r).value.trim() })).filter(p => p.number);
    const emails = $$('#emr .erow', el).map(r => ({ type: 'other', label: null, isPrimary: false, address: $('.eadr', r).value.trim() })).filter(x => x.address);
    if (!v('#eg') && !v('#ef2') && !v('#eo') && !phones.length && !emails.length) { toast(t('nameRequired')); return; }
    const old = c.phones || [];
    phones.forEach((p, i) => { const m = old.find(x => x.number === p.number); if (m) { p.label = m.label || null; p.isPrimary = !!m.isPrimary; if (m.type !== 'custom') p.type = p.type; else { p.type = 'custom'; } } });
    const oldEm = c.emails || [];
    emails.forEach(x => { const m = oldEm.find(y => y.address === x.address); if (m) { x.type = m.type; x.label = m.label || null; x.isPrimary = !!m.isPrimary; } });
    const addr = { type: a0.type || 'home', label: a0.label || null, isPrimary: !!a0.isPrimary, street: v('#as') || null, neighborhood: a0.neighborhood || null, city: v('#ac') || null, region: a0.region || null, postcode: v('#ap') || null, country: v('#ay') || null };
    const rest = (c.postalAddresses || []).slice(1);
    const nc = Object.assign({}, c, {
      name: { given: v('#eg') || null, middle: n.middle || null, family: v('#ef2') || null, prefix: n.prefix || null, suffix: n.suffix || null, display: '' },
      organization: { company: v('#eo') || null, jobTitle: v('#ej') || null, department: o.department || null },
      birthday: (+v('#bd') && +v('#bm')) ? { day: +v('#bd'), month: +v('#bm'), year: +v('#by') || undefined } : null,
      note: v('#en') || null, phones, emails, postalAddresses: [addr].concat(rest)
    });
    const input = MC.toInput(nc);
    closeSheet(el);
    await performOps([{ oldIds: id ? [id] : [], input }], (id ? 'Modification : ' : 'Création : ') + (v('#eg') + ' ' + v('#ef2')).trim(), { warn: !!id });
  });
}

/* ---------- Moteur de modification : sauvegarde d'abord, création puis suppression ---------- */
function remapMeta(oldIds, newId) {
  const m = S.meta;
  const fav = oldIds.some(i => m.fav[i]);
  const tags = new Set(); oldIds.forEach(i => (m.tags[i] || []).forEach(x => tags.add(x)));
  const custom = {}; oldIds.forEach(i => Object.assign(custom, m.custom[i] || {}));
  oldIds.forEach(i => { delete m.fav[i]; delete m.tags[i]; delete m.custom[i]; });
  if (newId) { if (fav) m.fav[newId] = true; if (tags.size) m.tags[newId] = [...tags]; if (Object.keys(custom).length) m.custom[newId] = custom; }
  saveMeta();
}
async function runOps(ops, label, onProgress, isCancelled) {
  const snap = { id: Date.now(), date: new Date().toISOString(), label, entries: [] };
  let done = 0;
  for (let i = 0; i < ops.length; i++) {
    if (isCancelled && isCancelled()) break;
    const op = ops[i];
    const olds = [];
    for (const id of op.oldIds) olds.push(await Backend.get(id, true));
    const input = op.build ? op.build(olds) : op.input;
    if (input === SKIP) { onProgress && onProgress(i + 1, ops.length); continue; }
    const entry = { olds, newId: null };
    snap.entries.push(entry);
    await Snaps.put(snap);                       /* sauvegarde écrite AVANT toute modification */
    let newId = null;
    if (input) {
      newId = await Backend.create(input);
      if (!newId) throw new Error('création impossible');
      entry.newId = newId; await Snaps.put(snap);
    }
    for (const id of op.oldIds) await Backend.remove(id);
    remapMeta(op.oldIds, newId);
    done++; onProgress && onProgress(i + 1, ops.length);
  }
  await Snaps.prune(10);
  return done;
}
async function performOps(ops, label, opt) {
  opt = opt || {};
  if (!ops.length) { toast(t('opNothing')); return 0; }
  if (opt.warn !== false && !(await warnModify())) return 0;
  const pg = progressSheet(); let n = 0, err = null;
  try { n = await runOps(ops, label, (i, tot) => pg.set(i, tot), () => pg.cancelled); } catch (e) { err = e; }
  pg.close();
  await loadContacts();
  if (err) alertSheet(t('opStopped') + (err && err.message || err)); else toast(t('opDone', n));
  return n;
}
async function restoreSnapshot(s) {
  const pg = progressSheet(); let k = 0, err = null;
  try {
    for (const en of s.entries) {
      const created = [];
      for (const old of en.olds) created.push(await Backend.create(MC.toInput(old)));
      if (en.newId) { try { await Backend.remove(en.newId); } catch (e) { /* déjà supprimé */ } }
      const mv = S.meta; const nid = en.newId;
      if (nid && created.length) { created.forEach(cid => { if (mv.fav[nid]) mv.fav[cid] = true; if (mv.tags[nid]) mv.tags[cid] = mv.tags[nid].slice(); if (mv.custom[nid]) mv.custom[cid] = Object.assign({}, mv.custom[nid]); }); delete mv.fav[nid]; delete mv.tags[nid]; delete mv.custom[nid]; }
      k++; pg.set(k, s.entries.length);
    }
    saveMeta();
  } catch (e) { err = e; }
  pg.close(); await loadContacts();
  if (err) alertSheet(t('opStopped') + (err.message || err)); else toast(t('restored'));
}

/* ---------- Nettoyage ---------- */
function analyze() {
  if (S.an) return S.an;
  const a = { dup: MC.findDuplicates(S.contacts), inv: [], sh: [], np: [], nn: [], nnum: [] };
  S.contacts.forEach(c => {
    const ps = c.phones || [];
    if (!ps.length) a.np.push(c);
    if (!MC.hasRealName(c)) a.nn.push(c);
    if (MC.nameIsNumber(c)) a.nnum.push(c);
    let inv = false, sh = false;
    ps.forEach(p => { const r = MC.normPhone(p.number).status; if (r === 'invalid') inv = true; if (r === 'short') sh = true; });
    if (inv) a.inv.push(c); if (sh) a.sh.push(c);
  });
  return (S.an = a);
}
function renderClean() {
  const a = analyze(), safe = a.dup.filter(g => g.safe).length;
  const fixCount = S.contacts.filter(c => MC.cleanContact(c, S.fix).changed).length;
  const opt = (k, key) => '<label class="chk"><input type="checkbox" data-fix="' + k + '"' + (S.fix[k] ? ' checked' : '') + '><span>' + esc(t(key)) + '</span></label>';
  let h = '<div class="card"><h3>' + esc(t('cDup')) + '</h3><p>' + esc(a.dup.length ? t('cDupN', a.dup.length, safe) : t('cDupNone')) + '</p>' +
    (a.dup.length ? '<p class="hint">' + esc(t('cSafeHint')) + '</p><div class="actions wrap"><button class="btn sec" data-act="dupreview">' + esc(t('cReview')) + '</button>' + (safe ? '<button class="btn" data-act="mergesafe">' + esc(t('cMergeSafe')) + ' (' + safe + ')</button>' : '') + '</div>' : '') + '</div>';
  h += '<div class="card"><h3>' + esc(t('cFix')) + '</h3>' + opt('phones', 'fxPhones') + opt('names', 'fxNames') + opt('caps', 'fxCaps') + opt('emails', 'fxEmails') + opt('dedupe', 'fxDedupe') +
    '<p class="hint">' + esc(t('cPreview', fixCount)) + '</p><div class="actions"><button class="btn" data-act="runfix"' + (fixCount ? '' : ' disabled') + '>' + esc(t('cRun')) + '</button></div></div>';
  const row = (k, key, list) => '<div class="line"><span class="val">' + esc(t(key)) + '</span><span class="num">' + list.length + '</span><span class="acts">' + (list.length ? '<a data-act="viewlist" data-k="' + k + '">' + esc(t('pView')) + '</a>' : '') + '</span></div>';
  h += '<div class="card"><h3>' + esc(t('cProblems')) + '</h3>' + row('inv', 'pInvalid', a.inv) + row('sh', 'pShort', a.sh) + row('np', 'pNoPhone', a.np) + row('nn', 'pNoName', a.nn) + row('nnum', 'pNameNum', a.nnum) + '</div>';
  $('#view').innerHTML = h;
}
function listSheet(title, list) {
  const el = openSheet('<h2>' + esc(title) + '</h2><div class="slist">' + list.slice(0, 300).map(rowHTML).join('') + '</div><div class="actions"><button class="btn" data-x="1">' + esc(t('close')) + '</button></div>', 'big');
  el.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) { closeSheet(el); return; }
    const r = e.target.closest('.crow'); if (r) { closeSheet(el); openDetail(r.dataset.id); }
  });
}
function mergeOp(g, primaryId) {
  return { oldIds: g.members.map(m => m.contactId), build: olds => { const pi = olds.findIndex(o => o.contactId === primaryId); return MC.toInput(MC.mergeContacts(olds, pi < 0 ? undefined : pi)); } };
}
function dupSheet() {
  const a = analyze(); const groups = a.dup;
  const draw = () => {
    const part = groups.slice(0, S.dupLimit);
    let h = '<h2>' + esc(t('cDup')) + ' (' + groups.length + ')</h2><div class="slist">';
    part.forEach((g, gi) => {
      const best = MC.bestPrimary(g.members);
      h += '<div class="card dg" data-gi="' + gi + '"><div class="dgh"><b>' + esc(t('reason_' + g.reason)) + '</b> · ' + esc(g.safe ? t('safe') : t('check')) + '</div>';
      g.members.forEach((m, mi) => {
        h += '<label class="mrow"><input type="radio" name="p' + gi + '" value="' + esc(m.contactId) + '"' + (mi === best ? ' checked' : '') + '><span><b>' + esc(m._name || t('noName')) + '</b><small>' + esc((m.phones || []).map(p => p.number).join(' · ')) + '</small></span></label>';
      });
      h += '<div class="actions"><button class="btn sec" data-a="ign">' + esc(t('ignore')) + '</button><button class="btn" data-a="mrg">' + esc(t('mergeGroup')) + '</button></div></div>';
    });
    if (groups.length > S.dupLimit) h += '<div class="actions c"><button class="btn sec" data-a="more">' + esc(t('more')) + '</button></div>';
    h += '</div><div class="actions"><button class="btn" data-x="1">' + esc(t('close')) + '</button></div>';
    $('.sheet', el).innerHTML = h;
  };
  const el = openSheet('', 'big'); draw();
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) { closeSheet(el); return; }
    const a2 = e.target.closest('[data-a]'); if (!a2) return;
    if (a2.dataset.a === 'more') { S.dupLimit += 40; draw(); return; }
    const card = a2.closest('.dg'); const g = groups[+card.dataset.gi];
    if (a2.dataset.a === 'ign') { groups.splice(+card.dataset.gi, 1); draw(); return; }
    if (a2.dataset.a === 'mrg') {
      const pid = $('input:checked', card).value;
      closeSheet(el);
      const n = await performOps([mergeOp(g, pid)], 'Fusion : ' + (g.members[0]._name || ''));
      if (n) { S.an = null; dupSheet(); }
    }
  });
}
async function mergeSafe() {
  const a = analyze(); const ops = a.dup.filter(g => g.safe).map(g => mergeOp(g, g.members[MC.bestPrimary(g.members)].contactId));
  await performOps(ops, 'Fusion des doublons sûrs (' + ops.length + ')');
}
async function runFix() {
  const ops = S.contacts.filter(c => MC.cleanContact(c, S.fix).changed).map(c => ({ oldIds: [c.contactId], build: olds => { const r = MC.cleanContact(olds[0], S.fix); return r.changed ? r.input : SKIP; } }));
  await performOps(ops, 'Corrections automatiques (' + ops.length + ')');
}

/* ---------- Groupes ---------- */
function renderGroups() {
  if (S.group) { renderList(); $('#view').insertAdjacentHTML('afterbegin', '<div class="actions wrap"><button class="btn sec" data-act="gback">' + esc(t('back')) + '</button><b class="gt">' + esc(S.group) + '</b><button class="btn sec" data-act="gren">' + esc(t('gRename')) + '</button><button class="btn sec" data-act="gdel">' + esc(t('gDelete')) + '</button></div>'); return; }
  const cnt = {}; Object.values(S.meta.tags).forEach(a => a.forEach(g => { cnt[g] = (cnt[g] || 0) + 1; }));
  let h = '<div class="actions"><button class="btn" data-act="gnew">' + esc(t('gNew')) + '</button></div>';
  if (!S.meta.groups.length) h += '<div class="empty">' + esc(t('gNone')) + '</div>';
  S.meta.groups.forEach(g => { h += '<div class="crow grow" data-g="' + esc(g) + '"><div class="av">👥</div><div class="mid"><b>' + esc(g) + '</b><small>' + esc(t('nContacts', cnt[g] || 0)) + '</small></div></div>'; });
  $('#view').innerHTML = h;
}

/* ---------- Anniversaires ---------- */
function upcomingBirthdays() {
  const now = new Date();
  return S.contacts.map(c => ({ c, nb: MC.nextBirthday(c.birthday, now) })).filter(x => x.nb).sort((a, b) => a.nb.date - b.nb.date);
}
function renderBday() {
  const l = upcomingBirthdays();
  if (!l.length) { $('#view').innerHTML = '<div class="empty">' + esc(t('bNone')) + '</div>'; return; }
  $('#view').innerHTML = l.map(({ c, nb }) => '<div class="crow" data-id="' + esc(c.contactId) + '"><div class="av">🎂</div><div class="mid"><b>' + esc(c._name) + '</b><small>' + String(nb.date.getDate()).padStart(2, '0') + '/' + String(nb.date.getMonth() + 1).padStart(2, '0') + (nb.age ? ' · ' + esc(t('bAge', nb.age)) : '') + '</small></div><span class="dl">' + esc(nb.days === 0 ? t('bToday') : nb.days === 1 ? t('bTomorrow') : t('bIn', nb.days)) + '</span></div>').join('');
}
async function scheduleBirthdays() {
  const LN = PL().LocalNotifications;
  if (!isNative() || !LN) return false;
  try {
    const pend = await LN.getPending();
    const old = (pend.notifications || []).filter(n => n.id >= 5000 && n.id < 6000).map(n => ({ id: n.id }));
    if (old.length) await LN.cancel({ notifications: old });
    if (!S.settings.bday) return true;
    const p = await LN.requestPermissions();
    if (p.display !== 'granted') return false;
    const list = upcomingBirthdays().filter(x => x.nb.days <= 366).slice(0, 200);
    if (!list.length) return true;
    await LN.schedule({ notifications: list.map((x, i) => ({ id: 5000 + i, title: '🎂 ' + x.c._name, body: x.nb.age ? t('bToday') + ' · ' + t('bAge', x.nb.age) : t('bToday'), schedule: { at: x.nb.date, allowWhileIdle: true } })) });
    return true;
  } catch (e) { return false; }
}

/* ---------- Statistiques ---------- */
function renderStats() {
  const c = S.contacts, a = analyze();
  const tiles = [['stTotal', c.length], ['stPhone', c.filter(x => (x.phones || []).length).length], ['stNoPhone', a.np.length], ['stEmail', c.filter(x => (x.emails || []).length).length],
    ['stBday', c.filter(x => x.birthday && x.birthday.day).length], ['stDup', a.dup.length], ['stInv', a.inv.length], ['stFav', Object.keys(S.meta.fav).length], ['stGroups', S.meta.groups.length]];
  $('#view').innerHTML = '<div class="tiles">' + tiles.map(([k, v]) => '<div class="tile"><b>' + v + '</b><span>' + esc(t(k)) + '</span></div>').join('') + '</div>';
}

/* ---------- Urgences ---------- */
const dispNum = n => n.length === 10 && n[0] === '0' ? n.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5').replace(/^0801 ?/, '08 01 ') : n;
function fmtNum(n) { if (/^0801000180$/.test(n)) return '08 01 00 01 80'; if (/^0\d{9}$/.test(n)) return n.replace(/(\d{2})(?=\d)/g, '$1 ').trim(); return n; }
function renderSos() {
  const ar = S.settings.lang === 'ar';
  let h = '<h3 class="stitle">' + esc(t('sosTitle')) + '</h3>';
  URGENCES.forEach(u => {
    h += '<div class="card sos"><div class="sn"><b>' + esc(ar ? u.ar : u.fr) + '</b>' + ((ar ? u.note_ar : u.note_fr) ? '<small>' + esc(ar ? u.note_ar : u.note_fr) + '</small>' : '') + '</div><div class="sb">' + u.numbers.map(n => '<a class="callbtn" href="tel:' + esc(n) + '">' + esc(fmtNum(n)) + '</a>').join('') + '</div></div>';
  });
  h += '<p class="hint">' + esc(t('sosCheck', URGENCES_DATE)) + '</p>';
  h += '<h3 class="stitle">' + esc(t('sosMine')) + '</h3><p class="hint">' + esc(t('sosMineHint')) + '</p>';
  S.useful.forEach((u, i) => {
    h += '<div class="card sos"><div class="sn"><b>' + esc(u.label) + '</b><small>' + esc(t('cat_' + u.cat)) + '</small></div><div class="sb"><a class="callbtn" href="tel:' + esc(MC.dialNumber(u.number)) + '">' + esc(u.number) + '</a><button class="x" data-act="uedit" data-i="' + i + '">✎</button><button class="x" data-act="udel" data-i="' + i + '">×</button></div></div>';
  });
  h += '<div class="actions"><button class="btn" data-act="uadd">' + esc(t('sosAdd')) + '</button></div>';
  $('#view').innerHTML = h;
}
function usefulSheet(i) {
  const u = i == null ? { label: '', number: '', cat: 'hosp' } : S.useful[i];
  const cats = ['hosp', 'doc', 'pharm', 'other'];
  const el = openSheet('<label>' + esc(t('uLabel')) + '<input id="ul" value="' + esc(u.label) + '"></label><label>' + esc(t('uNumber')) + '<input id="un" type="tel" inputmode="tel" value="' + esc(u.number) + '"></label><label>' + esc(t('uCat')) + '<select id="uc">' + cats.map(c => '<option value="' + c + '"' + (c === u.cat ? ' selected' : '') + '>' + esc(t('cat_' + c)) + '</option>').join('') + '</select></label><div class="actions"><button class="btn sec" data-x="0">' + esc(t('cancel')) + '</button><button class="btn" data-x="1">' + esc(t('save')) + '</button></div>');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === '1') {
      const label = $('#ul', el).value.trim(), number = $('#un', el).value.trim();
      if (!label || !number) return;
      const rec = { label, number, cat: $('#uc', el).value };
      if (i == null) S.useful.push(rec); else S.useful[i] = rec;
      lsSet('mc_useful', S.useful); render();
    }
    closeSheet(el);
  });
}

/* ---------- Fichiers : enregistrement, partage, lecture ---------- */
async function saveFile(name, mime, text) {
  const P = PL();
  if (isNative() && P.Filesystem && P.Share) {
    const r = await P.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    await P.Share.share({ title: name, files: [r.uri], dialogTitle: name });
    return;
  }
  const b = new Blob([text], { type: mime + ';charset=utf-8' }), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
function pickFile(accept) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none'; document.body.appendChild(i);
    i.onchange = () => { const f = i.files[0]; i.remove(); if (!f) return res(null); const r = new FileReader(); r.onload = () => res({ name: f.name, text: String(r.result) }); r.onerror = () => res(null); r.readAsText(f); };
    i.click();
  });
}
async function doExport(kind, photos) {
  let list = S.contacts; const stamp = new Date().toISOString().slice(0, 10);
  try {
    if (kind === 'vcf' && photos) { toast(t('loadingPhotos'), 60000); list = await Backend.listWithImages(); }
    const tagsOf = c => S.meta.tags[c.contactId] || [];
    if (kind === 'vcf') await saveFile('contacts-' + stamp + '.vcf', 'text/vcard', MC.toVcfAll(list, { photo: photos }));
    else if (kind === 'csv') await saveFile('contacts-' + stamp + '.csv', 'text/csv', MC.toCsv(list, tagsOf));
    else if (kind === 'txt') await saveFile('contacts-' + stamp + '.txt', 'text/plain', MC.toTxt(list));
    else if (kind === 'json') await saveFile('contacts-' + stamp + '.json', 'application/json', JSON.stringify({ app: 'MAHFOUD-contacts', version: 1, date: new Date().toISOString(), contacts: list.map(c => { const x = Object.assign({}, c); Object.keys(x).filter(k => k[0] === '_').forEach(k => delete x[k]); return x; }), meta: S.meta }, null, 1));
    toast(t('exported'));
  } catch (e) { toast(String(e && e.message || e)); }
}
function classifyImport(list) {
  const pk = new Set(), nk = new Set();
  S.contacts.forEach(c => { (c.phones || []).forEach(p => { const k = MC.phoneKey(p.number); if (k) pk.add(k); }); const n = MC.nameKey(c); if (n) nk.add(n); });
  const fresh = [], dup = [];
  list.forEach(c => {
    const ks = (c.phones || []).map(p => MC.phoneKey(p.number)).filter(Boolean);
    const isDup = ks.some(k => pk.has(k)) || (!ks.length && MC.nameKey(c) && nk.has(MC.nameKey(c)));
    (isDup ? dup : fresh).push(c);
  });
  return { fresh, dup };
}
async function importFlow() {
  const f = await pickFile('.vcf,.json,text/vcard,text/x-vcard,application/json,text/plain'); if (!f) return;
  let list;
  try {
    if (/\.json$/i.test(f.name) || f.text.trim().startsWith('{')) { const j = JSON.parse(f.text); list = j.contacts || []; } else list = MC.parseVcf(f.text);
  } catch (e) { toast(t('impBad')); return; }
  if (!list.length) { toast(t('impNothing')); return; }
  const { fresh, dup } = classifyImport(list);
  const el = openSheet('<h2>' + esc(t('impTitle')) + '</h2><p class="msg">' + esc(t('impNew', fresh.length)) + '<br>' + esc(t('impDup', dup.length)) + '</p><div class="actions wrap"><button class="btn sec" data-x="0">' + esc(t('cancel')) + '</button>' + (dup.length ? '<button class="btn sec" data-x="all">' + esc(t('impAllBtn')) + ' (' + list.length + ')</button>' : '') + '<button class="btn" data-x="new"' + (fresh.length ? '' : ' disabled') + '>' + esc(t('impNewBtn')) + ' (' + fresh.length + ')</button></div>');
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-x]'); if (!b || b.disabled) return;
    closeSheet(el);
    const sel = b.dataset.x === 'all' ? list : b.dataset.x === 'new' ? fresh : null; if (!sel) return;
    await performOps(sel.map(c => ({ oldIds: [], input: MC.toInput(c) })), 'Import (' + sel.length + ')', { warn: false });
  });
}

/* ---------- Code PIN ---------- */
let pinBuf = '', pinFails = 0, pinBlockedUntil = 0;
function buildKeypad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  $('#keypad').innerHTML = keys.map(k => k === '' ? '<span></span>' : '<button type="button" data-k="' + k + '">' + k + '</button>').join('');
}
function drawDots() { const n = (S.settings.pin && S.settings.pin.len) || 4; $('#dots').innerHTML = Array.from({ length: n }, (_, i) => '<i class="' + (i < pinBuf.length ? 'f' : '') + '"></i>').join(''); }
function showLock() {
  if (!S.settings.pin) return;
  pinBuf = ''; $('#lockmsg').textContent = t('pinEnter'); drawDots(); $('#lock').hidden = false;
}
async function lockKey(k) {
  const now = Date.now();
  if (now < pinBlockedUntil) { $('#lockmsg').textContent = t('pinWait', Math.ceil((pinBlockedUntil - now) / 1000)); return; }
  if (k === '⌫') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < S.settings.pin.len) pinBuf += k;
  drawDots();
  if (pinBuf.length === S.settings.pin.len) {
    const h = await MC.pinHash(pinBuf, S.settings.pin.salt);
    if (h === S.settings.pin.hash) { pinFails = 0; $('#lock').hidden = true; pinBuf = ''; }
    else {
      pinFails++; pinBuf = ''; drawDots();
      if (pinFails >= 5) { pinBlockedUntil = Date.now() + 30000; pinFails = 0; $('#lockmsg').textContent = t('pinWait', 30); } else $('#lockmsg').textContent = t('pinWrong');
    }
  }
}
async function setPinFlow() {
  const p1 = await askText(t('pinChoose'), '', 'password'); if (p1 == null) return;
  if (!/^\d{4,6}$/.test(p1)) { toast(t('pinBad')); return; }
  const p2 = await askText(t('pinConfirm'), '', 'password'); if (p2 == null) return;
  if (p1 !== p2) { toast(t('pinMismatch')); return; }
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  S.settings.pin = { salt, len: p1.length, hash: await MC.pinHash(p1, salt) }; saveSettings();
}
async function checkCurrentPin() {
  if (!S.settings.pin) return true;
  const p = await askText(t('pinCurrent'), '', 'password'); if (p == null) return false;
  if ((await MC.pinHash(p, S.settings.pin.salt)) === S.settings.pin.hash) return true;
  toast(t('pinWrong')); return false;
}

/* ---------- Réglages ---------- */
async function openSettings() {
  const snaps = await Snaps.all();
  const draw = () => {
    const pin = !!S.settings.pin;
    let h = '<h2>' + esc(t('settings')) + '</h2>';
    h += '<div class="lbl">' + esc(t('sLang')) + '</div><div class="chips"><button class="chip' + (S.settings.lang === 'fr' ? ' on' : '') + '" data-a="lang" data-v="fr">Français</button><button class="chip' + (S.settings.lang === 'ar' ? ' on' : '') + '" data-a="lang" data-v="ar">العربية</button></div>';
    h += '<div class="lbl">' + esc(t('sSort')) + '</div><div class="chips"><button class="chip' + (S.settings.sort === 'name' ? ' on' : '') + '" data-a="sort" data-v="name">' + esc(t('sortName')) + '</button><button class="chip' + (S.settings.sort === 'org' ? ' on' : '') + '" data-a="sort" data-v="org">' + esc(t('sortOrg')) + '</button></div>';
    h += '<div class="lbl">' + esc(t('sPin')) + ' — ' + esc(pin ? t('pinOn') : t('pinOff')) + '</div><div class="chips">' + (pin ? '<button class="chip" data-a="pinchg">' + esc(t('changePin')) + '</button><button class="chip" data-a="pinoff">' + esc(t('disablePin')) + '</button>' : '<button class="chip" data-a="pinon">' + esc(t('setPin')) + '</button>') + '</div><p class="hint">' + esc(t('pinNote')) + '</p>';
    h += '<label class="chk"><input type="checkbox" data-a="bday"' + (S.settings.bday ? ' checked' : '') + '><span>' + esc(t('sBday')) + '</span></label>';
    h += '<div class="lbl">' + esc(t('sExport')) + '</div><label class="chk"><input type="checkbox" id="xph"><span>' + esc(t('expPhotos')) + '</span></label><div class="chips"><button class="chip" data-a="exp" data-v="vcf">' + esc(t('expVcf')) + '</button><button class="chip" data-a="exp" data-v="csv">' + esc(t('expCsv')) + '</button><button class="chip" data-a="exp" data-v="txt">' + esc(t('expTxt')) + '</button><button class="chip" data-a="exp" data-v="json">' + esc(t('expJson')) + '</button></div>';
    h += '<div class="actions"><button class="btn sec full" data-a="imp">' + esc(t('sImport')) + '</button></div>';
    h += '<div class="lbl">' + esc(t('sSnaps')) + '</div>' + (snaps.length ? snaps.map(s => '<div class="line"><span class="val">' + esc(new Date(s.date).toLocaleString(S.settings.lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-FR')) + '<br><small>' + esc(s.label) + ' · ' + s.entries.length + '</small></span><span class="acts"><a data-a="restore" data-id="' + s.id + '">' + esc(t('restore')) + '</a></span></div>').join('') : '<p class="hint">' + esc(t('noSnaps')) + '</p>');
    h += '<div class="actions"><button class="btn" data-a="close">' + esc(t('close')) + '</button></div>';
    $('.sheet', el).innerHTML = h;
  };
  const el = openSheet('', 'big'); draw();
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'close') closeSheet(el);
    else if (act === 'lang') { S.settings.lang = a.dataset.v; saveSettings(); applyLang(); draw(); }
    else if (act === 'sort') { S.settings.sort = a.dataset.v; saveSettings(); render(); draw(); }
    else if (act === 'pinon') { await setPinFlow(); draw(); }
    else if (act === 'pinchg') { if (await checkCurrentPin()) { await setPinFlow(); draw(); } }
    else if (act === 'pinoff') { if (await checkCurrentPin()) { S.settings.pin = null; saveSettings(); draw(); } }
    else if (act === 'bday') { S.settings.bday = a.checked; saveSettings(); const ok = await scheduleBirthdays(); if (a.checked) toast(isNative() ? (ok ? t('bdayOk') : t('bdayNo')) : t('bdayOk')); }
    else if (act === 'exp') doExport(a.dataset.v, $('#xph', el).checked);
    else if (act === 'imp') { closeSheet(el); importFlow(); }
    else if (act === 'restore') { const s = snaps.find(x => String(x.id) === a.dataset.id); if (s && await confirmSheet(t('restoreConfirm'), t('restore'))) { closeSheet(el); await restoreSnapshot(s); } }
  });
}

/* ---------- Langue et en-tête ---------- */
function applyLang() {
  document.documentElement.lang = S.settings.lang;
  document.documentElement.dir = S.settings.lang === 'ar' ? 'rtl' : 'ltr';
  $('#tabs').innerHTML = TABS.map(k => '<button data-tab="' + k + '"' + (k === 'sos' ? ' class="sosb"' : '') + '>' + esc(t(TAB_KEYS[k])) + '</button>').join('');
  $('#search').placeholder = t('search');
  $('#btnLang').textContent = S.settings.lang === 'ar' ? 'FR' : 'ع';
  { const ls = $('#logoSub'); if (ls) ls.textContent = '☎ ' + t('tagline'); }
  $('#loadtxt').textContent = t('loading');
  $('#lockTitle').textContent = "MAHFOUD's Contacts";
  if (!$('#lock').hidden) $('#lockmsg').textContent = t('pinEnter');
  render();
}

/* ---------- Événements ---------- */
function bindEvents() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  let dt; $('#search').addEventListener('input', e => { clearTimeout(dt); dt = setTimeout(() => { S.q = e.target.value; render(); }, 120); });
  $('#btnLang').onclick = () => { S.settings.lang = S.settings.lang === 'ar' ? 'fr' : 'ar'; saveSettings(); applyLang(); };
  $('#btnSettings').onclick = openSettings;
  $('#btnSync').onclick = () => loadContacts();
  $('#btnSos').onclick = () => setTab('sos');
  $('#fab').onclick = () => { if (S.tab === 'sos') usefulSheet(null); else openEditor(null); };
  $('#index').addEventListener('click', e => { const a = e.target.closest('[data-l]'); if (!a) return; const s = $$('#view .sec').find(x => x.dataset.sec === a.dataset.l); if (s) s.scrollIntoView({ block: 'start' }); });
  $('#keypad').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) lockKey(b.dataset.k); });
  $('#view').addEventListener('change', e => { const f = e.target.dataset && e.target.dataset.fix; if (f) { S.fix[f] = e.target.checked; renderClean(); } });
  $('#view').addEventListener('click', async e => {
    const row = e.target.closest('.crow');
    if (row && row.classList.contains('grow')) { S.group = row.dataset.g; render(); return; }
    if (row && row.dataset.id) { openDetail(row.dataset.id); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'retryperm') { await Backend.init(); if (Backend.granted) await loadContacts(); else render(); }
    else if (act === 'impvcf') importFlow();
    else if (act === 'dupreview') dupSheet();
    else if (act === 'mergesafe') mergeSafe();
    else if (act === 'runfix') runFix();
    else if (act === 'viewlist') { const k = a.dataset.k; const an = analyze(); listSheet(t({ inv: 'pInvalid', sh: 'pShort', np: 'pNoPhone', nn: 'pNoName', nnum: 'pNameNum' }[k]), an[k]); }
    else if (act === 'gnew') { const n = await askText(t('gName')); if (n && !S.meta.groups.includes(n)) { S.meta.groups.push(n); saveMeta(); render(); } }
    else if (act === 'gback') { S.group = null; render(); }
    else if (act === 'gren') { const n = await askText(t('gName'), S.group); if (n && n !== S.group) { S.meta.groups = S.meta.groups.map(g => g === S.group ? n : g); Object.keys(S.meta.tags).forEach(k => { S.meta.tags[k] = S.meta.tags[k].map(g => g === S.group ? n : g); }); S.group = n; saveMeta(); render(); } }
    else if (act === 'gdel') { if (await confirmSheet(t('gDelete') + ' ?', t('del'))) { const g = S.group; S.meta.groups = S.meta.groups.filter(x => x !== g); Object.keys(S.meta.tags).forEach(k => { S.meta.tags[k] = S.meta.tags[k].filter(x => x !== g); if (!S.meta.tags[k].length) delete S.meta.tags[k]; }); S.group = null; saveMeta(); render(); } }
    else if (act === 'uadd') usefulSheet(null);
    else if (act === 'uedit') usefulSheet(+a.dataset.i);
    else if (act === 'udel') { S.useful.splice(+a.dataset.i, 1); lsSet('mc_useful', S.useful); render(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.hiddenAt = Date.now();
    else if (S.settings.pin && S.hiddenAt && Date.now() - S.hiddenAt > 30000) showLock();
  });
  const AppP = PL().App;
  if (AppP && AppP.addListener) AppP.addListener('backButton', () => {
    if (!$('#lock').hidden) return;
    if (sheetStack.length) { const top = sheetStack[sheetStack.length - 1]; if (!top._lock) closeSheet(top); return; }
    if (S.tab === 'groups' && S.group) { S.group = null; render(); return; }
    if (S.tab !== 'contacts') { setTab('contacts'); return; }
    if (AppP.minimizeApp) AppP.minimizeApp(); else if (AppP.exitApp) AppP.exitApp();
  });
}

async function start() {
  bindEvents(); buildKeypad(); applyLang();
  $('#app').hidden = false;
  if (S.settings.pin) showLock();
  setTimeout(() => { $('#splash').classList.add('out'); setTimeout(() => { const s = $('#splash'); if (s) s.remove(); }, 900); }, 3200);
  await Backend.init();
  await loadContacts();
}
window.__mc = { S, Backend, Snaps, runOps, performOps, openDetail, openEditor, importFlow, setTab, render, restoreSnapshot, scheduleBirthdays, analyze, loadContacts, lockKey, setPinFlow, showLock, usefulSheet, doExport };
start();
})();
