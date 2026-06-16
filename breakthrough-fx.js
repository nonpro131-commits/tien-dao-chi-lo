/* =========================================================================
   BreakthroughFX — Hiệu ứng "Vận Công Đột Phá" cho Tiên Đạo Chi Lộ
   ---------------------------------------------------------------------
   Motif: NHẬP ĐỊNH → TỤ KHÍ (bụng, theo THUỘC TÍNH LINH CĂN) → BỘC PHÁT / NỨT VỠ
     - Nhân vật ngồi thiền (PNG line-art) hiện giữa màn hình, mờ dần vào.
     - Mỗi thuộc tính trong S.linhcanAttrs (Kim/Mộc/Thủy/Hỏa/Thổ/Lôi/Ám/Băng)
       được map sang MỘT vòng tròn + một màu riêng, dựng quanh điểm bụng
       (nơi hai tay chồng lên nhau). Có ≥2 thuộc tính → các vòng LỒNG vào
       nhau (bán kính tăng dần) và mỗi vòng tự XOAY quanh bụng theo chiều
       riêng, kèm một tia sáng "sao chổi" chạy theo viền vòng.
     - Lôi: thêm sấm sét tím chớp giật quanh bụng.
     - Ám: thêm một vòng đen (vực tối) mờ chồng lên lõi, hơi hút sáng.
     - Băng: thêm sương mù lạnh (các đốm mờ trắng-lam) bồng bềnh quanh bụng.
     - Thành công: toàn bộ vòng/tia bùng nổ thành sóng ánh sáng theo đúng
       màu thuộc tính (xen kẽ nếu nhiều thuộc tính), lan phủ toàn màn hình,
       nhân vật sáng rực, hiện thông báo thành công.
     - Thất bại: các vòng (đang mang màu thuộc tính) rạn nứt rồi vỡ ra,
       chuyển dần sang đỏ, nhân vật mờ tối đi, rung nhẹ màn hình.

   API:
     window.BreakthroughFX.play(type, success, attrs)
       type    : "minor" | "major"  (tiểu cảnh giới / đại cảnh giới)
       success : true | false
       attrs   : (tuỳ chọn) mảng thuộc tính linh căn, VD S.linhcanAttrs
                 → ["Kim","Hỏa","Thủy"]. Không truyền / rỗng / không hợp lệ
                 → dùng linh khí XANH mặc định như bản gốc.

     window.BreakthroughFX.charge(durationMs, attrs)
       Gọi khi bắt đầu "vận công" — hiện nhân vật + dựng vòng theo attrs.
       Trả về Promise resolve khi tụ khí xong (KHÔNG tự ẩn nhân vật,
       play() sẽ tiếp nối ngay từ trạng thái đã tụ khí + ĐÚNG attrs đó).
       Nếu play() được gọi sau charge() với attrs khác, charge() ưu tiên
       (vì vòng đã dựng lên theo charge); thường nên truyền attrs giống nhau.

   Ảnh nhân vật: đặt cạnh file HTML, tên "character-meditate.png"
   (line-art trắng, nền trong suốt). Có thể đổi qua
   window.BreakthroughFX.setImage(url).

   Tôn trọng prefers-reduced-motion: rút animation về fade đơn giản.
   ========================================================================= */
(function(){
  "use strict";

  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Linh khí mặc định — dùng khi không có / không rõ thuộc tính linh căn,
     giữ đúng màu xanh của bản thiết kế gốc để không phá vỡ FX cũ. */
  const QI_COLOR    = "#3fd0ff";
  const QI_COLOR_2  = "#7af0ff";
  const FAIL_COLOR  = "#ff3b3b";
  const DEFAULT_KEY = "__default";

  /* Màu theo thuộc tính Linh Căn — dùng đúng bảng màu đã dùng xuyên suốt
     game (đối chiếu attrColors2 trong _lcFlashColor() ở file chính) để
     đồng bộ nhận diện màu của từng thuộc tính trong toàn bộ trải nghiệm. */
  const ATTR_COLOR = {
    "Kim":"#f0e080", "Mộc":"#80d870", "Thủy":"#60c8ff", "Hỏa":"#ff8040",
    "Thổ":"#c8a060", "Lôi":"#b0a0ff", "Ám":"#c060e0", "Băng":"#80f0ff"
  };
  const ATTR_GLOW = {
    "Kim":"#fff8da", "Mộc":"#c9ffc0", "Thủy":"#c5f2ff", "Hỏa":"#ffd9b0",
    "Thổ":"#f1dda0", "Lôi":"#e6dcff", "Ám":"#eac2ff", "Băng":"#dffeff"
  };
  const LC_ATTR_ALL = Object.keys(ATTR_COLOR);

  let CHAR_IMG = "character-meditate.png";

  /* Vị trí "bụng" (tâm tụ khí) tính theo % kích thước ảnh nhân vật */
  const BELLY_X_PCT = 50;
  const BELLY_Y_PCT = 76;

  let _layer = null;
  let _styleInjected = false;
  let _charged = false;   // đã hiện nhân vật + tụ khí xong chưa
  let _curAttrs = [DEFAULT_KEY]; // thuộc tính đang "đứng" tại bụng (theo lượt charge/play hiện tại)

  /* ============================ THUỘC TÍNH helpers ======================= */
  function normAttrs(attrs){
    let arr = Array.isArray(attrs) ? attrs.filter(a=>ATTR_COLOR[a]) : [];
    arr = arr.filter((a,i)=>arr.indexOf(a)===i); // bỏ trùng, giữ thứ tự roll
    if(arr.length === 0) arr = [DEFAULT_KEY];
    if(arr.length > 8) arr = arr.slice(0,8);
    return arr;
  }
  function colorOf(a){ return a===DEFAULT_KEY ? QI_COLOR   : (ATTR_COLOR[a] || QI_COLOR); }
  function glowOf(a){  return a===DEFAULT_KEY ? QI_COLOR_2 : (ATTR_GLOW[a]  || QI_COLOR_2); }
  function hasAttr(a){ return _curAttrs.indexOf(a) >= 0; }

  /* Gradient lõi: 1 thuộc tính → lõi sáng đơn màu như cũ.
     Nhiều thuộc tính → lõi chia múi (conic) phối toàn bộ màu, như "ngũ hành quy nhất". */
  function coreGradient(attrs){
    if(attrs.length <= 1){
      const a = attrs[0];
      return `radial-gradient(circle, ${glowOf(a)} 0%, ${colorOf(a)} 55%, transparent 100%)`;
    }
    const n = attrs.length;
    const stops = attrs.map((a,i)=>{
      const c = colorOf(a);
      const from = (i/n*100).toFixed(1), to = ((i+1)/n*100).toFixed(1);
      return `${c} ${from}%, ${c} ${to}%`;
    }).join(", ");
    return `conic-gradient(${stops})`;
  }

  /* ============================== DOM / CSS ============================== */
  function ensureLayer(){
    if(_layer && document.body.contains(_layer)) return _layer;
    _layer = document.createElement("div");
    _layer.id = "btfx-layer";
    _layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(_layer);
    return _layer;
  }

  function injectStyle(){
    if(_styleInjected) return;
    _styleInjected = true;
    const css = document.createElement("style");
    css.id = "btfx-style";
    css.textContent = `
#btfx-layer{position:fixed;inset:0;z-index:4200;pointer-events:none;overflow:hidden;display:flex;align-items:center;justify-content:center;}
.btfx-dim{position:absolute;inset:0;background:#000;opacity:0;}
.btfx-charwrap{position:relative;width:min(58vw,300px);opacity:0;filter:drop-shadow(0 0 0px rgba(63,208,255,0));}
.btfx-char{display:block;width:100%;height:auto;}
.btfx-bellyspot{position:absolute;left:${BELLY_X_PCT}%;top:${BELLY_Y_PCT}%;width:0;height:0;}

/* ===== Tụ Khí: hạt bay vào (màu theo thuộc tính được gán) ===== */
.btfx-qi-particle{
  position:absolute;left:0;top:0;width:5px;height:5px;border-radius:50%;
  background:var(--c2,${QI_COLOR_2});
  box-shadow:0 0 8px 2px var(--c,${QI_COLOR});
  opacity:0;
}

/* ===== Vòng nguyên tố: 1 vòng / 1 thuộc tính, lồng + tự xoay quanh bụng ===== */
.btfx-elem-wrap{position:absolute;left:0;top:0;}
.btfx-elem-ring{
  position:absolute;left:0;top:0;border-radius:50%;
  border:2px dashed var(--c,${QI_COLOR});
  box-shadow:0 0 14px var(--c,${QI_COLOR}), inset 0 0 12px var(--c,${QI_COLOR});
  opacity:0;
}
.btfx-elem-spark{
  position:absolute;width:6px;height:6px;border-radius:50%;left:50%;top:-3px;margin-left:-3px;
  background:var(--c2,${QI_COLOR_2});box-shadow:0 0 10px 3px var(--c,${QI_COLOR});opacity:0;
}
.btfx-qi-core{
  position:absolute;left:0;top:0;border-radius:50%;
  opacity:0;
}

/* ===== Lôi: sấm sét tím quanh bụng ===== */
.btfx-bolt{
  position:absolute;left:0;top:0;height:2px;width:0;transform-origin:0 50%;opacity:0;
  background:linear-gradient(to right, var(--c,#b0a0ff), transparent);
  box-shadow:0 0 8px var(--c,#b0a0ff), 0 0 16px var(--c,#b0a0ff);
}

/* ===== Ám: vòng đen / vực tối phủ lõi ===== */
.btfx-voidring{
  position:absolute;left:0;top:0;border-radius:50%;opacity:0;
  background:radial-gradient(circle, rgba(0,0,0,.85) 0%, rgba(40,0,60,.4) 55%, transparent 100%);
  mix-blend-mode:multiply;
}

/* ===== Băng: sương mù lạnh bồng bềnh ===== */
.btfx-mist{
  position:absolute;left:0;top:0;border-radius:50%;opacity:0;filter:blur(4px);
  background:radial-gradient(circle, rgba(223,254,255,.9) 0%, rgba(128,240,255,.35) 60%, transparent 100%);
}

/* ===== Bộc Phát (success) ===== */
.btfx-flash{position:absolute;inset:0;opacity:0;mix-blend-mode:screen;}
.btfx-burstwave{
  position:absolute;left:0;top:0;border-radius:50%;
  border:3px solid var(--c2,${QI_COLOR_2});
  box-shadow:0 0 30px var(--c,${QI_COLOR});
  opacity:0;
}
.btfx-burstspark{
  position:absolute;left:0;top:0;width:4px;height:4px;border-radius:50%;
  background:#eafffe;box-shadow:0 0 10px 3px var(--c,${QI_COLOR});opacity:0;
}

/* ===== Nứt Vỡ (fail) ===== */
.btfx-crackline{
  position:absolute;left:0;top:0;height:2px;width:0;
  background:linear-gradient(to right, ${FAIL_COLOR}, transparent);
  transform-origin:0 50%;opacity:0;
  box-shadow:0 0 6px ${FAIL_COLOR};
}
.btfx-shard{
  position:absolute;left:0;top:0;width:7px;height:7px;
  background:var(--c,${FAIL_COLOR});opacity:0;
}
.btfx-redflash{position:absolute;inset:0;background:#2a0000;opacity:0;mix-blend-mode:multiply;}
`;
    document.head.appendChild(css);
  }

  function setImage(url){ CHAR_IMG = url; }

  function clearLayer(){
    const layer = ensureLayer();
    layer.innerHTML = "";
    _charged = false;
  }

  function makeEl(cls){
    const el = document.createElement("div");
    el.className = cls;
    return el;
  }

  function setVar(el, a){
    el.style.setProperty("--c",  colorOf(a));
    el.style.setProperty("--c2", glowOf(a));
  }

  function anim(el, keyframes, opts){
    if(REDUCED){
      const last = keyframes[keyframes.length-1];
      return el.animate([{opacity:el.style.opacity||0},{opacity:last.opacity!==undefined?last.opacity:1}],
        {duration:Math.min(opts.duration||300,250), fill:"forwards"});
    }
    return el.animate(keyframes, Object.assign({fill:"forwards"}, opts));
  }

  /* Lấy (hoặc tạo) khung nhân vật + điểm bụng hiện tại trong layer */
  function getCharWrap(layer){
    let wrap = layer.querySelector(".btfx-charwrap");
    if(wrap) return wrap;
    wrap = makeEl("btfx-charwrap");
    const img = document.createElement("img");
    img.className = "btfx-char";
    img.src = CHAR_IMG;
    img.alt = "";
    wrap.appendChild(img);
    const belly = makeEl("btfx-bellyspot");
    wrap.appendChild(belly);
    layer.appendChild(wrap);
    return wrap;
  }

  /* ====================== Dựng vòng nguyên tố tại bụng ==================== */
  /* Mỗi thuộc tính = 1 vòng dashed lồng (bán kính tăng theo index), tự xoay
     quanh bụng (chiều xen kẽ), có 1 tia sáng chạy theo viền. Trả về {ring,spark}[] */
  function buildElemRings(belly, attrs, baseR, stepR){
    const out = [];
    attrs.forEach((a,i)=>{
      const r = baseR + i*stepR;
      const ring = makeEl("btfx-elem-ring");
      setVar(ring, a);
      belly.appendChild(ring);
      ring.style.width = r*2+"px"; ring.style.height = r*2+"px";
      ring.style.marginLeft = (-r)+"px"; ring.style.marginTop = (-r)+"px";

      const spark = makeEl("btfx-elem-spark");
      setVar(spark, a);
      ring.appendChild(spark);

      out.push({ring, spark, r, attr:a, dir:(i%2===0?1:-1)});
    });
    return out;
  }

  function spinElemRings(rings, opts){
    const cont = (opts && opts.continuous) !== false;
    rings.forEach((o,i)=>{
      const speed = 3200 + i*650;            // vòng ngoài quay chậm hơn 1 chút
      const deg = 360 * o.dir;
      if(!REDUCED){
        o.ring.animate(
          [{transform:"rotate(0deg)"},{transform:`rotate(${deg}deg)`}],
          {duration:speed, iterations:cont?Infinity:1, easing:"linear"}
        );
      }
    });
  }

  /* ============================= Lôi / Ám / Băng ========================= */
  function spawnBolts(belly, count, opts){
    if(REDUCED) return;
    opts = opts || {};
    const baseDelay = opts.baseDelay || 0;
    const repeat = opts.repeat || 1;
    for(let rep=0; rep<repeat; rep++){
      for(let i=0;i<count;i++){
        const bolt = makeEl("btfx-bolt");
        bolt.style.setProperty("--c", "#b0a0ff");
        belly.appendChild(bolt);
        const rot = Math.random()*360;
        const len = (opts.minLen||16) + Math.random()*(opts.maxLen||34);
        bolt.style.transform = `rotate(${rot}deg)`;
        const delay = baseDelay + rep*(opts.gapMs||260) + Math.random()*120;
        anim(bolt, [
          {opacity:0, width:"0px"},
          {opacity:1, width:len+"px", offset:.3},
          {opacity:0, width:(len*1.1)+"px"},
        ], {duration:180+Math.random()*120, delay, easing:"ease-out"});
      }
    }
  }

  function spawnVoidRing(belly, opts){
    opts = opts || {};
    const ring = makeEl("btfx-voidring");
    belly.appendChild(ring);
    const r = opts.r || 30;
    ring.style.width = r*2+"px"; ring.style.height = r*2+"px";
    ring.style.marginLeft = (-r)+"px"; ring.style.marginTop = (-r)+"px";
    anim(ring, opts.keyframes || [
      {opacity:0, transform:"scale(.6)"},
      {opacity:.85, transform:"scale(1)", offset:.5},
      {opacity:.6, transform:"scale(.92)"},
    ], {duration:opts.duration||1400, delay:opts.delay||0, easing:"ease-in-out", iterations:opts.iterations||1});
    return ring;
  }

  function spawnMist(belly, count, opts){
    if(REDUCED) return;
    opts = opts || {};
    for(let i=0;i<count;i++){
      const m = makeEl("btfx-mist");
      belly.appendChild(m);
      const size = (opts.minSize||30) + Math.random()*(opts.maxSize||40);
      const angle = Math.random()*Math.PI*2;
      const dist = 18 + Math.random()*46;
      const dx = Math.cos(angle)*dist, dy = Math.sin(angle)*dist*0.6 - 10;
      m.style.width = size+"px"; m.style.height = size+"px";
      m.style.marginLeft = (-size/2)+"px"; m.style.marginTop = (-size/2)+"px";
      const delay = (opts.baseDelay||0) + Math.random()*400;
      anim(m, [
        {opacity:0, transform:`translate(${dx*.3}px,${dy*.3-6}px) scale(.7)`},
        {opacity:opts.peak||.55, transform:`translate(${dx}px,${dy}px) scale(1)`, offset:.5},
        {opacity:0, transform:`translate(${dx*1.4}px,${dy*1.6-16}px) scale(1.15)`},
      ], {duration:opts.duration||2200, delay, easing:"ease-in-out"});
    }
  }

  /* =========================== TỤ KHÍ (charge) ========================= */
  function charge(durationMs, attrs){
    injectStyle();
    const layer = ensureLayer();
    clearLayer();
    const dur = durationMs || 1600;
    _curAttrs = normAttrs(attrs);
    const A = _curAttrs;

    const dim = makeEl("btfx-dim");
    layer.appendChild(dim);
    anim(dim, [{opacity:0},{opacity:.55}], {duration:dur*.4, easing:"ease-out"});

    const wrap = getCharWrap(layer);
    anim(wrap, [
      {opacity:0, transform:"scale(.92)"},
      {opacity:1, transform:"scale(1)"},
    ], {duration:dur*.5, easing:"cubic-bezier(.2,.8,.3,1)"});

    const belly = wrap.querySelector(".btfx-bellyspot");

    // Vòng nguyên tố: 1 vòng / thuộc tính, lồng dần lớn dần rồi ổn định, sau đó tự xoay
    const baseR = 22, stepR = 9;
    const rings = buildElemRings(belly, A, baseR, stepR);
    rings.forEach((o,i)=>{
      anim(o.ring, [
        {opacity:0, transform:"scale(0)"},
        {opacity:.9, transform:"scale(1.08)", offset:.7},
        {opacity:1, transform:"scale(1)"},
      ], {duration:dur*.9, delay:dur*.15 + i*40, easing:"cubic-bezier(.2,.8,.3,1)"});
      anim(o.spark, [{opacity:0},{opacity:1}], {duration:300, delay:dur*.7});
    });
    spinElemRings(rings);

    // Lõi sáng ở giữa (đơn màu nếu 1 thuộc tính, chia múi ngũ hành nếu nhiều)
    const core = makeEl("btfx-qi-core");
    belly.appendChild(core);
    core.style.background = coreGradient(A);
    anim(core, [
      {opacity:0, width:"0px", height:"0px", marginLeft:"0px", marginTop:"0px"},
      {opacity:.95, width:"26px", height:"26px", marginLeft:"-13px", marginTop:"-13px"},
    ], {duration:dur*.8, delay:dur*.25, easing:"ease-out"});

    // Hạt linh khí bay từ ngoài vào tâm bụng — màu rải đều theo từng thuộc tính
    const particleCount = REDUCED ? 0 : 26;
    for(let i=0;i<particleCount;i++){
      const p = makeEl("btfx-qi-particle");
      setVar(p, A[i % A.length]);
      belly.appendChild(p);
      const angle = Math.random()*Math.PI*2;
      const dist = 160 + Math.random()*220;
      const startX = Math.cos(angle)*dist, startY = Math.sin(angle)*dist - 40; // hơi lệch lên (từ không gian quanh nhân vật)
      const delay = Math.random()*dur*.55;
      anim(p, [
        {opacity:0, transform:`translate(${startX}px,${startY}px) scale(1)`},
        {opacity:1, offset:.25},
        {opacity:.9, transform:"translate(0px,0px) scale(.3)"},
      ], {duration: dur - delay*.3, delay, easing:"cubic-bezier(.2,.6,.4,1)"});
    }

    // Đặc tả riêng theo thuộc tính hiếm
    if(hasAttr("Lôi")) spawnBolts(belly, 3, {baseDelay:dur*.35, repeat:3, gapMs:dur*.18, minLen:14, maxLen:30});
    if(hasAttr("Ám"))  spawnVoidRing(belly, {r:26, delay:dur*.3, duration:dur*.8, iterations:Infinity});
    if(hasAttr("Băng")) spawnMist(belly, 5, {baseDelay:dur*.3, duration:dur*1.3, peak:.5});

    _charged = true;
    return new Promise(resolve=>{ setTimeout(resolve, dur); });
  }

  /* =========================== BỘC PHÁT (success) ======================= */
  function successFX(big, attrs){
    injectStyle();
    const layer = ensureLayer();
    const A = _charged ? _curAttrs : normAttrs(attrs);
    _curAttrs = A;

    // Nếu chưa charge trước đó (gọi play() độc lập), tạo nhanh tư thế đã tụ khí
    if(!_charged){
      clearLayer();
      _curAttrs = A;
      const dim = makeEl("btfx-dim"); layer.appendChild(dim);
      dim.style.opacity = ".55";
      const wrap = getCharWrap(layer);
      wrap.style.opacity = "1"; wrap.style.transform = "scale(1)";
      const belly = wrap.querySelector(".btfx-bellyspot");
      const rings = buildElemRings(belly, A, 22, 9);
      rings.forEach(o=>{ o.ring.style.opacity="1"; o.spark.style.opacity="1"; });
      spinElemRings(rings);
      const core = makeEl("btfx-qi-core"); belly.appendChild(core);
      core.style.background = coreGradient(A);
      core.style.cssText += "opacity:.95;width:26px;height:26px;margin-left:-13px;margin-top:-13px;";
      if(hasAttr("Ám")) spawnVoidRing(belly, {r:26, duration:1, iterations:1, keyframes:[{opacity:.7},{opacity:.7}]});
      if(hasAttr("Băng")) spawnMist(belly, 3, {baseDelay:0, duration:1600, peak:.45});
    }

    const wrap = layer.querySelector(".btfx-charwrap");
    const belly = wrap.querySelector(".btfx-bellyspot");
    const dim = layer.querySelector(".btfx-dim");

    // Toàn bộ vòng nguyên tố bùng nổ — co mạnh rồi nổ tung, giữ đúng màu thuộc tính
    const ringEls  = belly.querySelectorAll(".btfx-elem-ring");
    const sparkEls = belly.querySelectorAll(".btfx-elem-spark");
    ringEls.forEach((ring,i)=>{
      const r = 22 + i*9;
      anim(ring, [
        {opacity:1, transform:`scale(1)`},
        {opacity:1, transform:`scale(.62)`, offset:.18},
        {opacity:0, transform:`scale(${(r+26)/r})`},
      ], {duration:380+i*30, easing:"cubic-bezier(.4,0,.6,1)"});
    });
    sparkEls.forEach(s=> anim(s, [{opacity:1},{opacity:0}], {duration:300, easing:"ease-out"}));
    const core = belly.querySelector(".btfx-qi-core");
    if(core) anim(core, [
      {opacity:.95, width:"26px", height:"26px", marginLeft:"-13px", marginTop:"-13px"},
      {opacity:1, width:"16px", height:"16px", marginLeft:"-8px", marginTop:"-8px", offset:.18},
      {opacity:0, width:"10px", height:"10px", marginLeft:"-5px", marginTop:"-5px"},
    ], {duration:350, easing:"cubic-bezier(.4,0,.6,1)"});

    // Flash phủ toàn màn hình — 1 thuộc tính: màu đặc; nhiều thuộc tính: dải ngũ hành
    const flash = makeEl("btfx-flash");
    layer.appendChild(flash);
    flash.style.background = A.length>1
      ? `conic-gradient(${A.map((a,i)=>`${colorOf(a)} ${(i/A.length*100).toFixed(1)}%, ${colorOf(a)} ${((i+1)/A.length*100).toFixed(1)}%`).join(", ")})`
      : colorOf(A[0]);
    anim(flash, [{opacity:0},{opacity:big?.95:.8, offset:.22},{opacity:0}], {duration:big?1300:950, delay:300});

    // Vòng sóng ánh sáng lan tỏa từ bụng — màu xen kẽ theo từng thuộc tính
    const waveCount = (big ? 4 : 2) * A.length;
    for(let i=0;i<waveCount;i++){
      const a = A[i % A.length];
      const wave = makeEl("btfx-burstwave");
      setVar(wave, a);
      belly.appendChild(wave);
      const delay = 320 + i*(big?80:110);
      const maxSize = (big? 2600:1900) * (1 + (i%A.length)*0.1);
      anim(wave, [
        {opacity:.95, width:"20px", height:"20px", marginLeft:"-10px", marginTop:"-10px", borderWidth:"4px"},
        {opacity:.6, offset:.4},
        {opacity:0, width:maxSize+"px", height:maxSize+"px", marginLeft:(-maxSize/2)+"px", marginTop:(-maxSize/2)+"px", borderWidth:"1px"},
      ], {duration:(big?1700:1300), delay, easing:"cubic-bezier(.1,.6,.3,1)"});
    }

    // Hạt sáng bung ra khắp màn hình — màu rải theo thuộc tính
    const sparkCount = REDUCED ? 0 : (big?40:24);
    for(let i=0;i<sparkCount;i++){
      const s = makeEl("btfx-burstspark");
      setVar(s, A[i % A.length]);
      belly.appendChild(s);
      const angle = Math.random()*Math.PI*2;
      const dist = (big?320:200) + Math.random()*(big?320:240);
      const dx = Math.cos(angle)*dist, dy = Math.sin(angle)*dist;
      const delay = 320 + Math.random()*250;
      anim(s, [
        {opacity:0, transform:"translate(0,0) scale(.6)"},
        {opacity:1, offset:.15, transform:"translate(0,0) scale(1.6)"},
        {opacity:0, transform:`translate(${dx}px,${dy}px) scale(.3)`},
      ], {duration:(big?1200:900)+Math.random()*300, delay, easing:"cubic-bezier(.1,.7,.3,1)"});
    }

    // Đặc tả riêng theo thuộc tính hiếm — bùng mạnh hơn lúc charge
    if(hasAttr("Lôi")) spawnBolts(belly, big?6:4, {baseDelay:280, repeat:2, gapMs:160, minLen:30, maxLen:70});
    if(hasAttr("Ám")){
      spawnVoidRing(belly, {
        r:30, delay:300, duration:700, iterations:1,
        keyframes:[
          {opacity:.75, transform:"scale(1)"},
          {opacity:.9, transform:"scale(1.6)", offset:.4},
          {opacity:0, transform:"scale(2.4)"},
        ]
      });
    }
    if(hasAttr("Băng")) spawnMist(belly, big?10:6, {baseDelay:300, duration:big?1700:1300, peak:.7, maxSize:60});

    // Nhân vật sáng rực lên rồi giữ một nhịp — drop-shadow xếp theo từng thuộc tính
    const dShadow = (size, op) => A.map(a=>`drop-shadow(0 0 ${size}px ${hexToRgba(colorOf(a), op)})`).join(" ");
    if(wrap) anim(wrap, [
      {filter:"drop-shadow(0 0 0px rgba(0,0,0,0))"},
      {filter:dShadow(big?34:22, .9), offset:.3},
      {filter:dShadow(big?18:11, .55)},
    ], {duration:big?1700:1200, delay:280, easing:"ease-out"});

    // Phông nền tối tan dần để lộ ánh sáng nguyên tố chiếm toàn cảnh
    if(dim) anim(dim, [{opacity:.55},{opacity:0}], {duration:600, delay:300});

    const total = big ? 2300 : 1700;
    setTimeout(clearLayer, total + 200);
  }

  function hexToRgba(hex, a){
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if(!m) return hex;
    const r = parseInt(m[1],16), g = parseInt(m[2],16), b = parseInt(m[3],16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* =========================== NỨT VỠ (fail) ============================ */
  function failFX(attrs){
    injectStyle();
    const layer = ensureLayer();
    const A = _charged ? _curAttrs : normAttrs(attrs);
    _curAttrs = A;

    if(!_charged){
      clearLayer();
      _curAttrs = A;
      const dim = makeEl("btfx-dim"); layer.appendChild(dim);
      dim.style.opacity = ".55";
      const wrap = getCharWrap(layer);
      wrap.style.opacity = "1"; wrap.style.transform = "scale(1)";
      const belly = wrap.querySelector(".btfx-bellyspot");
      const rings = buildElemRings(belly, A, 22, 9);
      rings.forEach(o=>{ o.ring.style.opacity="1"; o.spark.style.opacity="1"; });
      spinElemRings(rings);
      const core = makeEl("btfx-qi-core"); belly.appendChild(core);
      core.style.background = coreGradient(A);
      core.style.cssText += "opacity:.95;width:26px;height:26px;margin-left:-13px;margin-top:-13px;";
    }

    const wrap = layer.querySelector(".btfx-charwrap");
    const belly = wrap.querySelector(".btfx-bellyspot");
    const ringEls = belly.querySelectorAll(".btfx-elem-ring");
    const core = belly.querySelector(".btfx-qi-core");

    // Rung màn hình
    if(!REDUCED){
      const body = document.body;
      const prevTransform = body.style.transform;
      const shakeFrames = 10, shakeKeys = [];
      for(let i=0;i<=shakeFrames;i++){
        const amt = (1-i/shakeFrames);
        shakeKeys.push({transform:`translate(${(Math.random()*2-1)*7*amt}px, ${(Math.random()*2-1)*5*amt}px)`});
      }
      shakeKeys.push({transform:"translate(0,0)"});
      body.animate(shakeKeys, {duration:420, delay:280, easing:"linear"});
      setTimeout(()=>{ body.style.transform = prevTransform; }, 710);
    }

    // Mỗi vòng nguyên tố rạn nứt từ màu thuộc tính của nó rồi vỡ ra thành đỏ
    ringEls.forEach((ring,i)=>{
      const a = A[i] || A[A.length-1];
      anim(ring, [
        {opacity:1, transform:"scale(1)", borderColor:colorOf(a)},
        {opacity:1, transform:"scale(.92)", borderColor:FAIL_COLOR, offset:.4},
        {opacity:0, transform:"scale(1.5)", borderColor:FAIL_COLOR},
      ], {duration:650, delay:150+i*40, easing:"cubic-bezier(.4,0,.5,1)"});
    });
    if(core){
      anim(core, [
        {opacity:.95},
        {opacity:.8, background:`radial-gradient(circle, #ffb0b0 0%, ${FAIL_COLOR} 55%, transparent 100%)`, offset:.4},
        {opacity:0},
      ], {duration:650, delay:150, easing:"cubic-bezier(.4,0,.5,1)"});
    }

    // Vết nứt toả ra từ tâm vòng tròn
    const crackCount = REDUCED ? 0 : 8;
    for(let i=0;i<crackCount;i++){
      const crack = makeEl("btfx-crackline");
      belly.appendChild(crack);
      const rot = Math.random()*360;
      const len = 26 + Math.random()*46;
      crack.style.transform = `rotate(${rot}deg)`;
      const delay = 180 + Math.random()*140;
      anim(crack, [
        {opacity:0, width:"0px"},
        {opacity:.95, width:len+"px", offset:.35},
        {opacity:0, width:len+"px"},
      ], {duration:520, delay, easing:"ease-out"});
    }

    // Lôi: tia chớp giật lụi tàn bất thường ngay khi vòng vỡ
    if(hasAttr("Lôi")) spawnBolts(belly, 4, {baseDelay:160, repeat:1, minLen:18, maxLen:40});
    // Ám: vực tối siết lại rồi sụp xuống cùng lúc vòng vỡ
    if(hasAttr("Ám")) spawnVoidRing(belly, {
      r:26, delay:180, duration:600, iterations:1,
      keyframes:[{opacity:.6, transform:"scale(1)"},{opacity:.9, transform:"scale(.6)", offset:.6},{opacity:0, transform:"scale(.2)"}]
    });
    // Băng: mảnh vỡ mang ánh băng nhạt thay vì đỏ thuần
    const shardCount = REDUCED ? 0 : 20;
    const icy = hasAttr("Băng");
    for(let i=0;i<shardCount;i++){
      const sh = makeEl("btfx-shard");
      sh.style.setProperty("--c", icy && i%2===0 ? "#bff3ff" : FAIL_COLOR);
      belly.appendChild(sh);
      const angle = Math.random()*Math.PI*2;
      const dist = 70 + Math.random()*180;
      const dx = Math.cos(angle)*dist, dy = Math.sin(angle)*dist;
      const rot = Math.random()*720-360;
      const delay = 220 + Math.random()*150;
      anim(sh, [
        {opacity:0, transform:"translate(0,0) rotate(0deg) scale(1)"},
        {opacity:1, offset:.15},
        {opacity:0, transform:`translate(${dx}px,${dy}px) rotate(${rot}deg) scale(.2)`},
      ], {duration:650+Math.random()*200, delay, easing:"cubic-bezier(.3,.6,.4,1)"});
    }

    // Flash đỏ-tối phủ nhanh
    const redflash = makeEl("btfx-redflash");
    layer.appendChild(redflash);
    anim(redflash, [{opacity:0},{opacity:.5, offset:.25},{opacity:0}], {duration:600, delay:150});

    // Nhân vật mờ tối dần đi (mất linh khí)
    if(wrap) anim(wrap, [
      {opacity:1, filter:"brightness(1) drop-shadow(0 0 0px transparent)"},
      {opacity:.55, filter:"brightness(.55) drop-shadow(0 0 10px rgba(255,59,59,.5))"},
    ], {duration:700, delay:200, easing:"ease-out"});

    setTimeout(clearLayer, 1100);
  }

  /* =============================== PUBLIC API ============================ */
  function play(type, success, attrs){
    if(success){
      successFX(type === "major", attrs);
    } else {
      failFX(attrs);
    }
  }

  window.BreakthroughFX = { play, charge, setImage, LC_ATTR_ALL };
})();
