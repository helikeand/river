// 缓存版本 → 每次更新代码时递增此数字
const CACHE_NAME = 'auto-answer-v4';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/parser.js',
  './js/search.js',
  './js/ai.js',
  './libs/mammoth.browser.min.js',
  './libs/pdf.min.js',
  './libs/pdf.worker.min.js',
  './libs/xlsx.full.min.js',
  './libs/fuse.basic.min.js'
];

// 安装事件：预先缓存所有本地资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();   // 立即激活新 SW
});

// 激活事件：清理旧版本缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();  // 立即控制所有页面
});

// 请求拦截：仅对 GET 请求且属于本域的资源使用缓存
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 如果不是 GET 请求，或者请求的是第三方 API（如 OpenAI），直接走网络
  if (event.request.method !== 'GET' || !url.pathname.startsWith(self.location.pathname.replace(/\/[^/]*$/, '/'))) {
    // 对于 API 请求，直接 fetch 并返回，不缓存
    event.respondWith(fetch(event.request));
    return;
  }

  // 对于本域 GET 资源，缓存优先，网络回退
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request);
    })
  );
});