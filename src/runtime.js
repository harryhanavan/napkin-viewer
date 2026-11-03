// Napkin Viewer: a local stand-in for the claude.ai artifact runtime, so the same napkin page runs
// offline on a phone. Data lives in IndexedDB; there is no Claude, so the conversation is read-only.
(() => {
  window.__napkinViewer = true;
  document.documentElement.classList.add('viewer');

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  // db.update semantics: nested objects merge, other values (including null) replace.
  const merge = (b, p) => {
    const o = isObj(b) ? { ...b } : {};
    for (const k of Object.keys(p)) o[k] = isObj(p[k]) ? merge(isObj(o[k]) ? o[k] : {}, p[k]) : p[k];
    return o;
  };
  const J = (v) => JSON.parse(JSON.stringify(v));
  const err = (code, message) => Object.assign(new Error(message), { code });

  // ---------- IndexedDB ----------
  const idb = new Promise((res, rej) => {
    const r = indexedDB.open('napkin-viewer', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('docs'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const d = await idb;
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  };
  const all = (store) => idb.then((d) => new Promise((res, rej) => {
    const out = new Map();
    const c = d.transaction(store).objectStore(store).openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out.set(cur.key, cur.value); cur.continue(); } else res(out); };
    c.onerror = () => rej(c.error);
  }));

  const docs = new Map();
  const blobUrls = new Map();
  const dirty = new Set();
  let flushT = 0;
  const flush = async () => {
    clearTimeout(flushT); flushT = 0;
    if (!dirty.size) return;
    const paths = [...dirty]; dirty.clear();
    try {
      await tx('docs', 'readwrite', (st) => { for (const p of paths) { if (docs.has(p)) st.put(docs.get(p), p); else st.delete(p); } });
    } catch (e) { console.error('viewer: save failed', e); paths.forEach((p) => dirty.add(p)); }
  };
  const touch = (p) => { dirty.add(p); if (!flushT) flushT = setTimeout(flush, 250); };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  const ready = (async () => {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* best effort */ }
    const [d, b] = await Promise.all([all('docs'), all('blobs')]);
    for (const [k, v] of d) docs.set(k, v);
    for (const [k, v] of b) blobUrls.set(k, URL.createObjectURL(v));
  })();
  window.__napkinBlob = (id) => blobUrls.get(id) || '';

  // ---------- db ----------
  const docSubs = new Map(), qSubs = new Set();
  const meta = { fromCache: false, hasPendingWrites: false };
  const snapDoc = (path) => { const d = docs.get(path); return { id: path.split('/').pop(), exists: !!d, data: () => (d ? J(d) : undefined), metadata: meta }; };
  const runQ = (q) => {
    let out = [];
    for (const [p, d] of docs) { const parts = p.split('/'); if (parts.length === 2 && parts[0] === q.col) out.push([p, d]); }
    for (const [f, op, v] of q.where) out = out.filter(([, d]) => (op === '==' ? d[f] === v : op === '!=' ? d[f] !== v : true));
    if (q.order) { const [f, dir] = q.order; out.sort((a, b) => (dir === 'desc' ? -1 : 1) * ((a[1][f] ?? 0) < (b[1][f] ?? 0) ? -1 : (a[1][f] ?? 0) > (b[1][f] ?? 0) ? 1 : 0)); }
    if (q.lim) out = out.slice(0, q.lim);
    const ds = out.map(([p]) => snapDoc(p));
    return { docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: meta };
  };
  const notify = (path) => setTimeout(() => {
    (docSubs.get(path) || new Set()).forEach((fn) => { try { fn(snapDoc(path)); } catch (e) { console.error(e); } });
    const col = path.split('/')[0];
    qSubs.forEach((s) => { if (s.q.col === col) { try { s.fn(runQ(s.q)); } catch (e) { console.error(e); } } });
  }, 0);
  const write = (path, v) => { if (v === undefined) docs.delete(path); else docs.set(path, v); touch(path); notify(path); };
  const db = {
    doc(path) {
      return {
        id: path.split('/').pop(), path,
        async get() { return snapDoc(path); },
        async set(d) { write(path, J(d)); },
        async update(p) { if (!docs.has(path)) throw err('invalid_argument', 'No document to update.'); write(path, merge(docs.get(path), J(p))); },
        async delete() { write(path, undefined); },
        onSnapshot(fn) {
          if (!docSubs.has(path)) docSubs.set(path, new Set());
          docSubs.get(path).add(fn);
          setTimeout(() => fn(snapDoc(path)), 0);
          return () => docSubs.get(path).delete(fn);
        },
      };
    },
    collection(col) {
      const mk = (q) => ({
        where(f, op, v) { return mk({ ...q, where: [...q.where, [f, op, v]] }); },
        orderBy(f, d) { return mk({ ...q, order: [f, d || 'asc'] }); },
        limit(n) { return mk({ ...q, lim: n }); },
        async get() { return runQ(q); },
        onSnapshot(fn) { const s = { q, fn }; qSubs.add(s); setTimeout(() => fn(runQ(q)), 0); return () => qSubs.delete(s); },
        doc(id) { return db.doc(col + '/' + id); },
      });
      return mk({ col, where: [], order: null, lim: 0 });
    },
  };

  // ---------- assets ----------
  const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const assets = {
    async upload(blob) {
      const id = newId();
      await tx('blobs', 'readwrite', (st) => st.put(blob, id));
      const url = URL.createObjectURL(blob);
      blobUrls.set(id, url);
      return { id, url, sizeBytes: blob.size, contentType: blob.type };
    },
    async list() { return { assets: [...blobUrls.keys()].map((id) => ({ id })), usage: {} }; },
    async delete(id) {
      await tx('blobs', 'readwrite', (st) => st.delete(id));
      const u = blobUrls.get(id); if (u) URL.revokeObjectURL(u);
      blobUrls.delete(id);
      return { deleted: true };
    },
  };

  // ---------- downloads ----------
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'napkins.json';
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return { status: 'saved' };
    },
  };

  const user = { async canEdit() { return true; }, async isOwner() { return true; } };
  const caps = { db, assets, downloads, user };
  window.claude = { use: async (n) => { await ready; return caps[n] || null; } };

  // ---------- after the page is up: offline cache, shared files, viewer touches ----------
  const whenReady = (fn) => {
    const t = setInterval(() => { const hk = window.__napkinHooks; if (hk && hk.ready()) { clearInterval(t); fn(hk); } }, 150);
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('viewer: no offline cache', e));
  whenReady(async (hk) => {
    const imp = document.getElementById('imp');
    if (imp) imp.textContent = 'Import a file or note';
    // Something shared to the app from Android's Share menu arrives through the service worker.
    if (new URLSearchParams(location.search).has('shared') && 'caches' in window) {
      try {
        const c = await caches.open('napkin-shared');
        const r = await c.match('./__shared');
        if (r) { const text = await r.text(); await c.delete('./__shared'); hk.importText(text); }
      } catch (e) { console.warn('viewer: shared item lost', e); }
      history.replaceState(null, '', location.pathname);
    }
  });

  // Full screen on the first tap when installed without it (the manifest asks for it, this is the fallback).
  const fsBtn = () => {
    const b = document.createElement('button');
    b.className = 'btn small viewer-fs';
    b.type = 'button';
    b.textContent = 'Full screen';
    b.onclick = () => { const el = document.documentElement; (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen && el.requestFullscreen({ navigationUI: 'hide' }))?.catch?.(() => {}); };
    document.addEventListener('fullscreenchange', () => { b.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
    return b;
  };
  addEventListener('DOMContentLoaded', () => {
    const sheetHead = document.querySelector('#sheet .sheet-head');
    if (sheetHead && document.documentElement.requestFullscreen) sheetHead.insertBefore(fsBtn(), sheetHead.lastElementChild);
  });
})();
