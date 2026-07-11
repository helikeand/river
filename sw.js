// 缓存版本 → 每次更新代码时递增此数字
const CACHE_NAME = 'auto-answer-v3';

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

// 安装事件：预先缓存所有资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  // 新 SW 立即激活（不等待旧 SW 释放页面）
  self.skipWaiting();
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
  // 确保新 SW 立即控制所有客户端
  self.clients.claim();
});

// 请求拦截：缓存优先，网络回退
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request);
    })
  );
});