const CACHE_NAME = 'auto-answer-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/parser.js',
  './js/search.js',
  './js/ai.js'
 // 新增下面几行
  './libs/mammoth.browser.min.js',
  './libs/pdf.min.js',
  './libs/pdf.worker.min.js',
  './libs/xlsx.full.min.js',
  './libs/fuse.basic.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});
