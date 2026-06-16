/* =========================================================================
   BreakthroughFX — Hiệu ứng "Vận Công Đột Phá" cho Tiên Đạo Chi Lộ
   ---------------------------------------------------------------------
   Motif: TỤ KHÍ → BỘC PHÁT
     - charge   : vòng linh khí hội tụ vào trung tâm khi đang "vận công"
     - success  : vòng sóng ánh sáng bộc phát theo màu cảnh giới + chữ Hán
     - bigSuccess: như success nhưng mạnh hơn (đại cảnh giới — đổi realm)
     - fail     : vòng năng lượng vỡ vụn, rung màn hình, vết nứt đỏ lan ra

   API:
     window.BreakthroughFX.play(type, success, stageColor)
       type        : "minor" | "major"  (tiểu cảnh giới / đại cảnh giới)
       success     : true | false
       stageColor  : mã màu hex theo cảnh giới (dùng biến _sc1 có sẵn)

     window.BreakthroughFX.charge(durationMs, stageColor)
       Gọi khi bắt đầu "vận công" (trước khi biết kết quả roll), trả về
       một Promise resolve khi animation tụ khí kết thúc. Tuỳ chọn — nếu
       không gọi, play() vẫn chạy độc lập với hiệu ứng bộc phát/vỡ vụn.

   Tôn trọng prefers-reduced-motion: rút animation về fade đơn giản.
   ========================================================================= */
(function(){
  "use strict";

  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- chữ Hán theo ngữ cảnh ---- */
  const HANZI = {
    success:    "破",   // Phá — phá vỡ giới hạn
    bigSuccess: "境",   // Cảnh — cảnh giới mới
    fail:       "殘"    // Tàn — tổn hại, chưa thành
  };

  let _layer = null;
  let _styleInjected = false;

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
#btfx-layer{position:fixed;inset:0;z-index:4200;pointer-events:none;overflow:hidden;}
.btfx-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center, transparent 55%, var(--bc,#f0c14b) 150%);opacity:0;mix-blend-mode:screen;}
.btfx-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);}

/* ===== Tụ Khí (charge) ===== */
.btfx-charge-ring{
  position:absolute;left:50%;top:50%;width:14px;height:14px;border-radius:50%;
  border:2px solid var(--bc,#f0c14b);
  box-shadow:0 0 16px var(--bc,#f0c14b);
  opacity:0;
}
.btfx-charge-particle{
  position:absolute;left:50%;top:50%;width:4px;height:4px;border-radius:50%;
  background:var(--bc,#f0c14b);
  box-shadow:0 0 6px 1px var(--bc,#f0c14b);
  opacity:0;
}
.btfx-core{
  position:absolute;left:50%;top:50%;width:10px;height:10px;border-radius:50%;
  transform:translate(-50%,-50%);
  background:var(--bc,#f0c14b);
  box-shadow:0 0 0 0 var(--bc,#f0c14b);
  opacity:0;
}

/* ===== Bộc Phát (success) ===== */
.btfx-wave{
  position:absolute;left:50%;top:50%;width:10px;height:10px;border-radius:50%;
  transform:translate(-50%,-50%);
  border:2px solid var(--bc,#f0c14b);
  opacity:0;
}
.btfx-flash{
  position:absolute;inset:0;background:var(--bc,#f0c14b);opacity:0;mix-blend-mode:screen;
}
.btfx-hanzi{
  position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.4);
  font-size:min(22vw,180px);font-weight:900;color:var(--bc,#f0c14b);
  text-shadow:0 0 30px var(--bc,#f0c14b),0 0 70px var(--bc,#f0c14b);
  opacity:0;font-family:"Noto Serif SC","Songti SC",serif;
  letter-spacing:0;
}
.btfx-ray{
  position:absolute;left:50%;top:50%;width:2px;height:46vmax;
  transform-origin:50% 0;
  background:linear-gradient(to bottom, var(--bc,#f0c14b), transparent 70%);
  opacity:0;
}
.btfx-spark{
  position:absolute;left:50%;top:50%;width:3px;height:3px;border-radius:50%;
  background:#fff8e0;box-shadow:0 0 8px 2px var(--bc,#f0c14b);opacity:0;
}

/* ===== Thất Bại (fail) ===== */
.btfx-crack{
  position:absolute;left:50%;top:50%;height:2px;width:0;
  background:linear-gradient(to right, #ff3030, transparent);
  transform-origin:0 50%;opacity:0;
  box-shadow:0 0 6px #ff3030;
}
.btfx-shatter{
  position:absolute;left:50%;top:50%;width:8px;height:8px;
  background:#ff4040;opacity:0;
}
.btfx-redflash{
  position:absolute;inset:0;background:#3a0000;opacity:0;mix-blend-mode:multiply;
}

@keyframes btfx-fadein{ from{opacity:0} to{opacity:1} }
`;
    document.head.appendChild(css);
  }

  function clearLayer(){
    const layer = ensureLayer();
    layer.innerHTML = "";
  }

  function makeEl(cls){
    const el = document.createElement("div");
    el.className = cls;
    return el;
  }

  /* anim() — wrapper animate() ngắn gọn, tự bỏ qua nếu reduced-motion (rút về fade) */
  function anim(el, keyframes, opts){
    if(REDUCED){
      // rút animation về 1 fade đơn giản, giữ trạng thái cuối
      const last = keyframes[keyframes.length-1];
      return el.animate([{opacity:el.style.opacity||0},{opacity:last.opacity!==undefined?last.opacity:1}],
        {duration:Math.min(opts.duration||300,250), fill:"forwards"});
    }
    return el.animate(keyframes, Object.assign({fill:"forwards"}, opts));
  }

  /* =========================== TỤ KHÍ (charge) ========================= */
  function charge(durationMs, stageColor){
    injectStyle();
    const layer = ensureLayer();
    clearLayer();
    layer.style.setProperty("--bc", stageColor || "#f0c14b");
    const dur = durationMs || 1400;

    const vignette = makeEl("btfx-vignette");
    layer.appendChild(vignette);
    anim(vignette, [{opacity:0},{opacity:.35}], {duration:dur*.5, easing:"ease-out"});

    const core = makeEl("btfx-core");
    layer.appendChild(core);
    anim(core, [
      {opacity:0, transform:"translate(-50%,-50%) scale(.5)"},
      {opacity:1, transform:"translate(-50%,-50%) scale(1)", boxShadow:`0 0 24px 8px ${stageColor||"#f0c14b"}`},
    ], {duration:dur, easing:"cubic-bezier(.3,.7,.4,1)"});

    // Vòng năng lượng co lại dần — cảm giác "hút khí vào trong"
    const ringCount = REDUCED ? 0 : 3;
    for(let i=0;i<ringCount;i++){
      const ring = makeEl("btfx-charge-ring");
      layer.appendChild(ring);
      const delay = i * (dur/ringCount) * .55;
      const startSize = 220 - i*30;
      anim(ring, [
        {opacity:0, width:startSize+"px", height:startSize+"px", marginLeft:(-startSize/2)+"px", marginTop:(-startSize/2)+"px"},
        {opacity:.8, offset:.15},
        {opacity:0, width:"10px", height:"10px", marginLeft:"-5px", marginTop:"-5px"},
      ], {duration:dur*.85, delay, easing:"cubic-bezier(.5,0,.85,.4)"});
    }

    // Hạt linh khí bay vào tâm theo vòng tròn ngẫu nhiên
    const particleCount = REDUCED ? 0 : 18;
    for(let i=0;i<particleCount;i++){
      const p = makeEl("btfx-charge-particle");
      layer.appendChild(p);
      const angle = Math.random()*Math.PI*2;
      const dist = 130 + Math.random()*160;
      const startX = Math.cos(angle)*dist, startY = Math.sin(angle)*dist;
      const delay = Math.random()*dur*.6;
      anim(p, [
        {opacity:0, transform:`translate(${startX}px,${startY}px) scale(1)`},
        {opacity:1, offset:.2},
        {opacity:.9, transform:"translate(0px,0px) scale(.3)"},
      ], {duration: dur - delay*.4, delay, easing:"cubic-bezier(.2,.6,.4,1)"});
    }

    return new Promise(resolve=>{
      setTimeout(resolve, dur);
    });
  }

  /* =========================== BỘC PHÁT (success) ======================= */
  function successFX(big, stageColor){
    injectStyle();
    const layer = ensureLayer();
    clearLayer();
    const color = stageColor || "#f0c14b";
    layer.style.setProperty("--bc", color);
    const scale = big ? 1.45 : 1;

    // Flash trắng-vàng chớp nhanh tại thời điểm bộc phát
    const flash = makeEl("btfx-flash");
    layer.appendChild(flash);
    anim(flash, [{opacity:0},{opacity:.55,offset:.12},{opacity:0}], {duration:(big?650:420)});

    // Vòng sóng lan tỏa (nhiều lớp cho bigSuccess)
    const waveCount = big ? 4 : 2;
    for(let i=0;i<waveCount;i++){
      const wave = makeEl("btfx-wave");
      layer.appendChild(wave);
      const delay = i*120;
      const maxSize = (big? 1700:1100) * (1 + i*0.12);
      anim(wave, [
        {opacity:.95, width:"10px", height:"10px", marginLeft:"-5px", marginTop:"-5px", borderWidth:"3px"},
        {opacity:.5, offset:.4},
        {opacity:0, width:maxSize+"px", height:maxSize+"px", marginLeft:(-maxSize/2)+"px", marginTop:(-maxSize/2)+"px", borderWidth:"1px"},
      ], {duration:(big?1500:1100), delay, easing:"cubic-bezier(.1,.6,.3,1)"});
    }

    // Tia sáng tỏa quanh tâm (rays) — chỉ cho bigSuccess, cảm giác "khai mở cảnh giới"
    if(big && !REDUCED){
      const rayCount = 10;
      for(let i=0;i<rayCount;i++){
        const ray = makeEl("btfx-ray");
        layer.appendChild(ray);
        const rot = (360/rayCount)*i + (Math.random()*10-5);
        ray.style.transform = `translate(-50%,0) rotate(${rot}deg)`;
        anim(ray, [
          {opacity:0, height:"0vmax"},
          {opacity:.7, height:"46vmax", offset:.3},
          {opacity:0, height:"50vmax"},
        ], {duration:1300, delay: i*20, easing:"ease-out"});
      }
    }

    // Hạt sáng bung ra
    const sparkCount = REDUCED ? 0 : (big?34:20);
    for(let i=0;i<sparkCount;i++){
      const s = makeEl("btfx-spark");
      layer.appendChild(s);
      const angle = Math.random()*Math.PI*2;
      const dist = (big?260:160) + Math.random()*(big?260:160);
      const dx = Math.cos(angle)*dist, dy = Math.sin(angle)*dist;
      const delay = Math.random()*200;
      anim(s, [
        {opacity:0, transform:"translate(0,0) scale(.5)"},
        {opacity:1, offset:.15, transform:"translate(0,0) scale(1.4)"},
        {opacity:0, transform:`translate(${dx}px,${dy}px) scale(.4)`},
      ], {duration:(big?1100:800)+Math.random()*300, delay, easing:"cubic-bezier(.1,.7,.3,1)"});
    }

    // Chữ Hán lóe lên giữa tâm
    const hanzi = makeEl("btfx-hanzi");
    hanzi.textContent = big ? HANZI.bigSuccess : HANZI.success;
    layer.appendChild(hanzi);
    anim(hanzi, [
      {opacity:0, transform:`translate(-50%,-50%) scale(${.3*scale})`},
      {opacity:1, transform:`translate(-50%,-50%) scale(${1.05*scale})`, offset:.28},
      {opacity:1, transform:`translate(-50%,-50%) scale(${.95*scale})`, offset:.7},
      {opacity:0, transform:`translate(-50%,-50%) scale(${.85*scale})`},
    ], {duration:big?1900:1300, easing:"cubic-bezier(.2,.8,.3,1)"});

    const total = big ? 2000 : 1400;
    setTimeout(clearLayer, total + 80);
  }

  /* =========================== VỠ VỤN (fail) ============================ */
  function failFX(){
    injectStyle();
    const layer = ensureLayer();
    clearLayer();
    layer.style.setProperty("--bc", "#ff3030");

    // Rung màn hình (áp vào <body> qua transform, không ảnh hưởng layout vì translate)
    if(!REDUCED){
      const body = document.body;
      const prevTransform = body.style.transform;
      const shakeKeys = [];
      const shakeFrames = 10;
      for(let i=0;i<=shakeFrames;i++){
        const amt = (1-i/shakeFrames);
        shakeKeys.push({transform:`translate(${(Math.random()*2-1)*8*amt}px, ${(Math.random()*2-1)*6*amt}px)`});
      }
      shakeKeys.push({transform:"translate(0,0)"});
      body.animate(shakeKeys, {duration:420, easing:"linear"});
      setTimeout(()=>{ body.style.transform = prevTransform; }, 430);
    }

    // Flash đỏ-tối phủ nhanh
    const redflash = makeEl("btfx-redflash");
    layer.appendChild(redflash);
    anim(redflash, [{opacity:0},{opacity:.5,offset:.18},{opacity:0}], {duration:650});

    // Vòng năng lượng vỡ — co rồi bung vỡ thành mảnh
    const ring = makeEl("btfx-wave");
    ring.style.borderColor = "#ff3030";
    layer.appendChild(ring);
    anim(ring, [
      {opacity:.9, width:"160px", height:"160px", marginLeft:"-80px", marginTop:"-80px", borderWidth:"4px"},
      {opacity:1, width:"40px", height:"40px", marginLeft:"-20px", marginTop:"-20px", borderWidth:"6px", offset:.35},
      {opacity:0, width:"500px", height:"500px", marginLeft:"-250px", marginTop:"-250px", borderWidth:"1px"},
    ], {duration:750, easing:"cubic-bezier(.4,0,.5,1)"});

    // Mảnh vỡ bắn ra
    const shardCount = REDUCED ? 0 : 22;
    for(let i=0;i<shardCount;i++){
      const sh = makeEl("btfx-shatter");
      layer.appendChild(sh);
      const angle = Math.random()*Math.PI*2;
      const dist = 120 + Math.random()*240;
      const dx = Math.cos(angle)*dist, dy = Math.sin(angle)*dist;
      const rot = Math.random()*720-360;
      const delay = 150 + Math.random()*120;
      anim(sh, [
        {opacity:0, transform:"translate(0,0) rotate(0deg) scale(1)"},
        {opacity:1, offset:.12},
        {opacity:0, transform:`translate(${dx}px,${dy}px) rotate(${rot}deg) scale(.2)`},
      ], {duration:700+Math.random()*200, delay, easing:"cubic-bezier(.3,.6,.4,1)"});
    }

    // Vết nứt đỏ lan ra từ tâm (đường kẻ xoay góc ngẫu nhiên)
    const crackCount = REDUCED ? 0 : 7;
    for(let i=0;i<crackCount;i++){
      const crack = makeEl("btfx-crack");
      layer.appendChild(crack);
      const rot = Math.random()*360;
      const len = 80 + Math.random()*180;
      crack.style.transform = `rotate(${rot}deg)`;
      const delay = 80 + Math.random()*150;
      anim(crack, [
        {opacity:0, width:"0px"},
        {opacity:.9, width:len+"px", offset:.3},
        {opacity:0, width:len+"px"},
      ], {duration:600, delay, easing:"ease-out"});
    }

    setTimeout(clearLayer, 950);
  }

  /* =============================== PUBLIC API ============================ */
  function play(type, success, stageColor){
    if(success){
      successFX(type === "major", stageColor);
    } else {
      failFX();
    }
  }

  window.BreakthroughFX = { play, charge };
})();
