// Napkin Viewer service worker: keeps the app usable offline and receives files shared from Android.
const VERSION = 'e8ecc46ca8';
const SHELL = 'napkin-shell-' + VERSION;
const LIBS = 'napkin-libs-v1';
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const LIB_URLS = [
  'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js',
  'https://cdn.jsdelivr.net/npm/mathjs@15.2.0/lib/browser/math.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_URLS.map(async (u) => { if (!(await libs.match(u))) { try { await libs.add(u); } catch { /* fetched later */ } } }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('napkin-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Android Share menu → this app: stash the shared text or file, then open the import box.
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      let text = '';
      try {
        const form = await req.formData();
        const f = form.get('file');
        if (f && typeof f.text === 'function') text = await f.text();
        else text = [form.get('text'), form.get('url'), form.get('title')].filter(Boolean).join('\n');
      } catch { text = ''; }
      const c = await caches.open('napkin-shared');
      await c.put('./__shared', new Response(text, { headers: { 'content-type': 'text/plain' } }));
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;

  // The app page: network first so updates arrive, cache when offline.
  if (url.origin === location.origin && (req.mode === 'navigate' || SHELL_FILES.some((f) => url.pathname.endsWith(f.replace('./', '/'))))) {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r.ok) (await caches.open(SHELL)).put(req.mode === 'navigate' ? './index.html' : req, r.clone());
        return r;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  // Libraries and fonts never change at a given URL: cache first.
  if (/^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    e.respondWith((async () => {
      const libs = await caches.open(LIBS);
      const hit = await libs.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') libs.put(req, r.clone());
      return r;
    })());
  }
});
