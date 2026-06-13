// ============================================================
// sw.js — Service Worker cho Tiên Đạo Chi Lộ PWA
// Chiến lược: Cache First cho game chính, Network First cho updates
// ============================================================

const CACHE_NAME = 'tien-dao-v2';

// Các file cần cache khi cài app (install event)
const CORE_FILES = [
  './TienDaoChiLo.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // Font từ Google (sẽ cache khi lần đầu load)
];

// ── INSTALL: cache những file cốt lõi ──────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing cache:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache từng file riêng để 1 file lỗi không block toàn bộ
      return Promise.allSettled(
        CORE_FILES.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Không cache được:', url, err);
          })
        )
      );
    }).then(() => {
      console.log('[SW] Install hoàn tất');
      // Kích hoạt ngay mà không cần đóng tab cũ
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
      console.log('[SW] Activate hoàn tất, đang kiểm soát tất cả clients');
      return self.clients.claim();
    })
  );
});

// ── FETCH: chiến lược cache ──────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Bỏ qua các request không phải GET
  if (event.request.method !== 'GET') return;

  // Bỏ qua các request đến domain khác (analytics, CDN bên ngoài...)
  // ngoại trừ Google Fonts — ta sẽ cache fonts
  const isGoogleFonts = url.hostname.includes('fonts.googleapis.com') ||
                        url.hostname.includes('fonts.gstatic.com');
  const isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin && !isGoogleFonts) return;

  // Chiến lược: Cache First (ưu tiên cache, chỉ gọi mạng khi miss)
  // Phù hợp cho game — file ít thay đổi, ưu tiên offline
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Có trong cache → trả luôn, đồng thời update ngầm (stale-while-revalidate)
        const fetchUpdate = fetch(event.request).then(fresh => {
          if (fresh && fresh.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, fresh.clone());
            });
          }
          return fresh;
        }).catch(() => {}); // ignore network errors when updating in background

        return cached;
      }

      // Không có trong cache → tải từ mạng và lưu vào cache
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;

        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, toCache);
        });

        return response;
      }).catch(() => {
        // Mất mạng và không có cache → trả offline page nếu có
        console.warn('[SW] Không thể tải:', event.request.url);
        // Fallback về game chính nếu đang cố tải HTML
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./TienDaoChiLo.html');
        }
      });
    })
  );
});

// ── MESSAGE: nhận lệnh từ game (ví dụ: force update) ────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Đã xóa cache theo lệnh.');
    });
  }
});
