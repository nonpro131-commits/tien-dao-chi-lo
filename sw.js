// ============================================================
// sw.js — Service Worker cho Tiên Đạo Chi Lộ PWA
// Chiến lược: Cache First cho game chính, Network First cho updates
// ============================================================

// ★ ĐỔI SỐ NÀY MỖI KHI DEPLOY BẢN MỚI ★
const APP_VERSION = '1.1.4';

// Cache name gắn liền với version → mỗi bản mới = cache namespace mới
// (đảm bảo activate luôn xóa sạch cache cũ và không bao giờ giữ asset cũ)
const CACHE_NAME = 'tien-dao-v' + APP_VERSION;

// Các file cần cache khi cài app (install event)
const CORE_FILES = [
  './TienDaoChiLo.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './title-bg.jpg',
  './avatar0.jpg',
  './avatar1.jpg',
  './avatar2.jpg',
  './avatar3.jpg',
  './avatar4.jpg',
  './avatar5.jpg',
];

// ── INSTALL: cache những file cốt lõi ──────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing cache:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        CORE_FILES.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Không cache được:', url, err);
          })
        )
      );
    }).then(() => {
      console.log('[SW] Install hoàn tất, version:', APP_VERSION);
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE: xóa cache cũ ──────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating, xóa cache cũ...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Xóa cache cũ:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW] Activate hoàn tất');
      return self.clients.claim();
    })
  );
});

// ── FETCH: chiến lược cache ──────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  // Không bao giờ can thiệp vào chính sw.js — luôn để trình duyệt
  // lấy thẳng từ network. Nếu không, cơ chế kiểm tra version (HTML
  // tự fetch sw.js để so APP_VERSION) sẽ luôn nhận lại bản cũ trong
  // cache do chiến lược stale-while-revalidate trả cache trước.
  if (url.pathname.endsWith('/sw.js')) return;
  // index.html luôn lấy từ network — đây là "cửa vào" không bao giờ cache
  if (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) return;
  // TienDaoChiLo.html?v=xxx — có query string version → không cache, luôn fetch mới
  if (url.pathname.endsWith('/TienDaoChiLo.html') && url.search) return;

  const isGoogleFonts = url.hostname.includes('fonts.googleapis.com') ||
                        url.hostname.includes('fonts.gstatic.com');
  const isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin && !isGoogleFonts) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Stale-while-revalidate: trả cache ngay, update ngầm
        fetch(event.request).then(fresh => {
          if (fresh && fresh.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, fresh.clone());
            });
          }
        }).catch(() => {});
        return cached;
      }

      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, toCache);
        });
        return response;
      }).catch(() => {
        console.warn('[SW] Không thể tải:', event.request.url);
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./TienDaoChiLo.html');
        }
      });
    })
  );
});

// ── MESSAGE: nhận lệnh từ game ────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      console.log('[SW] Đã xóa toàn bộ cache.');
      // Thông báo lại cho tất cả clients
      self.clients.matchAll().then(clients => {
        clients.forEach(c => c.postMessage({ type: 'CACHE_CLEARED' }));
      });
    });
  }
  if (event.data === 'GET_VERSION') {
    // Hỗ trợ cả postMessage trực tiếp lẫn MessageChannel
    const port = event.ports && event.ports[0];
    const payload = { type: 'SW_VERSION', version: APP_VERSION };
    if (port) {
      port.postMessage(payload);
    } else if (event.source) {
      event.source.postMessage(payload);
    }
  }
});
