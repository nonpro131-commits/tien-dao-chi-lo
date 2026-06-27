import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, query, orderBy, limit, where, deleteDoc, runTransaction, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, deleteUser, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyArt7yX7IO4GImWJDVv3aTk47EUkFTKF3k",
  authDomain: "tien-dao-gane.firebaseapp.com",
  projectId: "tien-dao-gane",
  storageBucket: "tien-dao-gane.firebasestorage.app",
  messagingSenderId: "533118817350",
  appId: "1:533118817350:web:9ca62f13f27f389a2da647"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

function _userKey(username) {
  return username.toLowerCase().replace(/[^a-z0-9_\u00c0-\u024f\u1e00-\u1eff]/gi, "_");
}

// ── Hash mật khẩu kiểu CŨ — chỉ dùng để kiểm tra tài khoản đăng ký TRƯỚC khi có Firebase Auth ──
async function _legacyHashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(pw + "tdcl_salt_2026"));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ── Mã hoá username → "email" giả nội bộ để dùng được Firebase Authentication ──
// Firebase Auth (Email/Password) cần định dạng email; người chơi vẫn chỉ thấy "Tên tài khoản" như cũ.
// Băm SHA-256 để: (1) luôn ra ký tự ASCII hợp lệ dù tên có dấu tiếng Việt, (2) không lo 2 tên gần giống
// nhau (vd "Lý" và "Ly") bị tính trùng — vì băm theo userKey gốc (vẫn giữ dấu) trước khi mã hoá.
async function _toPseudoEmail(userKey) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tdcl_auth_v1:" + userKey));
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"").toLowerCase();
  return "u" + b64 + "@tdcl.app";
}

function _friendlyAuthError(code) {
  switch(code) {
    case "auth/email-already-in-use": return "Tên này đã có người dùng, chọn tên khác.";
    case "auth/weak-password":        return "Mật khẩu cần ít nhất 6 ký tự.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials": return "Sai mật khẩu.";
    case "auth/user-not-found":       return "Tài khoản không tồn tại.";
    case "auth/too-many-requests":    return "Thử lại quá nhiều lần, vui lòng đợi một chút.";
    case "auth/network-request-failed": return "Lỗi kết nối mạng.";
    default: return null;
  }
}

window._cloudUser = null; // { username, userKey }

// ── Khôi phục đăng nhập sau khi tải lại trang ──────────────
// Firebase Auth tự lưu session (an toàn hơn localStorage cũ — không còn lưu hash mật khẩu ở máy).
// Chỉ lưu kèm "username" (không nhạy cảm) để biết cần tải tài liệu Firestore nào.
onAuthStateChanged(auth, async (user) => {
  try {
    if (user) {
      const savedUsername = localStorage.getItem("_tdcl_last_username");
      if (savedUsername) {
        const key = _userKey(savedUsername);
        const snap = await getDoc(doc(db, "players", key));
        if (snap.exists() && snap.data().uid === user.uid) {
          window._cloudUser = { username: snap.data().username, userKey: key, playerUid: snap.data().playerUid || null };
          // Khởi realtime listener lời mời kết bạn ngay khi restore session
          setTimeout(() => { if (typeof _daoHuuLoadRequests === "function") _daoHuuLoadRequests(); }, 1000);
          // KHÔNG gọi _cloudWatchDaoHuu ở đây — G.S chưa sẵn sàng lúc này.
          // _cloudWatchDaoHuu chỉ được gọi trong loadGame() khi G.S chắc chắn đã init.
        }
      }
    } else {
      window._cloudUser = null;
    }
  } catch(e) {
    console.warn("[Cloud] Lỗi khôi phục session:", e);
  }
  if (typeof window._updateTitleLoginBtn === "function") window._updateTitleLoginBtn();
});

// ── Chuẩn hoá tên đạo hiệu để so trùng (không phân biệt hoa/thường, khoảng trắng dư) ──
function _charNameKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ").replace(/\//g, "_").slice(0, 100);
}

// ── ID ngẫu nhiên định danh riêng cho thiết bị/trình duyệt này ──
// Dùng để nhận ra "chính mình" nếu lỡ tải lại trang giữa lúc đặt tên (không bị báo trùng oan)
function _getDeviceId() {
  try {
    let id = localStorage.getItem("_tdcl_device_id");
    if (!id) {
      id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("_tdcl_device_id", id);
    }
    return id;
  } catch (e) {
    return "dev_anon";
  }
}

// ── Giữ tên đạo hiệu (chống đặt tên trùng) ───────────────────
// Dùng collection riêng "claimed_names", doc id = tên đã chuẩn hoá.
// Dùng Transaction để đảm bảo 2 người bấm xác nhận cùng lúc không thể cùng giữ 1 tên.
window._claimCharName = async function(name) {
  const key = _charNameKey(name);
  if (!key) return { ok: false, reason: "empty" };
  const deviceId = _getDeviceId();
  const ref = doc(db, "claimed_names", key);

  let outcome = "claimed";
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data.deviceId === deviceId) {
        outcome = "self"; // chính thiết bị này đã giữ tên này trước đó → cho qua
        return;
      }
      outcome = "taken";
      return;
    }
    tx.set(ref, { name: name.trim(), deviceId, claimedAt: Date.now() });
  });

  return { ok: outcome !== "taken", reason: outcome };
};

// ── Đăng nhập từ Title Screen ─────────────────────────────
// Chỉ đăng nhập, KHÔNG tạo tài khoản mới ở đây
window._cloudLogin = async function() {
  const username = document.getElementById("cloud-username").value.trim();
  const password = document.getElementById("cloud-password").value;
  const msgEl = document.getElementById("cloud-msg");
  const btnEl = document.getElementById("cloud-login-btn");

  msgEl.textContent = "";
  if (!username || !password) { msgEl.textContent = "Vui lòng nhập đủ thông tin."; msgEl.style.color="#ffaa60"; return; }

  btnEl.textContent = "Đang kết nối...";
  btnEl.style.opacity = "0.6"; btnEl.style.pointerEvents = "none";

  const key = _userKey(username);
  const playerRef = doc(db, "players", key);

  const fail = (text) => {
    msgEl.textContent = "❌ " + text;
    msgEl.style.color = "#ff6060";
    btnEl.textContent = "Xác Nhận"; btnEl.style.opacity="1"; btnEl.style.pointerEvents="all";
  };

  const finishOk = async (data) => {
    // Tài khoản tạo trước khi có tính năng UID → tự sinh bổ sung ngay khi đăng nhập
    if (!data.playerUid) {
      const newUid = await _generatePlayerUid(key);
      if (newUid) {
        data.playerUid = newUid;
        setDoc(playerRef, { playerUid: newUid }, { merge: true }).catch(()=>{});
      }
    }
    window._cloudUser = { username: data.username, userKey: key, playerUid: data.playerUid || null };
    // Khởi realtime listener lời mời kết bạn
    setTimeout(() => { if (typeof _daoHuuLoadRequests === "function") _daoHuuLoadRequests(); }, 500);
    // KHÔNG gọi _cloudWatchDaoHuu ở đây — G.S chưa sẵn sàng. Sẽ gọi trong loadGame().
    localStorage.setItem("_tdcl_last_username", data.username);
    msgEl.textContent = "✅ Đăng nhập thành công!";
    msgEl.style.color = "#70e880";

    if (data.saveData) {
      try {
        const parsed = typeof data.saveData === "string" ? JSON.parse(data.saveData) : data.saveData;
        localStorage.setItem("tdcl", JSON.stringify(parsed));
      } catch(e) { console.warn("[Cloud] Parse save lỗi:", e); }
    }

    setTimeout(() => {
      try {
        document.getElementById("cloud-auth-screen").style.display = "none";
        _updateTitleLoginBtn();
        // Tự động vào game nếu có save data
        if (data.saveData) {
          const titleEl = document.getElementById("title-screen");
          // continueGame() → loadGame() → goto() → renderHUD() → checkUnlocks() đúng thứ tự
          if (typeof G !== "undefined" && typeof G.continueGame === "function") {
            titleEl.style.display = "none";
            G.continueGame();
          }
        }
      } catch(e) {
        console.error("[Cloud] Lỗi khi vào game sau đăng nhập:", e);
        // Tránh màn hình đen im lặng: hiện lại title-screen và báo lỗi rõ ràng
        const titleEl = document.getElementById("title-screen");
        if (titleEl) titleEl.style.display = "";
        alert("❌ Đăng nhập thành công nhưng không tải được save: " + e.message + "\nVui lòng thử lại hoặc liên hệ hỗ trợ.");
      }
    }, 900);
  };

  try {
    const pseudoEmail = await _toPseudoEmail(key);
    try {
      // Thử đăng nhập bằng Firebase Authentication
      await signInWithEmailAndPassword(auth, pseudoEmail, password);
      const snap = await getDoc(playerRef);
      if (!snap.exists()) { fail("Lỗi dữ liệu tài khoản, vui lòng liên hệ hỗ trợ."); return; }
      await finishOk(snap.data());
    } catch(authErr) {
      if (authErr.code === "auth/user-not-found") {
        // Có thể đây là tài khoản CŨ (đăng ký trước khi có Firebase Auth) — kiểm tra theo cách cũ
        const snap = await getDoc(playerRef);
        if (!snap.exists()) { fail("Tài khoản không tồn tại."); return; }
        const data = snap.data();
        if (data.uid) { fail("Lỗi tài khoản, vui lòng thử lại."); return; }
        const oldHash = await _legacyHashPassword(password);
        if (data.passwordHash !== oldHash) { fail("Sai mật khẩu."); return; }

        // Mật khẩu cũ đúng → nâng cấp tài khoản này lên Firebase Auth ngay
        try {
          const cred = await createUserWithEmailAndPassword(auth, pseudoEmail, password);
          const upgradeData = { uid: cred.user.uid };
          if (!data.playerUid) {
            const newUid = await _generatePlayerUid(key);
            if (newUid) { upgradeData.playerUid = newUid; data.playerUid = newUid; }
          }
          await setDoc(playerRef, upgradeData, { merge: true });
        } catch(upgradeErr) {
          // Mật khẩu cũ ngắn hơn 6 ký tự (yêu cầu của Firebase Auth) → chưa nâng cấp được lúc này,
          // vẫn cho đăng nhập bình thường theo cách cũ, sẽ thử nâng cấp lại lần sau.
          console.warn("[Cloud] Không nâng cấp được tài khoản:", upgradeErr.message);
        }
        await finishOk(data);
      } else {
        fail(_friendlyAuthError(authErr.code) || ("Lỗi kết nối: " + authErr.message));
      }
    }
  } catch(e) {
    fail("Lỗi kết nối: " + e.message);
  }
};

// ── Sinh UID số 10 chữ số ngẫu nhiên, duy nhất toàn server ──
// Dùng collection riêng "player_uids", doc id = chính số UID, value = userKey trỏ tới tài khoản.
// Dùng setDoc với điều kiện "chưa tồn tại" qua getDoc trước, lặp lại nếu trùng (cực hiếm: 1/10 tỷ).
async function _generatePlayerUid(userKey) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const uid = String(Math.floor(1000000000 + Math.random() * 9000000000)); // 10 chữ số, không bắt đầu bằng 0
    const uidRef = doc(db, "player_uids", uid);
    try {
      const snap = await getDoc(uidRef);
      if (snap.exists()) continue; // trùng, thử số khác
      await setDoc(uidRef, { userKey, claimedAt: Date.now() });
      return uid;
    } catch(e) {
      console.warn("[Cloud] Lỗi sinh UID:", e.message);
    }
  }
  return null; // Hiếm khi xảy ra — tài khoản vẫn hoạt động bình thường, chỉ thiếu UID
}

// ── Đăng ký tài khoản từ trong game (Cài Đặt) ─────────────
window._cloudRegister = async function() {
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const msgEl = document.getElementById("reg-msg");
  const btnEl = document.getElementById("reg-btn");

  msgEl.textContent = "";
  if (!username || !password) { msgEl.textContent = "Vui lòng nhập đủ thông tin."; msgEl.style.color="#ffaa60"; return; }
  if (username.length < 2 || username.length > 20) { msgEl.textContent = "Tên từ 2–20 ký tự."; msgEl.style.color="#ffaa60"; return; }
  if (password.length < 6) { msgEl.textContent = "Mật khẩu ít nhất 6 ký tự."; msgEl.style.color="#ffaa60"; return; }

  btnEl.textContent = "Đang tạo..."; btnEl.style.opacity="0.6"; btnEl.style.pointerEvents="none";

  const key = _userKey(username);
  const playerRef = doc(db, "players", key);

  try {
    const snap = await getDoc(playerRef);
    if (snap.exists()) {
      msgEl.textContent = "❌ Tên này đã có người dùng, chọn tên khác.";
      msgEl.style.color="#ff6060";
      btnEl.textContent="Đăng Ký & Lưu Lên Cloud"; btnEl.style.opacity="1"; btnEl.style.pointerEvents="all";
      return;
    }

    const pseudoEmail = await _toPseudoEmail(key);
    const cred = await createUserWithEmailAndPassword(auth, pseudoEmail, password);

    // Lấy save hiện tại
    const currentSave = localStorage.getItem("tdcl") || null;

    // Sinh UID số 10 chữ số để người chơi có thể tìm Đạo Hữu chính xác (tránh trùng tên)
    const playerUid = await _generatePlayerUid(key);

    await setDoc(playerRef, {
      username,
      uid: cred.user.uid,
      playerUid,
      createdAt: Date.now(),
      saveData: currentSave,
      lastSaved: Date.now()
    });

    window._cloudUser = { username, userKey: key, playerUid };
    // Khởi realtime listener lời mời kết bạn
    setTimeout(() => { if (typeof _daoHuuLoadRequests === "function") _daoHuuLoadRequests(); }, 500);
    // KHÔNG gọi _cloudWatchDaoHuu ở đây — G.S chưa sẵn sàng. Sẽ gọi trong loadGame().
    localStorage.setItem("_tdcl_last_username", username);
    msgEl.textContent = "✅ Tạo tài khoản thành công! Save đã lên cloud.";
    msgEl.style.color = "#70e880";
    btnEl.textContent = "Đăng Ký & Lưu Lên Cloud"; btnEl.style.opacity="1"; btnEl.style.pointerEvents="all";

    // Refresh màn hình cài đặt để hiện trạng thái mới
    setTimeout(() => { if(typeof G!=="undefined"){ window._settingsFromGame=true; G.openSettings(); } }, 1500);

  } catch(e) {
    msgEl.textContent = "❌ " + (_friendlyAuthError(e.code) || ("Lỗi: " + e.message));
    msgEl.style.color="#ff6060";
    btnEl.textContent="Đăng Ký & Lưu Lên Cloud"; btnEl.style.opacity="1"; btnEl.style.pointerEvents="all";
  }
};

// ── Upload save lên cloud ──────────────────────────────────
window._cloudSave = async function(saveObj) {
  if (!window._cloudUser) return false;
  try {
    await setDoc(doc(db, "players", window._cloudUser.userKey), {
      username: window._cloudUser.username,
      saveData: JSON.stringify(saveObj),
      lastSaved: Date.now(),
      stage: saveObj.stage || 0,
      stageName: saveObj.stageName || "Phàm Nhân",
      exp: saveObj.exp || 0,
      charName: saveObj.name || ""
    }, { merge: true });
    return true;
  } catch(e) {
    console.warn("[Cloud] Lưu thất bại:", e.message);
    return false;
  }
};

// ── Đăng xuất ─────────────────────────────────────────────
window._cloudLogout = async function() {
  const ok = await window._showGameConfirm({
    title: "Đăng Xuất",
    msg: "Đăng xuất tài khoản " + (window._cloudUser ? `"${window._cloudUser.username}"` : "") + "?\n\nTiến trình vẫn được lưu trên cloud.\nMàn hình sẽ quay về Chơi Mới.",
    okLabel: "Đăng Xuất"
  });
  if (!ok) return;
  // Lưu game lên cloud trước khi đăng xuất
  if (typeof G !== "undefined" && typeof G.saveGame === "function") {
    G.saveGame();
  }
  // Chờ cloud save hoàn tất rồi mới reload
  await new Promise(r => setTimeout(r, 600));
  // Dừng realtime listeners
  if (typeof window._cloudStopWatchDaoHuu === "function") window._cloudStopWatchDaoHuu();
  try { await signOut(auth); } catch(e) {}
  window._cloudUser = null;
  localStorage.removeItem("_tdcl_last_username");
  localStorage.removeItem("_tdcl_session"); // dọn key cũ nếu còn sót
  location.reload();
};

// ── Xóa tài khoản (vĩnh viễn) ──────────────────────────────
window._cloudDeleteAccount = async function(userKey) {
  try {
    const user = auth.currentUser;
    if (user) {
      try {
        await deleteUser(user);
      } catch(e) {
        if (e.code === "auth/requires-recent-login") {
          // Firebase yêu cầu xác thực lại cho hành động nhạy cảm này nếu đã đăng nhập lâu
          const pw = prompt("Vì lý do an toàn, vui lòng nhập lại mật khẩu để xác nhận xoá tài khoản:");
          if (pw) {
            try {
              const cred = EmailAuthProvider.credential(user.email, pw);
              await reauthenticateWithCredential(user, cred);
              await deleteUser(user);
            } catch(e2) { console.warn("[Cloud] Xác thực lại thất bại:", e2.message); }
          }
        } else {
          console.warn("[Cloud] Không xoá được tài khoản Auth:", e.message);
        }
      }
    }
    // Đọc playerUid trước khi xoá document players, để giải phóng UID tương ứng
    let oldPlayerUid = null;
    try {
      const pSnap = await getDoc(doc(db, "players", userKey));
      if (pSnap.exists()) oldPlayerUid = pSnap.data().playerUid || null;
    } catch(e) {}

    await deleteDoc(doc(db, "players", userKey));
    for(const tab of ["tuvi","luyen_dan","luyen_khi","luyen_phu","tran_phap"]){
      await deleteDoc(doc(db, "bxh_"+tab, userKey)).catch(()=>{});
    }
    if (oldPlayerUid) {
      await deleteDoc(doc(db, "player_uids", oldPlayerUid)).catch(()=>{});
    }
    return true;
  } catch(e) {
    console.warn("[Cloud] Delete error:", e);
    return false;
  }
};


// ── Cảnh báo khi chưa đăng ký mà muốn thoát/đăng xuất ────
window._warnNotRegistered = function() {
  return window._showGameConfirm({
    title: "⚠️ Chưa Đăng Ký Tài Khoản",
    msg: "Dữ liệu chỉ lưu trên máy này.\nXóa app hoặc đổi thiết bị sẽ MẤT toàn bộ tiến trình.\n\nVào Cài Đặt → Đăng Ký để bảo vệ save của bạn.\n\nVẫn muốn tiếp tục thoát?",
    okLabel: "Thoát", okDanger: true
  });
};

// ── Cập nhật nút title screen ─────────────────────────────
function _updateTitleLoginBtn() {
  const loginBtn = document.getElementById("btn-login");
  const newBtn   = document.getElementById("btn-choimoi");
  if (!loginBtn || !newBtn) return;
  if (window._cloudUser) {
    // Đổi "Chơi Mới" → tên tài khoản
    newBtn.textContent = "▶ " + window._cloudUser.username;
    newBtn.onclick = function(){ if(typeof G!=="undefined") G.continueGame(); };
    // Đổi "Đăng Nhập" → "Đổi Tài Khoản"
    loginBtn.textContent = "Đổi Tài Khoản";
    loginBtn.onclick = function(){
      // Reset form đăng nhập
      const u = document.getElementById("cloud-username");
      const p = document.getElementById("cloud-password");
      const m = document.getElementById("cloud-msg");
      const b = document.getElementById("cloud-login-btn");
      if(u) u.value=""; if(p) p.value=""; if(m) m.textContent="";
      if(b){ b.textContent="Xác Nhận"; b.style.opacity="1"; b.style.pointerEvents="all"; }
      document.getElementById("cloud-auth-screen").style.display="flex";
    };
  } else {
    newBtn.textContent = "Chơi Mới";
    newBtn.onclick = function(){ if(typeof G!=="undefined") G.startNewGame(); };
    loginBtn.textContent = "Đăng Nhập";
    loginBtn.onclick = function(){
      document.getElementById("cloud-auth-screen").style.display="flex";
    };
  }
}
window._updateTitleLoginBtn = _updateTitleLoginBtn;

// ── onSnapshot inbox — chỉ gọi SAU KHI G.S sẵn sàng (trong loadGame) ──
// Realtime: có entry mới → merge ngay, xóa entry → hiện bạn mới tức thì.
let _inboxUnsub = null;
window._cloudWatchDaoHuu = function() {
  if (_inboxUnsub) { _inboxUnsub(); _inboxUnsub = null; }
  if (!window._cloudUser || !window.G || !window.G.S) {
    _dbg("[Inbox] chưa sẵn sàng, bỏ qua");
    return;
  }
  const S = window.G.S;
  const myKey = window._cloudUser.userKey;
  const inboxCol = collection(db, "daohuu_inbox", myKey, "entries");
  _inboxUnsub = onSnapshot(inboxCol, async (snap) => {
    if (snap.empty) { _dbg("[Inbox] trống"); return; }
    S.daoHuu = S.daoHuu || [];
    let changed = false;
    const toDelete = [];
    snap.forEach(d => {
      const entry = d.data();
      if (!S.daoHuu.some(f => f.userKey === entry.userKey)) {
        S.daoHuu.push({
          userKey: entry.userKey,
          username: entry.username || "Ẩn danh",
          avatar: entry.avatar || null,
          age: entry.age != null ? entry.age : null,
          stageName: entry.stageName || "???",
          addedAt: entry.addedAt || Date.now()
        });
        changed = true;
        _dbg("[Inbox] merged: " + entry.username);
      }
      toDelete.push(d.id);
    });
    if (changed) {
      window.G.saveGame();
      if (typeof window._daoHuuRefreshRequestsUI === "function") window._daoHuuRefreshRequestsUI();
      if (typeof showNotif === "function") showNotif({icon:"🤝",title:"Kết Bạn Thành Công!",lines:["Bạn có Đạo Hữu mới!"],color:"#70d870",duration:3000});
    }
    for (const eid of toDelete) {
      try {
        await deleteDoc(doc(db, "daohuu_inbox", myKey, "entries", eid));
        _dbg("[Inbox] deleted: " + eid);
      } catch(e) { _dbg("[Inbox] delete fail: " + e.message); }
    }
  }, err => { _dbg("[Inbox] onSnapshot error: " + err.message); });
};
window._cloudStopWatchDaoHuu = function() {
  if (_inboxUnsub) { _inboxUnsub(); _inboxUnsub = null; }
};
// Pull thủ công khi mở tab (dùng hàm watch luôn — tự restart listener)
window._cloudPullDaoHuuInbox = function() { window._cloudWatchDaoHuu(); };

// Expose Firestore helpers ra window để dùng trong script chính
window._fsGetDocs    = getDocs;
window._fsCollection = collection;
window._fsQuery      = query;
window._fsLimit      = limit;
window._fsWhere      = where;
window._fsDb         = db;
window._fsGetDoc     = getDoc;
window._fsDoc        = doc;
window._fsSetDoc     = setDoc;
window._fsDeleteDoc  = deleteDoc;
window._fsRunTransaction = runTransaction;
window._fsOnSnapshot     = onSnapshot;
// Chat helpers
window._fsAddDoc         = addDoc;
window._fsOrderBy        = orderBy;
window._fsServerTimestamp = serverTimestamp;
