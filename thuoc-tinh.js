/* ============================================================
   THUỘC TÍNH — Hệ Thống Tu Luyện 8 Linh Căn Thuộc Tính
   File độc lập, expose window.ThuocTinh
   Không tự đọc biến global S/G — luôn nhận S làm tham số,
   để tương thích với thời điểm load <script> (trước khi S được khai báo).
   ============================================================ */
(function(){

  // ===== CONSTANTS =====

  // Màu sắc + nhãn cho từng thuộc tính
  const ATTR_INFO = {
    "Kim":  { color:"#e8c84a", colorDark:"#9c8420", label:"Kim",  statKey:["defPct"] },
    "Mộc":  { color:"#5ad06a", colorDark:"#1f7a32", label:"Mộc",  statKey:["hpPct"] },
    "Thủy": { color:"#4ab0e8", colorDark:"#1a5f8c", label:"Thủy", statKey:["manaPct"] },
    "Hỏa":  { color:"#e85a3c", colorDark:"#8c2410", label:"Hỏa",  statKey:["strPct"] },
    "Thổ":  { color:"#a87850", colorDark:"#5c4022", label:"Thổ",  statKey:["defPct"] },
    "Lôi":  { color:"#a060e0", colorDark:"#5a2890", label:"Lôi",  statKey:["agiPct"] },
    "Ám":   { color:"#3a3a42", colorDark:"#0a0a0e", label:"Ám",   statKey:["strPct","defPct","agiPct"] },
    "Băng": { color:"#2a4a8c", colorDark:"#10204a", label:"Băng", statKey:[] }, // xử lý riêng (KHU) trong calcBonuses
  };
  const ATTR_ORDER = ["Kim","Mộc","Thủy","Hỏa","Thổ","Lôi","Ám","Băng"];

  // 4 cấp bậc — tỉ lệ giờ/% và buff mỗi 1%
  const TIER_ORDER = ["ha","trung","thuong","cuc"];
  const TIER_INFO = {
    ha:      { name:"Hạ Phẩm",    hoursPerPct:1,  buffPct:3,  khuPct:0.25, mocPct:10, next:"trung"  },
    trung:   { name:"Trung Phẩm", hoursPerPct:2,  buffPct:5,  khuPct:0.5,  mocPct:20, next:"thuong" },
    thuong:  { name:"Thượng Phẩm",hoursPerPct:5,  buffPct:10, khuPct:1,    mocPct:25, next:"cuc"    },
    cuc:     { name:"Cực Phẩm",   hoursPerPct:10, buffPct:15, khuPct:1.5,  mocPct:30, next:null     },
  };

  const QUEST_MAX_HOURS = 24;
  const QUEST_RESET_HOURS = 25; // chờ 25h sau khi dùng hết quỹ
  const TIME_OPTIONS = [1, 2, 5, 10]; // giờ

  // ===== STATE HELPERS =====

  // Đảm bảo S.thuocTinh có đủ entry cho từng thuộc tính nhân vật đang sở hữu
  function ensureState(S){
    if(!S.thuocTinh) S.thuocTinh = {};
    if(S.thuocTinhQuestHours === undefined) S.thuocTinhQuestHours = QUEST_MAX_HOURS;
    if(S.thuocTinhQuestExhaustedAt === undefined) S.thuocTinhQuestExhaustedAt = 0;
    const attrs = S.linhcanAttrs || [];
    for(const a of attrs){
      if(!S.thuocTinh[a]){
        S.thuocTinh[a] = {
          tier: "ha",
          accumulatedHours: 0,   // tổng số giờ đã cộng dồn cho phiên hiện tại (cấp hiện tại)
          finishTime: 0,         // timestamp (ms) hoàn thành phiên hiện tại, 0 = không đang tu luyện
          accumulatedBuffPct: 0, // tổng buff% đã tích lũy từ các cấp đã hoàn thành trước (vĩnh viễn)
        };
      }
    }
  }

  // Tính % hiện tại của 1 thuộc tính tại thời điểm "now" (real-time)
  // Trả về: { percent (0-100, có thể >100 nếu đã xong), isTraining, hoursElapsed, hoursTotal, remainingSec }
  function getLiveProgress(S, attr, now){
    now = now || Date.now();
    const st = (S.thuocTinh||{})[attr];
    if(!st) return { percent:0, isTraining:false, hoursElapsed:0, hoursTotal:0, remainingSec:0 };

    const tierInfo = TIER_INFO[st.tier];
    const hoursTotal = st.accumulatedHours || 0;
    if(hoursTotal <= 0 || !st.finishTime){
      return { percent:0, isTraining:false, hoursElapsed:0, hoursTotal:0, remainingSec:0 };
    }

    const startTime = st.finishTime - hoursTotal*3600*1000;
    let hoursElapsed = (now - startTime) / 3600000;
    if(hoursElapsed < 0) hoursElapsed = 0;
    if(hoursElapsed > hoursTotal) hoursElapsed = hoursTotal;

    const percent = Math.min(100, (hoursElapsed / tierInfo.hoursPerPct));
    const remainingSec = Math.max(0, Math.floor((st.finishTime - now)/1000));
    const isTraining = now < st.finishTime;

    return { percent, isTraining, hoursElapsed, hoursTotal, remainingSec };
  }

  // Đã đạt 100% ở cấp hiện tại chưa (sẵn sàng đột phá)?
  function isMaxedOut(S, attr, now){
    const tierInfo = TIER_INFO[(S.thuocTinh[attr]||{}).tier || "ha"];
    const p = getLiveProgress(S, attr, now);
    return p.percent >= 100;
  }

  function isAtMaxTier(S, attr){
    const st = S.thuocTinh[attr];
    if(!st) return false;
    return TIER_INFO[st.tier].next === null;
  }

  // ===== QUEST (Quỹ 24h) =====

  // Cập nhật quỹ giờ: nếu đã hết hạn chờ reset (25h từ lúc cạn) thì cấp lại 24h
  function refreshQuest(S, now){
    now = now || Date.now();
    ensureState(S);
    if(S.thuocTinhQuestHours <= 0 && S.thuocTinhQuestExhaustedAt > 0){
      const resetAt = S.thuocTinhQuestExhaustedAt + QUEST_RESET_HOURS*3600*1000;
      if(now >= resetAt){
        S.thuocTinhQuestHours = QUEST_MAX_HOURS;
        S.thuocTinhQuestExhaustedAt = 0;
      }
    }
  }

  function getQuestRemainingResetSec(S, now){
    now = now || Date.now();
    if(S.thuocTinhQuestHours > 0 || !S.thuocTinhQuestExhaustedAt) return 0;
    const resetAt = S.thuocTinhQuestExhaustedAt + QUEST_RESET_HOURS*3600*1000;
    return Math.max(0, Math.floor((resetAt-now)/1000));
  }

  // Bấm chọn giờ tu luyện cho 1 thuộc tính. Trả về {ok, reason}
  function addTrainingHours(S, attr, hours, now){
    now = now || Date.now();
    ensureState(S);
    refreshQuest(S, now);

    if(!ATTR_INFO[attr]) return { ok:false, reason:"Thuộc tính không hợp lệ." };
    if(S.thuocTinhQuestHours < hours) return { ok:false, reason:"Quỹ thời gian không đủ." };

    const st = S.thuocTinh[attr];
    if(st.maxedOut) return { ok:false, reason:"Đã đạt Cực Phẩm viên mãn — không thể tu luyện thêm." };
    const liveNow = getLiveProgress(S, attr, now);
    if(liveNow.percent >= 100) return { ok:false, reason:"Thuộc tính đã viên mãn — hãy Đột Phá trước." };

    // Trừ quỹ ngay tại thời điểm bấm
    S.thuocTinhQuestHours -= hours;
    if(S.thuocTinhQuestHours <= 0){
      S.thuocTinhQuestHours = 0;
      S.thuocTinhQuestExhaustedAt = now;
    }

    if(!st.finishTime || st.finishTime <= now){
      // Không có phiên đang chạy -> bắt đầu phiên mới từ 0
      st.accumulatedHours = hours;
      st.finishTime = now + hours*3600*1000;
    } else {
      // Đang có phiên chạy -> cộng dồn thêm giờ vào finishTime hiện tại (không reset mốc bắt đầu)
      st.finishTime += hours*3600*1000;
      st.accumulatedHours += hours;
    }

    return { ok:true };
  }

  // Đột phá lên cấp tiếp theo. Trả về {ok, reason, newTier}
  function breakthrough(S, attr, now){
    now = now || Date.now();
    ensureState(S);
    const st = S.thuocTinh[attr];
    if(!st) return { ok:false, reason:"Thuộc tính không tồn tại." };
    if(st.maxedOut) return { ok:false, reason:"Đã đạt Cực Phẩm viên mãn — không thể đột phá thêm." };

    const live = getLiveProgress(S, attr, now);
    if(live.percent < 100) return { ok:false, reason:"Chưa viên mãn 100%." };

    const tierInfo = TIER_INFO[st.tier];
    // Cộng buff tích lũy vĩnh viễn của cấp vừa hoàn thành (100% × tỉ lệ buff/1% của cấp đó)
    if(attr === "Băng"){
      st.accumulatedKhuPct = (st.accumulatedKhuPct||0) + (100 * tierInfo.khuPct);
    } else if(attr === "Mộc"){
      st.accumulatedBuffPct = (st.accumulatedBuffPct||0) + (100 * tierInfo.mocPct);
    } else {
      st.accumulatedBuffPct = (st.accumulatedBuffPct||0) + (100 * tierInfo.buffPct);
    }

    if(tierInfo.next === null){
      // Đã ở Cực Phẩm và viên mãn -> không còn gì để đột phá, giữ nguyên trạng thái 100% vĩnh viễn
      st.accumulatedHours = tierInfo.hoursPerPct*100; // giữ mốc 100% hiển thị
      st.finishTime = now; // đánh dấu đã dừng (không tiếp tục đếm)
      st.maxedOut = true; // chặn breakthrough() cộng buff lần nữa
      return { ok:true, maxed:true };
    }

    // Chuyển cấp mới, reset % về 0
    st.tier = tierInfo.next;
    st.accumulatedHours = 0;
    st.finishTime = 0;

    return { ok:true, newTier: st.tier };
  }

  // ===== BUFF CALCULATION =====

  // Trả về { strPct, defPct, agiPct, hpPct, manaPct, khu } tổng hợp từ tất cả thuộc tính
  function calcBonuses(S, now){
    now = now || Date.now();
    ensureState(S);
    const out = { strPct:0, defPct:0, agiPct:0, hpPct:0, manaPct:0, khu:0 };
    const attrs = S.linhcanAttrs || [];

    for(const attr of attrs){
      const st = S.thuocTinh[attr];
      if(!st) continue;
      const info = ATTR_INFO[attr];
      const tierInfo = TIER_INFO[st.tier];

      // Nếu đã maxedOut (Cực Phẩm viên mãn, không còn đột phá được nữa),
      // buff đã được chốt vĩnh viễn vào accumulated*Pct lúc breakthrough() cuối cùng.
      // Không cộng thêm currentContribution nữa để tránh tính trùng (double-count).
      const live = st.maxedOut ? null : getLiveProgress(S, attr, now);

      if(attr === "Băng"){
        const currentContribution = live ? live.percent * tierInfo.khuPct : 0;
        const totalKhu = (st.accumulatedKhuPct||0) + currentContribution;
        out.khu += totalKhu;
      } else {
        const rate = (attr === "Mộc") ? tierInfo.mocPct : tierInfo.buffPct;
        const currentContribution = live ? live.percent * rate : 0;
        const totalStatPct = (st.accumulatedBuffPct||0) + currentContribution;
        for(const key of info.statKey){
          out[key] = (out[key]||0) + totalStatPct;
        }
      }
    }
    return out;
  }

  // ===== UI: SVG sphere (liquid fill) =====

  function renderSphere(attr, percent, sizePx){
    const info = ATTR_INFO[attr];
    const size = sizePx || 64;
    const offset = 100 - Math.max(0, Math.min(100, percent));
    return `
      <div class="tt-sphere" style="width:${size}px;height:${size}px;" data-attr="${attr}">
        <div class="tt-sphere-mask" style="box-shadow:inset 0 -10px 22px rgba(0,0,0,.55), inset 0 6px 14px rgba(255,255,255,.12), 0 0 14px ${info.color}55;">
          <div class="tt-sphere-liquid" style="--fill-offset:${offset}%; background:linear-gradient(180deg, ${info.color} 0%, ${info.colorDark} 100%);"></div>
        </div>
        <div class="tt-sphere-shine"></div>
        <div class="tt-sphere-label">${info.label}</div>
      </div>`;
  }

  // CSS dùng chung — gọi 1 lần khi render màn hình thuộc tính
  function getStylesheet(){
    return `
    <style>
      .tt-ring-wrap{ position:relative; width:280px; height:280px; margin:18px auto 8px; }
      .tt-ring-center{
        position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
        width:128px; height:128px; border-radius:50%;
        background:radial-gradient(circle at 35% 30%, rgba(201,168,76,.18), rgba(10,8,4,.92) 70%);
        border:1px solid rgba(201,168,76,.35);
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        text-align:center; cursor:pointer; gap:2px; padding:6px;
        box-shadow:0 0 18px rgba(201,168,76,.15), inset 0 0 14px rgba(0,0,0,.5);
      }
      .tt-ring-center:active{ transform:translate(-50%,-50%) scale(.96); }
      .tt-ring-center .tt-c-title{ font-size:9px; color:#9a8040; letter-spacing:.5px; }
      .tt-ring-center .tt-c-cta{ font-size:12px; font-weight:700; color:#f0d98c; line-height:1.3; }
      .tt-sphere{ position:absolute; cursor:pointer; }
      .tt-sphere-mask{
        position:absolute; inset:0; border-radius:50%; overflow:hidden;
        background:radial-gradient(circle at 35% 30%, #1c2738, #0c121d 70%);
      }
      .tt-sphere-liquid{
        position:absolute; left:-10%; width:120%; height:300%; bottom:0;
        transition: transform .5s cubic-bezier(.2,.8,.2,1);
        transform: translateY(var(--fill-offset, 100%));
      }
      .tt-sphere-liquid::before{
        content:""; position:absolute; top:0; left:0; right:0; height:3px;
        background:rgba(255,255,255,.35); filter:blur(.5px);
      }
      .tt-sphere-shine{
        position:absolute; top:8%; left:16%; width:32%; height:20%;
        background:radial-gradient(ellipse at center, rgba(255,255,255,.5), rgba(255,255,255,0) 70%);
        border-radius:50%; pointer-events:none;
      }
      .tt-sphere-label{
        position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        font-size:11px; font-weight:700; color:#fff; text-shadow:0 1px 4px rgba(0,0,0,.7);
        pointer-events:none;
      }
      .tt-sphere-pct{
        position:absolute; left:50%; bottom:-16px; transform:translateX(-50%);
        font-size:9px; color:#9ab0c8; white-space:nowrap;
      }
      .tt-tier-tag{
        position:absolute; left:50%; bottom:-28px; transform:translateX(-50%);
        font-size:8px; color:#7a6030; white-space:nowrap;
      }
      .tt-quest-bar{
        margin:4px auto 14px; max-width:260px; text-align:center;
        font-size:11px; color:#9ab0c8;
      }
      .tt-popup-overlay{
        position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:9999;
        display:flex; align-items:center; justify-content:center; padding:20px;
      }
      .tt-popup-box{
        background:#0c0802; border:1px solid rgba(201,168,76,.4); border-radius:12px;
        max-width:300px; width:100%; padding:18px; box-shadow:0 0 24px rgba(0,0,0,.6);
      }
      .tt-popup-title{ font-size:14px; font-weight:700; color:#f0d98c; text-align:center; margin-bottom:4px; }
      .tt-popup-sub{ font-size:10.5px; color:#7a6030; text-align:center; margin-bottom:14px; }
      .tt-time-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px; }
      .tt-time-btn{
        padding:10px 6px; border-radius:9px; text-align:center; cursor:pointer;
        font-size:13px; font-weight:700; color:#d6b15f;
        border:1px solid rgba(201,168,76,.3); background:rgba(201,168,76,.08);
        transition:all .15s;
      }
      .tt-time-btn:active{ transform:scale(.96); }
      .tt-time-btn.disabled{
        opacity:.35; cursor:not-allowed; color:#5a5040;
      }
      .tt-breakthrough-btn{
        margin-top:8px; padding:10px; border-radius:9px; text-align:center;
        font-size:12.5px; font-weight:700; color:#80ffb0;
        border:1px solid rgba(80,255,160,.4); background:rgba(80,255,160,.08);
        cursor:pointer;
      }
      .tt-close-btn{
        margin-top:12px; padding:8px; border-radius:9px; text-align:center;
        font-size:11px; color:#9a8a70; border:1px solid rgba(201,168,76,.2);
        cursor:pointer;
      }
    </style>`;
  }

  // Tính vị trí (x,y) của n quả cầu đặt quanh vòng tròn bán kính R
  function ringPositions(count, radius, centerOffset){
    const out = [];
    for(let i=0;i<count;i++){
      const angle = (Math.PI*2 * i / count) - Math.PI/2; // bắt đầu từ trên cùng (12h)
      out.push({
        x: centerOffset + radius*Math.cos(angle),
        y: centerOffset + radius*Math.sin(angle),
      });
    }
    return out;
  }

  // Render toàn bộ vòng tròn + tâm. Trả về HTML string.
  // onSphereClickAttr: tên hàm global JS để gọi onclick (vd "G._ttOpenPopup")
  function renderRing(S, opts){
    opts = opts || {};
    ensureState(S);
    refreshQuest(S, Date.now());
    const attrs = S.linhcanAttrs || [];
    const wrapSize = 280, sphereSize = 60, radius = 96, centerOffset = wrapSize/2;
    const positions = ringPositions(attrs.length, radius, centerOffset);
    const now = Date.now();

    let spheresHTML = "";
    attrs.forEach((attr, i)=>{
      const pos = positions[i];
      const live = getLiveProgress(S, attr, now);
      const st = S.thuocTinh[attr];
      const tierName = TIER_INFO[st.tier].name;
      spheresHTML += `
        <div style="position:absolute; left:${pos.x - sphereSize/2}px; top:${pos.y - sphereSize/2}px;"
             onclick="${opts.onSphereClick ? opts.onSphereClick+"('"+attr+"')" : ""}">
          ${renderSphere(attr, live.percent, sphereSize)}
          <div class="tt-sphere-pct">${live.percent.toFixed(1)}%</div>
          <div class="tt-tier-tag">${tierName}</div>
        </div>`;
    });

    const questRemaining = getQuestRemainingResetSec(S, now);
    const questLine = S.thuocTinhQuestHours > 0
      ? `Quỹ tu luyện: <b style="color:#d6b15f">${S.thuocTinhQuestHours}h</b> / 24h`
      : `Quỹ đã hết — hồi lại sau <b style="color:#ff9090">${fmtHMS(questRemaining)}</b>`;

    return `
      ${getStylesheet()}
      <div class="tt-ring-wrap">
        ${spheresHTML}
        <div class="tt-ring-center" onclick="${opts.onCenterClick||""}">
          <div class="tt-c-title">✨ THUỘC TÍNH</div>
          <div class="tt-c-cta">Tu Luyện<br>Thuộc Tính</div>
        </div>
      </div>
      <div class="tt-quest-bar">${questLine}</div>
    `;
  }

  function fmtHMS(sec){
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    return `${h}h${m}p${s}s`;
  }

  // Render nội dung popup cho 1 thuộc tính (chọn giờ tu luyện hoặc đột phá)
  function renderPopupContent(S, attr, opts){
    opts = opts || {};
    const now = Date.now();
    ensureState(S);
    const st = S.thuocTinh[attr];
    const tierInfo = TIER_INFO[st.tier];
    const live = getLiveProgress(S, attr, now);
    const info = ATTR_INFO[attr];

    let body = "";

    if(live.percent >= 100){
      // Đã viên mãn cấp hiện tại -> hiện nút đột phá
      const isMax = isAtMaxTier(S, attr);
      body = `
        <div style="text-align:center; font-size:12px; color:#80d870; margin-bottom:10px;">
          ✦ ${tierInfo.name} đã viên mãn 100%!
        </div>
        ${isMax ? `
          <div style="text-align:center; font-size:11px; color:#9a8040;">
            Đã đạt Cực Phẩm — cấp tối đa.
          </div>` : `
          <div class="tt-breakthrough-btn" onclick="${opts.onBreakthrough||""}">
            ⚡ Đột Phá Linh Căn → ${TIER_INFO[tierInfo.next].name}
          </div>`}
      `;
    } else {
      const timeButtons = TIME_OPTIONS.map(h=>{
        const disabled = (S.thuocTinhQuestHours < h);
        return `<div class="tt-time-btn ${disabled?"disabled":""}"
                     onclick="${disabled?"":(opts.onPickHour||"")+"("+h+")"}">${h}h</div>`;
      }).join("");

      body = `
        <div style="text-align:center; font-size:11px; color:#9ab0c8; margin-bottom:10px;">
          ${tierInfo.name} · ${live.percent.toFixed(1)}% · ${tierInfo.hoursPerPct}h = +1%
          ${live.isTraining ? `<br><span style="color:#d6b15f">Còn lại: ${fmtHMS(live.remainingSec)}</span>` : ""}
        </div>
        <div class="tt-time-grid">${timeButtons}</div>
        <div style="font-size:9.5px; color:#5a5040; text-align:center;">
          Quỹ còn: ${S.thuocTinhQuestHours}h / 24h
        </div>
      `;
    }

    return `
      <div class="tt-popup-title" style="color:${info.color}">${info.label} · ${tierInfo.name}</div>
      <div class="tt-popup-sub">Tu Luyện Thuộc Tính</div>
      ${body}
      <div class="tt-close-btn" onclick="${opts.onClose||""}">Đóng</div>
    `;
  }

  // ===== EXPORT =====
  window.ThuocTinh = {
    ATTR_INFO, ATTR_ORDER, TIER_INFO, TIER_ORDER,
    QUEST_MAX_HOURS, QUEST_RESET_HOURS, TIME_OPTIONS,
    ensureState, getLiveProgress, isMaxedOut, isAtMaxTier,
    refreshQuest, getQuestRemainingResetSec,
    addTrainingHours, breakthrough,
    calcBonuses,
    renderRing, renderPopupContent, renderSphere,
    fmtHMS,
  };

})();
