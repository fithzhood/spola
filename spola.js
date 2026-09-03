/* ===== Spola — appunti condivisi fra telefono e PC =====
   Ponte: ntfy.sh (nessun account). Tutto cifrato AES-GCM lato client:
   il server vede solo byte senza senso e non sa nemmeno che tipo di cosa sia.
   Il nome del canale e la chiave nascono dallo stesso seme (il "codice"). */

const VER = ((document.currentScript && document.currentScript.src || '').match(/\?v=\d+/) || [''])[0];
const VERSIONE = (VER.match(/\d+/) || ['dev'])[0];

const SERVER   = 'https://ntfy.sh';
const LS_SEME  = 'spola.seme';
const LS_NASC  = 'spola.nascosti';
const LS_DEV   = 'spola.dispositivo';
const LS_TEMA  = 'spola.tema';
const TEMI = [['notte','Notte'],['ambra','Ambra'],['bosco','Bosco'],['carta','Carta']];
const MAX_CORPO = 3200;          // oltre, il testo viaggia come allegato
const NATIVO = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

let CHIAVE = null, CANALE = null, ES = null, VISTI = new Set(), ELEMENTI = new Map();

const $ = s => document.querySelector(s);
const enc = new TextEncoder(), dec = new TextDecoder();

/* ---------- codice leggibile (base32 senza I L O U) ---------- */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32enc(bytes){
  let bit = 0, val = 0, out = '';
  for (const b of bytes){ val = (val << 8) | b; bit += 8;
    while (bit >= 5){ out += B32[(val >>> (bit - 5)) & 31]; bit -= 5; } }
  if (bit > 0) out += B32[(val << (5 - bit)) & 31];
  return out;
}
function b32dec(str){
  const pul = String(str).toUpperCase().replace(/[^0-9A-Z]/g,'')
    .replace(/O/g,'0').replace(/[IL]/g,'1').replace(/U/g,'V');
  let bit = 0, val = 0; const out = [];
  for (const c of pul){ const i = B32.indexOf(c); if (i < 0) return null;
    val = (val << 5) | i; bit += 5;
    if (bit >= 8){ out.push((val >>> (bit - 8)) & 255); bit -= 8; } }
  return new Uint8Array(out);
}
const gruppi = s => s.replace(/(.{4})/g,'$1 ').trim();

/* ---------- base64url ---------- */
function b64(bytes){ let s=''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function unb64(s){
  const t = String(s).replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- chiave e canale dal seme ---------- */
function unisci(a,b){ const u = new Uint8Array(a.length + b.length); u.set(a); u.set(b, a.length); return u; }
async function deriva(seme){
  const t = new Uint8Array(await crypto.subtle.digest('SHA-256', unisci(seme, enc.encode('spola/canale/v1'))));
  const k = await crypto.subtle.digest('SHA-256', unisci(seme, enc.encode('spola/chiave/v1')));
  CANALE = 'spola-' + b32enc(t.slice(0,13)).toLowerCase();
  CHIAVE = await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function sigilla(bytes){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, CHIAVE, bytes));
  return unisci(iv, ct);
}
async function apri(bytes){
  if (bytes.length < 13) throw new Error('corto');
  return new Uint8Array(await crypto.subtle.decrypt(
    {name:'AES-GCM', iv: bytes.slice(0,12)}, CHIAVE, bytes.slice(12)));
}

/* ---------- identità del dispositivo ---------- */
function mioId(){
  let d = localStorage.getItem(LS_DEV);
  if (!d){ d = b32enc(crypto.getRandomValues(new Uint8Array(5))); localStorage.setItem(LS_DEV, d); }
  return d;
}
const IO = mioId();
const TIPO_DEV = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'telefono' : 'PC';

/* ---------- temi ---------- */
function applicaTema(id){
  if (!TEMI.some(t => t[0] === id)) id = TEMI[0][0];
  document.documentElement.dataset.tema = id;
  localStorage.setItem(LS_TEMA, id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim() || '#12151c';
  document.querySelectorAll('.tema').forEach(b => b.classList.toggle('scelto', b.dataset.tema === id));
}
function costruisciTemi(){
  const c = $('#temi'); if (!c) return;
  c.innerHTML = '';
  for (const [id, nome] of TEMI){
    const b = document.createElement('button');
    b.className = 'tema'; b.dataset.tema = id;
    const pal = document.createElement('span'); pal.className = 'pallini';
    pal.append(document.createElement('i'), document.createElement('i'));
    const et = document.createElement('span'); et.textContent = nome;
    b.append(pal, et);
    b.addEventListener('click', () => applicaTema(id));
    c.append(b);
  }
  applicaTema(localStorage.getItem(LS_TEMA) || TEMI[0][0]);
}

/* ---------- utilità interfaccia ---------- */
let timerBrindisi = null;
function brindisi(txt, ms = 2200){
  const b = $('#brindisi'); b.textContent = txt; b.hidden = false;
  clearTimeout(timerBrindisi); timerBrindisi = setTimeout(() => { b.hidden = true; }, ms);
}
function stato(classe, txt){
  const s = $('#stato'); s.className = 'stato ' + classe; $('#statoTxt').textContent = txt;
}
function quando(ts){
  const d = Math.max(0, Date.now() - ts) / 1000;
  if (d < 45) return 'adesso';
  if (d < 3600) return Math.round(d/60) + ' min fa';
  if (d < 86400) return Math.round(d/3600) + ' h fa';
  return 'ieri';
}
function fraQuanto(unix){
  const d = unix * 1000 - Date.now();
  if (d <= 0) return 'scaduto';
  const m = Math.round(d/60000);
  if (m < 60) return 'scade fra ' + m + ' min';
  return 'scade fra ' + Math.floor(m/60) + ' h';
}
const nascosti = () => { try { return JSON.parse(localStorage.getItem(LS_NASC) || '[]'); } catch { return []; } };
const nascondi = id => { const n = nascosti(); n.push(id); localStorage.setItem(LS_NASC, JSON.stringify(n.slice(-400))); };

/* ================= INVIO ================= */
async function pubblicaTesto(testo){
  const t = testo.trim(); if (!t) return;
  const meta = { v:1, da:IO, dev:TIPO_DEV, tipo:'testo', t: Date.now() };
  const corpo = b64(await sigilla(enc.encode(JSON.stringify({...meta, testo:t}))));
  if (corpo.length <= MAX_CORPO){
    await inviaPost(corpo);
  } else {
    const payload = await sigilla(enc.encode(t));
    await inviaFile(payload, {...meta, tipo:'testolungo', n:t.length});
  }
}
async function inviaPost(corpo){
  const r = await fetch(SERVER + '/' + CANALE, { method:'POST', body: corpo });
  if (!r.ok) throw new Error('ntfy ' + r.status);
}
async function inviaFile(bytes, meta){
  const r = await fetch(SERVER + '/' + CANALE, {
    method:'PUT',
    headers:{ 'Filename':'s.bin', 'X-Message': b64(await sigilla(enc.encode(JSON.stringify(meta)))) },
    body: bytes
  });
  if (!r.ok) throw new Error('ntfy ' + r.status);
}

/* immagini: si comprime solo quando serve, per non rovinare gli screenshot */
async function preparaImmagine(file){
  const gif = /gif/i.test(file.type);
  if (gif || file.size <= 900*1024) return { blob:file, mime:file.type||'image/png' };
  for (const [lato, q] of [[1800,.85],[1400,.8],[1000,.72]]){
    const b = await ridimensiona(file, lato, q);
    if (b && b.size <= 2.2*1024*1024) return { blob:b, mime:'image/jpeg' };
    if (b && lato === 1000) return { blob:b, mime:'image/jpeg' };
  }
  return { blob:file, mime:file.type||'image/png' };
}
async function ridimensiona(file, latoMax, q){
  try{
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, latoMax / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width*s); c.height = Math.round(bmp.height*s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return await new Promise(res => c.toBlob(res, 'image/jpeg', q));
  } catch { return null; }
}
async function pubblicaImmagine(file){
  const { blob, mime } = await preparaImmagine(file);
  if (blob.size > 14*1024*1024) { brindisi('Immagine troppo grande (max 15 MB)'); return; }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await inviaFile(await sigilla(bytes), {
    v:1, da:IO, dev:TIPO_DEV, tipo:'immagine', mime, peso:blob.size, t:Date.now()
  });
}

/* ================= RICEZIONE ================= */
function ascolta(){
  if (ES) ES.close();
  stato('collegando','collego…');
  ES = new EventSource(SERVER + '/' + CANALE + '/sse?since=12h');
  ES.onopen  = () => stato('collegato', 'collegato');
  ES.onerror = () => stato('rotto', 'riprovo…');
  ES.onmessage = async ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (!m || m.event !== 'message') return;
    try { await ricevi(m); } catch (e) { /* non nostro o illeggibile */ }
  };
}
async function ricevi(m){
  if (!m.id || VISTI.has(m.id)) return;
  VISTI.add(m.id);
  if (nascosti().includes(m.id)) return;
  if (!m.message) return;

  const meta = JSON.parse(dec.decode(await apri(unb64(m.message))));   // se non è nostro, qui esplode
  const el = { id:m.id, meta, tempo: (m.time || Date.now()/1000) * 1000,
               scade: (m.attachment && m.attachment.expires) || m.expires, url: m.attachment && m.attachment.url };

  if (meta.tipo === 'testo'){ el.testo = meta.testo; }
  else if (meta.tipo === 'testolungo' || meta.tipo === 'immagine'){
    if (!el.url) return;
    if (el.scade * 1000 < Date.now()){ el.scaduto = true; }
    else {
      const r = await fetch(el.url);
      if (!r.ok){ el.scaduto = true; }
      else {
        const chiaro = await apri(new Uint8Array(await r.arrayBuffer()));
        if (meta.tipo === 'testolungo') el.testo = dec.decode(chiaro);
        else { el.blob = new Blob([chiaro], {type: meta.mime || 'image/jpeg'}); el.src = URL.createObjectURL(el.blob); }
      }
    }
  } else return;

  ELEMENTI.set(m.id, el);
  disegna(el);
}

/* ================= DISEGNO ================= */
function disegna(el){
  $('#vuoto').hidden = true;
  const daTelefono = /telefono/i.test(el.meta.dev || '');
  const li = document.createElement('li');
  li.className = 'item ' + (daTelefono ? 'datel' : 'dapc');
  li.dataset.id = el.id;

  const r1 = document.createElement('div'); r1.className = 'riga1';
  const chi = document.createElement('span'); chi.className = 'chi';
  chi.textContent = daTelefono ? '\u{1F4F1} dal telefono' : '\u{1F4BB} dal PC';
  const qn = document.createElement('span'); qn.className = 'quando'; qn.dataset.t = el.tempo;
  const sc = document.createElement('span'); sc.className = 'scad'; sc.dataset.s = el.scade || 0;
  r1.append(chi, qn, sc);
  if (el.meta.da === IO){ const q = document.createElement('span'); q.className = 'qui'; q.textContent = 'qui'; r1.append(q); }

  const corpo = document.createElement('div'); corpo.className = 'corpo';
  const tasti = document.createElement('div'); tasti.className = 'tasti';

  if (el.scaduto){
    corpo.innerHTML = '<span class="scaduto">Contenuto scaduto sul ponte.</span>';
  } else if (el.src){
    const img = document.createElement('img'); img.src = el.src; img.alt = 'immagine condivisa';
    corpo.classList.add('figura'); corpo.append(img);
    tasti.append(bottone('Copia', 'copia', b => copiaImmagine(el, b)));
    tasti.append(bottone('Salva', '', () => salvaImmagine(el)));
  } else {
    const link = soloLink(el.testo);
    if (link){
      corpo.classList.add('link');
      const a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = el.testo; corpo.append(a);
      tasti.append(bottone('Copia', 'copia', b => copiaTesto(el.testo, b)));
      tasti.append(bottone('Apri', '', () => window.open(link, '_blank', 'noopener')));
    } else {
      corpo.textContent = el.testo;
      tasti.append(bottone('Copia', 'copia', b => copiaTesto(el.testo, b)));
    }
  }
  tasti.append(bottone('✕', 'via', () => { nascondi(el.id); li.remove(); if (!$('#lista').children.length) $('#vuoto').hidden = false; }));

  li.append(r1, corpo, tasti);
  /* in cima il piu' recente: si ordina sull'ora del server, non sull'ordine di
     arrivo — un allegato da scaricare arriva dopo un testo, ma puo' essere piu' vecchio */
  li.dataset.tempo = el.tempo;
  const lista = $('#lista');
  const dopo = [...lista.children].find(x => +x.dataset.tempo < el.tempo);
  if (dopo) lista.insertBefore(li, dopo); else lista.append(li);
  aggiornaTempi();
}
function bottone(txt, cls, fn){
  const b = document.createElement('button');
  b.textContent = txt; if (cls) b.className = cls;
  b.addEventListener('click', () => fn(b));
  return b;
}
function soloLink(t){
  if (!t) return null;
  const s = t.trim();
  if (/\s/.test(s) || s.length > 2000) return null;
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  if (/^www\.\S+\.\S+$/i.test(s)) return 'https://' + s;
  return null;
}
function aggiornaTempi(){
  document.querySelectorAll('.quando').forEach(e => e.textContent = quando(+e.dataset.t));
  document.querySelectorAll('.scad').forEach(e => { const s = +e.dataset.s; e.textContent = s ? '· ' + fraQuanto(s) : ''; });
}
setInterval(aggiornaTempi, 30000);

/* ---------- copia ---------- */
function segnaCopiato(b){
  const vecchio = b.textContent;
  b.textContent = 'Copiato ✓'; b.classList.add('fatto');
  setTimeout(() => { b.textContent = vecchio; b.classList.remove('fatto'); }, 1300);
}
async function copiaTesto(t, b){
  try { await navigator.clipboard.writeText(t); segnaCopiato(b); return; } catch {}
  if (ripiegoCopia(t)) segnaCopiato(b);
  else brindisi('Non riesco a copiare da solo: tieni premuto sul testo e copialo a mano.', 3600);
}
function ripiegoCopia(t){
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.cssText = 'position:fixed;top:0;opacity:0';
  document.body.append(ta); ta.focus(); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}
async function copiaImmagine(el, b){
  try{
    let blob = el.blob;
    if (blob.type !== 'image/png') blob = await inPng(blob);
    await navigator.clipboard.write([ new ClipboardItem({ 'image/png': blob }) ]);
    segnaCopiato(b);
  } catch {
    brindisi('Qui non si copiano immagini: tieni premuto sull’immagine, oppure usa Salva.', 3600);
  }
}
async function inPng(blob){
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return await new Promise(res => c.toBlob(res, 'image/png'));
}
async function salvaImmagine(el){
  const nome = 'spola-' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'') +
               (el.blob.type === 'image/png' ? '.png' : '.jpg');
  if (NATIVO() && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem){
    try{
      const dati = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(el.blob); });
      await window.Capacitor.Plugins.Filesystem.writeFile({ path: nome, data: dati, directory: 'DOCUMENTS' });
      brindisi('Salvata in Documenti: ' + nome); return;
    } catch { /* ripiego sotto */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(el.blob); a.download = nome;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ================= INVII DALL'INTERFACCIA ================= */
async function conAttesa(fn, okTxt){
  const barra = $('#avanzamento');
  barra.hidden = false; $('#avanzamentoBarra').style.width = '35%';
  try{
    await fn();
    $('#avanzamentoBarra').style.width = '100%';
    if (okTxt) brindisi(okTxt);
  } catch (e){
    brindisi('Non inviato: ' + (navigator.onLine ? 'il ponte non risponde' : 'sei senza rete'), 3200);
  } finally {
    setTimeout(() => { barra.hidden = true; $('#avanzamentoBarra').style.width = '0'; }, 350);
  }
}
async function inviaDalCampo(){
  const t = $('#campo').value;
  if (!t.trim()) return;
  await conAttesa(() => pubblicaTesto(t), 'Inviato');
  $('#campo').value = '';
}
async function inviaImmagini(files){
  const lista = [...files].filter(f => /^image\//.test(f.type));
  if (!lista.length) return;
  await conAttesa(async () => { for (const f of lista) await pubblicaImmagine(f); },
                  lista.length > 1 ? lista.length + ' immagini inviate' : 'Immagine inviata');
}

/* ================= COLLEGAMENTO ================= */
async function partiCon(seme, salva){
  if (salva) localStorage.setItem(LS_SEME, b32enc(seme));
  await deriva(seme);
  $('#setup').hidden = true; $('#app').hidden = false;
  VISTI = new Set(); ELEMENTI.clear(); $('#lista').innerHTML = ''; $('#vuoto').hidden = false;
  ascolta();
}
function mostraCodice(){
  const codice = localStorage.getItem(LS_SEME) || '';
  $('#codiceMostrato').textContent = gruppi(codice);
  const url = location.origin + location.pathname + location.search + '#k=' + codice;
  const q = $('#qr'); q.innerHTML = '';
  try { const qr = qrcode(0,'M'); qr.addData(url); qr.make(); q.innerHTML = qr.createImgTag(4, 0); }
  catch { q.hidden = true; }
  $('#setup').hidden = false; $('#app').hidden = true;
  $('#setupScelta').hidden = true; $('#setupInserisci').hidden = true; $('#setupCodice').hidden = false;
}

/* ================= AVVIO ================= */
function avvio(){
  $('#ver1').textContent = VERSIONE; $('#ver2').textContent = VERSIONE;
  const v3 = $('#ver3'); if (v3) v3.textContent = VERSIONE;
  costruisciTemi();

  if (!window.isSecureContext || !crypto.subtle){
    document.body.innerHTML = '<div class="schermo" style="padding:2rem;line-height:1.6">' +
      '<h1>Serve una connessione sicura</h1><p>Spola cifra tutto, e per farlo il browser ' +
      'pretende <b>https</b>. Apri la versione pubblicata, non il file locale.</p></div>';
    return;
  }

  /* codice arrivato dal QR */
  const m = location.hash.match(/[#&]k=([0-9A-Za-z]+)/);
  if (m){
    const seme = b32dec(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    if (seme && seme.length >= 10){ localStorage.setItem(LS_SEME, m[1].toUpperCase()); }
  }

  const salvato = localStorage.getItem(LS_SEME);
  if (salvato){ const s = b32dec(salvato); if (s && s.length >= 10){ partiCon(s, false); } }

  /* --- setup --- */
  $('#btnCrea').onclick = () => {
    const seme = crypto.getRandomValues(new Uint8Array(15));
    localStorage.setItem(LS_SEME, b32enc(seme));
    mostraCodice();
  };
  $('#btnHoCodice').onclick = () => { $('#setupScelta').hidden = true; $('#setupInserisci').hidden = false; $('#campoCodice').focus(); };
  $('#btnIndietro').onclick = () => { $('#setupInserisci').hidden = true; $('#setupScelta').hidden = false; };
  $('#btnCollega').onclick = () => {
    const seme = b32dec($('#campoCodice').value);
    if (!seme || seme.length < 10){ $('#erroreCodice').hidden = false; return; }
    $('#erroreCodice').hidden = true;
    partiCon(seme, true);
  };
  $('#campoCodice').oninput = () => { $('#erroreCodice').hidden = true; };
  $('#btnCopiaCodice').onclick = async e => {
    const c = localStorage.getItem(LS_SEME) || '';
    try { await navigator.clipboard.writeText(c); } catch { ripiegoCopia(c); }
    brindisi('Codice copiato');
  };
  $('#btnFatto').onclick = () => { const s = b32dec(localStorage.getItem(LS_SEME)); partiCon(s, false); };

  /* --- menu --- */
  $('#btnMenu').onclick = () => { $('#menu').hidden = false; };
  $('#btnChiudiMenu').onclick = () => { $('#menu').hidden = true; };
  $('#menu').onclick = e => { if (e.target === $('#menu')) $('#menu').hidden = true; };
  $('#btnMostraCodice').onclick = () => { $('#menu').hidden = true; mostraCodice(); };
  $('#btnSvuota').onclick = () => {
    [...$('#lista').children].forEach(li => nascondi(li.dataset.id));
    $('#lista').innerHTML = ''; $('#vuoto').hidden = false; $('#menu').hidden = true;
  };
  $('#btnScollega').onclick = () => {
    localStorage.removeItem(LS_SEME); localStorage.removeItem(LS_NASC);
    if (ES) ES.close();
    location.reload();
  };

  /* --- invio --- */
  $('#btnInvia').onclick = inviaDalCampo;
  $('#campo').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); inviaDalCampo(); }
  });
  $('#fileImg').onchange = e => { inviaImmagini(e.target.files); e.target.value = ''; };
  $('#btnIncolla').onclick = async () => {
    try{
      if (navigator.clipboard.read){
        const roba = await navigator.clipboard.read();
        for (const it of roba){
          const tipoImg = it.types.find(t => /^image\//.test(t));
          if (tipoImg){ await inviaImmagini([new File([await it.getType(tipoImg)], 'incollata.png', {type:tipoImg})]); return; }
        }
      }
      const t = await navigator.clipboard.readText();
      if (!t){ brindisi('Gli appunti sono vuoti'); return; }
      $('#campo').value = t; await inviaDalCampo();
    } catch {
      brindisi('Il browser non mi fa leggere gli appunti: incolla nel campo qui sopra.', 3600);
      $('#campo').focus();
    }
  };

  /* --- incolla e trascina --- */
  document.addEventListener('paste', async e => {
    const dt = e.clipboardData; if (!dt) return;
    const imgs = [...(dt.files || [])].filter(f => /^image\//.test(f.type));
    if (imgs.length){ e.preventDefault(); await inviaImmagini(imgs); return; }
    if (e.target !== $('#campo') && e.target !== $('#campoCodice')){
      const t = dt.getData('text');
      if (t && t.trim() && !$('#app').hidden){ e.preventDefault(); $('#campo').value = t; await inviaDalCampo(); }
    }
  });
  let dragCount = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); if (++dragCount === 1) document.body.classList.add('trascino'); });
  window.addEventListener('dragover',  e => e.preventDefault());
  window.addEventListener('dragleave', e => { if (--dragCount <= 0){ dragCount = 0; document.body.classList.remove('trascino'); } });
  window.addEventListener('drop', async e => {
    e.preventDefault(); dragCount = 0; document.body.classList.remove('trascino');
    if ($('#app').hidden) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length) await inviaImmagini(e.dataTransfer.files);
    else { const t = e.dataTransfer.getData('text'); if (t){ $('#campo').value = t; await inviaDalCampo(); } }
  });

  /* --- ripresa dopo sospensione (telefono in tasca) --- */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && CANALE && (!ES || ES.readyState === 2)) ascolta();
  });
  window.addEventListener('online', () => { if (CANALE) ascolta(); });
}
avvio();
