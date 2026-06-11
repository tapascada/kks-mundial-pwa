const CACHE_NAME = 'kikes-mundial-v12';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './app_icon.png',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests in the service worker
  if (event.request.method !== 'GET') {
    return;
  }

  // Bypass Google Drive and Excel data files completely to prevent fetch and cache conflicts
  const url = event.request.url;
  if (url.includes('google') || url.includes('drive') || url.includes('.xlsm') || url.includes('.xlsx')) {
    return;
  }

  // Cache-first for local static assets and CDN libraries
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});


