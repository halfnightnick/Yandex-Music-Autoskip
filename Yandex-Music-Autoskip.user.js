// ==UserScript==
// @name         Yandex Music Autoskip
// @namespace    http://tampermonkey.net/
// @version      35.3
// @updateURL    https://github.com/halfnightnick/Yandex-Music-Autoskip/raw/refs/heads/main/Yandex-Music-Autoskip.user.js
// @downloadURL  https://github.com/halfnightnick/Yandex-Music-Autoskip/raw/refs/heads/main/Yandex-Music-Autoskip.user.js
// @description  Пользовательский скрипт для браузера, который накапливает историю прослушиваний Яндекс Музыки и автоматически скипает недавно игравшие треки, а также отображает, когда трек играл последний раз.
// @author       halfnightnick
// @icon         https://music.yandex.ru/favicon.svg
// @icon64       https://music.yandex.ru/favicon.svg
// @match        *://music.yandex.ru/*
// @match        *://music.yandex.by/*
// @match        *://music.yandex.kz/*
// @match        *://music.yandex.uz/*
// @match        *://music.yandex.com/*
// @match        *://music.yandex.com.am/*
// @match        *://music.yandex.com.ge/*
// @match        *://music.yandex.com.tr/*
// @match        *://music.yandex.az/*
// @match        *://music.yandex.md/*
// @match        *://music.yandex.tj/*
// @match        *://music.yandex.tm/*
// @match        *://music.yandex.kg/*
// @match        *://music.yandex.ua/*
// @include      *://music.yandex.*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==
(function() {
    'use strict';
    let skips = 0, cur = null, isSaved = false, lastTs = null, actTxt = 'Трек играет впервые';
    const pl = (n, f1, f2, f5) => { n = Math.abs(n) % 100; let n1 = n % 10; return (n > 10 && n < 20) ? f5 : (n1 > 1 && n1 < 5) ? f2 : (n1 === 1) ? f1 : f5; };
    function getHist() {
        try {
            let h = JSON.parse(GM_getValue('ym_counter_v9', null)) || {}, m = false;
            for (let k in h) { if (typeof h[k] === 'string' && h[k].includes(';')) { let p = Date.parse(h[k].split(';')); h[k] = !isNaN(p) ? p : Date.now(); m = true; } }
            if (m) GM_setValue('ym_counter_v9', JSON.stringify(h)); return h;
        } catch(e) { return {}; }
    }
    function getRelTime(ts) {
        if (!ts) return null; let diff = Date.now() - ts; if (isNaN(diff) || diff < 0) return null;
        let m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
        if (m < 1) return 'только что'; if (m < 60) return `${m} ${pl(m, 'минуту', 'минуты', 'минут')} назад`;
        if (h < 24) return `${h} ${pl(h, 'час', 'часа', 'часов')} назад`; if (d < 7) return `${d} ${pl(d, 'день', 'дня', 'дней')} назад`;
        let w = Math.floor(d / 7), mo = Math.floor(d / 30.44), y = Math.floor(d / 365.25);
        return mo < 1 ? `${w} ${pl(w, 'неделю', 'недели', 'недель')} назад` : y < 1 ? `${mo} ${pl(mo, 'месяц', 'месяца', 'месяцев')} назад` : `${y} ${pl(y, 'год', 'года', 'лет')} назад`;
    }
    function getCol(ts) { if (!ts) return '#8a2be2'; let d = (Date.now() - ts) / 86400000; return d < 10 ? '#ff3333' : d < 20 ? '#ff9900' : d < 30 ? '#ffff00' : d < 90 ? '#00ff00' : d < 180 ? '#00ffff' : d < 360 ? '#0066ff' : '#8a2be2'; }
    const S_COMP = `position:fixed!important;right:0!important;background:rgba(20,20,20,0.85)!important;backdrop-filter:blur(4px)!important;border-radius:6px!important;z-index:2147483647!important;font:10px system-ui,sans-serif!important;box-shadow:-1px 1px 5px rgba(0,0,0,0.4)!important;box-sizing:border-box!important;line-height:1.2!important;height:18px!important;padding:2px 8px!important;display:flex!important;align-items:center!important;`;
    const S_SKIP = S_COMP + `top:0!important;width:280px!important;cursor:default!important;user-select:none!important;pointer-events:auto!important;color:rgba(255,255,255,0.7)!important;`;
    const S_MAIN = S_COMP + `pointer-events:none!important;justify-content:flex-end!important;color:rgba(255,255,255,0.85)!important;white-space:nowrap!important;`;
    function skipTrk() { skips++; document.querySelectorAll('audio').forEach(a => a.dataset.ymSkipping = "true"); let ev = { key: 'n', code: 'KeyN', keyCode: 78, which: 78, bubbles: true, cancelable: true }; window.dispatchEvent(new KeyboardEvent('keydown', ev)); window.dispatchEvent(new KeyboardEvent('keyup', ev)); }
    function updateBorders() { let s = document.getElementById('ym-autoskip-box'); if (s) s.style.setProperty('border', `1px solid ${GM_getValue('ym_autoskip_enabled', true) ? '#ffffff' : '#333333'}`, 'important'); }
    function checkAndTriggerSkip() { if (lastTs && GM_getValue('ym_autoskip_enabled', true)) { if ((Date.now() - lastTs) / 86400000 < GM_getValue('ym_autoskip_days', 10)) { setTimeout(skipTrk, skips > 10 ? Math.random() * 100 + 1500 : Math.random() * 10 + 50); skips = skips > 10 ? 0 : skips; } else skips = 0; } }
    function creBox() {
        let s = document.getElementById('ym-autoskip-box'); if (s || !document.body) return;
        let st = document.createElement('style'); st.innerText = `#ym-rng::-webkit-slider-thumb{-webkit-appearance:none!important;width:6px!important;height:6px!important;border-radius:50%!important;background:#fff!important;} #ym-rng::-moz-range-thumb{width:6px!important;height:6px!important;border-radius:50%!important;background:#fff!important;border:none!important;}`; document.head.appendChild(st);
        s = document.createElement('div'); s.id = 'ym-autoskip-box'; s.style.cssText = S_SKIP;
        let lbl = document.createElement('label'); lbl.style.cssText = 'display:flex!important;align-items:center!important;gap:5px!important;cursor:pointer!important;margin:0!important;flex-shrink:0!important;';
        let chk = document.createElement('input'); chk.type = 'checkbox'; chk.style.cssText = 'margin:0!important;width:11px!important;height:11px!important;'; chk.checked = GM_getValue('ym_autoskip_enabled', true);
        let txt = document.createElement('span'); txt.innerText = 'Скип треков, игравших в последние';
        chk.addEventListener('change', (e) => { GM_setValue('ym_autoskip_enabled', e.target.checked); updateBorders(); if(e.target.checked) checkAndTriggerSkip(); });
        lbl.appendChild(chk); lbl.appendChild(txt); s.appendChild(lbl);
        let rng = document.createElement('input'); rng.type = 'range'; rng.id = 'ym-rng'; rng.min = '3'; rng.max = '30'; let sD = GM_getValue('ym_autoskip_days', 10); rng.value = sD; rng.style.cssText = '-webkit-appearance:none!important;background:#555!important;width:45px!important;height:2px!important;cursor:pointer!important;margin:0 6px 0 6px!important;flex-shrink:0!important;outline:none!important;';
        let rV = document.createElement('span'); rV.innerText = `${sD} дн.`; rV.style.cssText = 'font-weight:bold!important;color:#fff!important;margin-left:auto!important;flex-shrink:0!important;';
        rng.addEventListener('input', (e) => { GM_setValue('ym_autoskip_days', parseInt(e.target.value, 10)); rV.innerText = `${e.target.value} дн.`; checkAndTriggerSkip(); });
        s.appendChild(rng); s.appendChild(rV); document.body.appendChild(s); updateBorders();
    }
    function show(t, f = false, ts = null, isN = false) {
        creBox(); let m = document.getElementById('ym-history-notify'), s = document.getElementById('ym-autoskip-box'); if (!m) { m = document.createElement('div'); m.id = 'ym-history-notify'; document.body.appendChild(m); }
        m.innerText = t; let c = getCol(ts), b = `border:1px solid ${isSaved ? '#ffffff' : c}!important;`; m.style.cssText = S_MAIN + (f ? `border:1px solid #00ff00!important;box-shadow:0 0 15px #00ff00,inset 0 0 6px #00ff00!important;color:#00ff00!important;font-weight:bold!important;` : b);
        if (s) m.style.top = `${s.offsetHeight + 1}px`; updateBorders();
        if (f) setTimeout(() => { if (m.innerText === t) { m.style.cssText = S_MAIN + b; if (s) m.style.top = `${s.offsetHeight + 1}px`; } }, 4000);
        if (isN) checkAndTriggerSkip();
    }
    function trkChg(ti, ar, f = false) {
        if (!ti || ti === "Яндекс Музыка") return; let k = `${ti.trim()} — ${ar ? ar.trim() : 'Неизвестный исполнитель'}`; if (k === cur && !f) return;
        let isN = (k !== cur); if (isN) { cur = k; isSaved = false; }
        let h = getHist(), r = h[k]; if (r) { lastTs = parseInt(r, 10); actTxt = `Последний раз трек играл ${getRelTime(lastTs)}`; } else { actTxt = 'Трек играет впервые'; lastTs = null; }
        show(actTxt, false, lastTs, isN);
    }
    function chkPrg(e) { if (!cur || isSaved || !e.target.duration || e.target.dataset.ymSkipping === "true") return; let mid = e.target.duration / 2; if (e.target.currentTime >= mid && e.target.currentTime <= mid + 2) { isSaved = true; let h = getHist(), n = Date.now(); h[cur] = n; try{GM_setValue('ym_counter_v9', JSON.stringify(h));}catch(err){} show(actTxt, true, n, false); } }
    document.createElement = (function(orig) { return function(tag, opt) { let el = orig.call(document, tag, opt); if (tag && tag.toLowerCase() === 'audio') el.addEventListener('timeupdate', chkPrg); return el; }; })(document.createElement);
    if (navigator.mediaSession) { let oS = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata').set; Object.defineProperty(MediaSession.prototype, 'metadata', { set: function(m) { if (m && m.title) trkChg(m.title, m.artist); oS.call(this, m); }, configurable: true }); }
    setInterval(() => { creBox(); let m = document.getElementById('ym-history-notify'), s = document.getElementById('ym-autoskip-box'); if (navigator.mediaSession?.metadata) trkChg(navigator.mediaSession.metadata.title, navigator.mediaSession.metadata.artist); document.querySelectorAll('audio').forEach(a => { if(!a.dataset.ymM) { a.dataset.ymM="true"; a.addEventListener('timeupdate', chkPrg); } if (a.currentTime > 0 && a.currentTime < 3 && a.dataset.ymSkipping !== "true") { checkAndTriggerSkip(); } }); if (m && m.parentElement !== document.body) document.body.appendChild(m); if (s && s.parentElement !== document.body) document.body.appendChild(s); if (s && m) m.style.top = `${s.offsetHeight + 1}px`; updateBorders(); }, 1000);
})();
