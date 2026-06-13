# 🏮 Tiên Đạo Chi Lộ — PWA Migration Guide

## Cấu trúc file cần có

```
project/
├── TienDaoChiLo.html   ← game chính (đã inject PWA tags)
├── manifest.json        ← cấu hình PWA app
├── sw.js                ← Service Worker (offline cache)
├── icon-192.png         ← icon 192×192 (Android, Chrome)
└── icon-512.png         ← icon 512×512 (splash screen)
```

---

## Deploy lên GitHub Pages (cách đơn giản nhất)

1. Tạo repo mới trên GitHub (ví dụ: `tien-dao-chi-lo`)
2. Upload tất cả 5 file vào repo
3. Vào **Settings → Pages → Branch: main → Save**
4. Game sẽ chạy tại: `https://[username].github.io/tien-dao-chi-lo/TienDaoChiLo.html`

> ⚠️ GitHub Pages bắt buộc phải dùng HTTPS — Service Worker chỉ hoạt động trên HTTPS.

---

## Deploy lên Netlify (nhanh hơn, có custom domain miễn phí)

1. Vào [netlify.com](https://netlify.com) → **Add new site → Deploy manually**
2. Kéo thả folder chứa 5 file vào
3. Xong! URL dạng `https://[random].netlify.app`

---

## Người dùng cài app như thế nào?

### Android (Chrome):
- Mở game trên Chrome → nhấn menu ⋮ → **"Thêm vào màn hình chính"**
- App icon xuất hiện như app thật, mở fullscreen không có thanh URL

### iOS (Safari):
- Mở game trên Safari → nhấn nút Share (□↑) → **"Thêm vào màn hình chính"**
- Lần đầu cần có mạng để tải về, sau đó chơi offline được

### Desktop (Chrome/Edge):
- Khi mở game sẽ xuất hiện nút Install (⊕) trên thanh địa chỉ
- Click → game chạy như app riêng biệt

---

## Service Worker hoạt động ra sao?

```
Lần đầu mở:
  Browser → tải TienDaoChiLo.html từ server
  SW install → cache file vào bộ nhớ thiết bị
  
Lần sau (có mạng):
  SW → trả file từ cache ngay lập tức (nhanh hơn)
  SW → ngầm check server có version mới không
  Nếu có mới → cache update → lần sau dùng version mới
  
Offline hoàn toàn:
  SW → trả file từ cache
  Game chạy bình thường, save/load vẫn hoạt động (localStorage)
```

---

## Update game (khi bạn thêm tính năng mới)

Khi deploy file HTML mới, chỉ cần **đổi tên cache** trong `sw.js`:

```js
// Dòng 8 trong sw.js
const CACHE_NAME = 'tien-dao-v2';  // ← tăng số version
```

Browser sẽ tự nhận ra SW mới, xóa cache cũ, tải version mới.

---

## Khi game lớn hơn (có ảnh, âm thanh thật)

Tách assets ra file riêng:

```
project/
├── TienDaoChiLo.html
├── manifest.json
├── sw.js
├── assets/
│   ├── images/
│   │   ├── bg_mountain.webp
│   │   └── avatar_warrior.webp
│   └── audio/
│       ├── bgm_main.mp3
│       └── sfx_hit.mp3
```

Trong `sw.js`, thêm assets vào `CORE_FILES` để cache khi cài:
```js
const CORE_FILES = [
  './TienDaoChiLo.html',
  './manifest.json',
  './assets/images/bg_mountain.webp',
  // thêm từng file...
];
```

---

## Debug Service Worker

Mở **Chrome DevTools → Application → Service Workers**
- Xem SW đang active
- Nút "Update" để force reload SW mới
- **Cache Storage** để xem những gì đã được cache
