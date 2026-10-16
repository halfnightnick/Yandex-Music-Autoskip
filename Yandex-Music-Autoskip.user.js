// ==UserScript==
// @name         Yandex Music Autoskip
// @namespace    http://tampermonkey.net/
// @version      36.2
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

    // --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ СКРИПТА ---
    let skipsCount = 0;
    let currentTrackKey = null;
    let isTrackSaved = false;
    let lastPlayedTimestamp = null;
    let statusText = 'Трек играет впервые';
    let cachedHistory = null;

    // --- ПОБИТОВАЯ МАТЕМАТИКА И ПЛЮРАЛИЗАЦИЯ ---

    /**
     * Быстрая плюрализация
     */
    const pluralize = (number, form1, form2, form5) => {
        let n = number % 100;
        let n1 = n % 10;
        if (n > 10 && n < 20) return form5;
        if (n1 > 1 && n1 < 5) return form2;
        if (n1 === 1) return form1;
        return form5;
    };

    /**
     * Ультимативный расчет времени с заменой Math.floor на побитовое ИЛИ (| 0)
     */
    function getRelativeTimeStr(timestamp) {
        if (!timestamp) return null;

        let diffMs = Date.now() - timestamp;
        if (isNaN(diffMs) || diffMs < 0) return null;

        // Побитовый сдвиг (| 0) мгновенно отбрасывает дробную часть на уровне процессора
        let minutes = (diffMs / 60000) | 0;
        if (minutes < 1) return 'только что';
        if (minutes < 60) return `${minutes} ${pluralize(minutes, 'минуту', 'минуты', 'минут')} назад`;

        let hours = (minutes / 60) | 0;
        if (hours < 24) return `${hours} ${pluralize(hours, 'час', 'часа', 'часов')} назад`;

        let days = (hours / 24) | 0;
        if (days < 7) return `${days} ${pluralize(days, 'день', 'дня', 'дней')} назад`;

        let weeks = (days / 7) | 0;
        let months = (days / 30.44) | 0;
        let years = (days / 365.25) | 0;

        if (months < 1) return `${weeks} ${pluralize(weeks, 'неделю', 'недели', 'недель')} назад`;
        if (years < 1) return `${months} ${pluralize(months, 'месяц', 'месяца', 'месяцев')} назад`;
        return `${years} ${pluralize(years, 'год', 'года', 'лет')} назад`;
    }
    /**
     * Получение истории напрямую (кэшированный объект)
     */
    function getHistory(forceReload = false) {
        if (cachedHistory && !forceReload) return cachedHistory;
        try {
            let rawData = GM_getValue('ym_counter_v9', null);
            cachedHistory = (typeof rawData === 'string') ? JSON.parse(rawData) : (rawData || {});
            return cachedHistory;
        } catch(error) {
            return cachedHistory || {};
        }
    }

    function getStatusColor(timestamp) {
        if (!timestamp) return '#8a2be2';
        let daysPassed = (Date.now() - timestamp) / 86400000;
        if (daysPassed < 10)  return '#ff3333';
        if (daysPassed < 20)  return '#ff9900';
        if (daysPassed < 30)  return '#ffff00';
        if (daysPassed < 90)  return '#00ff00';
        if (daysPassed < 180) return '#00ffff';
        if (daysPassed < 360) return '#0066ff';
        return '#8a2be2';
    }

    // --- ОПТИМИЗАЦИЯ СТИЛЕЙ: Выносим CSS в один статический класс, разгружая парсер браузера ---
    function injectStyles() {
        if (document.getElementById('ym-autoskip-styles')) return;
        let style = document.createElement('style');
        style.id = 'ym-autoskip-styles';
        style.innerText = `
            .ym-base { position:fixed!important; right:0!important; background:rgba(20,20,20,0.85)!important; backdrop-filter:blur(4px)!important; border-radius:6px!important; z-index:2147483647!important; font:10px system-ui,sans-serif!important; box-shadow:-1px 1px 5px rgba(0,0,0,0.4)!important; box-sizing:border-box!important; line-height:1.2!important; height:18px!important; padding:2px 8px!important; display:flex!important; align-items:center!important; }
            .ym-settings { top:0!important; width:280px!important; cursor:default!important; user-select:none!important; pointer-events:auto!important; color:rgba(255,255,255,0.7)!important; }
            .ym-notify { top:19px!important; pointer-events:none!important; justify-content:flex-end!important; color:rgba(255,255,255,0.85)!important; white-space:nowrap!important; }
            #ym-rng { -webkit-appearance:none!important; background:#555!important; width:45px!important; height:2px!important; cursor:pointer!important; margin:0 6px!important; flex-shrink:0!important; outline:none!important; }
            #ym-rng::-webkit-slider-thumb { -webkit-appearance:none!important; width:6px!important; height:6px!important; border-radius:50%!important; background:#fff!important; }
            #ym-rng::-moz-range-thumb { width:6px!important; height:6px!important; border-radius:50%!important; background:#fff!important; border:none!important; }
        `;
        document.head.appendChild(style);
    }

    function skipTrk() {
        skipsCount++;
        document.querySelectorAll('audio').forEach(audio => audio.dataset.ymSkipping = "true");
        let keyEvent = { key: 'n', code: 'KeyN', keyCode: 78, which: 78, bubbles: true, cancelable: true };
        window.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
        window.dispatchEvent(new KeyboardEvent('keyup', keyEvent));
    }

    function updateBorders() {
        let box = document.getElementById('ym-autoskip-box');
        if (box) {
            box.style.setProperty('border', `1px solid ${GM_getValue('ym_autoskip_enabled', true) ? '#ffffff' : '#333333'}`, 'important');
        }
    }

    function checkAndTriggerSkip() {
        if (lastPlayedTimestamp && GM_getValue('ym_autoskip_enabled', true)) {
            if (((Date.now() - lastPlayedTimestamp) / 86400000) < GM_getValue('ym_autoskip_days', 10)) {
                setTimeout(skipTrk, skipsCount > 10 ? Math.random() * 100 + 1500 : Math.random() * 10 + 50);
                skipsCount = skipsCount > 10 ? 0 : skipsCount;
            } else {
                skipsCount = 0;
            }
        }
    }
    function createSettingsBox() {
        let box = document.getElementById('ym-autoskip-box');
        if (box || !document.body) return;

        injectStyles();

        box = document.createElement('div');
        box.id = 'ym-autoskip-box';
        box.className = 'ym-base ym-settings';

        let label = document.createElement('label');
        label.style.cssText = 'display:flex!important;align-items:center!important;gap:5px!important;cursor:pointer!important;margin:0!important;flex-shrink:0!important;';

        let checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.cssText = 'margin:0!important;width:11px!important;height:11px!important;';
        checkbox.checked = GM_getValue('ym_autoskip_enabled', true);

        let labelText = document.createElement('span');
        labelText.innerText = 'Скип треков, игравших в последние';

        checkbox.addEventListener('change', (e) => {
            GM_setValue('ym_autoskip_enabled', e.target.checked);
            updateBorders();
            if (e.target.checked) checkAndTriggerSkip();
        });

        label.appendChild(checkbox);
        label.appendChild(labelText);
        box.appendChild(label);

        let rangeInput = document.createElement('input');
        rangeInput.type = 'range';
        rangeInput.id = 'ym-rng';
        rangeInput.min = '3';
        rangeInput.max = '30';
        let currentDaysSetting = GM_getValue('ym_autoskip_days', 10);
        rangeInput.value = currentDaysSetting;

        let rangeValueDisplay = document.createElement('span');
        rangeValueDisplay.innerText = `${currentDaysSetting} дн.`;
        rangeValueDisplay.style.cssText = 'font-weight:bold!important;color:#fff!important;margin-left:auto!important;flex-shrink:0!important;';

        rangeInput.addEventListener('input', (e) => {
            GM_setValue('ym_autoskip_days', parseInt(e.target.value, 10));
            rangeValueDisplay.innerText = `${e.target.value} дн.`;
            checkAndTriggerSkip();
        });

        box.appendChild(rangeInput);
        box.appendChild(rangeValueDisplay);
        document.body.appendChild(box);
        updateBorders();
    }

    function showNotification(text, isSavedGreen = false, timestamp = null) {
        let notifyBox = document.getElementById('ym-history-notify');
        let settingsBox = document.getElementById('ym-autoskip-box');

        if (settingsBox && settingsBox.parentElement !== document.body) {
            document.body.appendChild(settingsBox);
            updateBorders();
        }
        if (!notifyBox) {
            notifyBox = document.createElement('div');
            notifyBox.id = 'ym-history-notify';
            notifyBox.className = 'ym-base ym-notify';
            document.body.appendChild(notifyBox);
        } else if (notifyBox.parentElement !== document.body) {
            document.body.appendChild(notifyBox);
        }

        notifyBox.innerText = text;

        // Установка стилей через чистые классы без вычисления геометрии (offsetHeight)
        if (isSavedGreen) {
            notifyBox.style.cssText = 'border:1px solid #00ff00!important;box-shadow:0 0 15px #00ff00,inset 0 0 6px #00ff00!important;color:#00ff00!important;font-weight:bold!important;';
            setTimeout(() => {
                if (notifyBox.innerText === text) {
                    notifyBox.style.cssText = `border:1px solid ${isTrackSaved ? '#ffffff' : getStatusColor(timestamp)}!important;`;
                }
            }, 1000);
        } else {
            notifyBox.style.cssText = `border:1px solid ${isTrackSaved ? '#ffffff' : getStatusColor(timestamp)}!important;`;
        }
    }

    let isReadyToCheck = false;

    function onTrackChanged(title, artist) {
        // ОПТИМИЗАЦИЯ RAM: Полностью убран метод .trim(), строки берутся в исходном виде
        let trackKey = `${title} — ${artist || 'Неизвестный исполнитель'}`;
        if (trackKey === currentTrackKey) return;

        currentTrackKey = trackKey;
        isTrackSaved = false;
        isReadyToCheck = true;

        let lastPlay = getHistory()[trackKey];

        if (lastPlay) {
            lastPlayedTimestamp = parseInt(lastPlay, 10);
            statusText = `Последний раз трек играл ${getRelativeTimeStr(lastPlayedTimestamp)}`;
        } else {
            statusText = 'Трек играет впервые';
            lastPlayedTimestamp = null;
        }

        showNotification(statusText, false, lastPlayedTimestamp);
    }

    function checkPlaybackProgress(event) {
        if (!currentTrackKey || isTrackSaved || !event.target.duration || event.target.dataset.ymSkipping === "true") return;

        let midpoint = event.target.duration / 2;
        if (event.target.currentTime >= midpoint && event.target.currentTime <= midpoint + 2) {
            isTrackSaved = true;
            let history = getHistory();
            let now = Date.now();
            history[currentTrackKey] = now;

            try {
                GM_setValue('ym_counter_v9', history);
                getHistory(true);
            } catch(err) {}

            showNotification(statusText, true, now);
        }
    }

    function initAudioElement(audio) {
        if (audio.dataset.ymM) return;
        audio.dataset.ymM = "true";

        audio.addEventListener('timeupdate', checkPlaybackProgress);
        audio.addEventListener('play', () => {
            if (isReadyToCheck && audio.dataset.ymSkipping !== "true") {
                isReadyToCheck = false;
                setTimeout(checkAndTriggerSkip, 50);
            }
        });
    }

    document.createElement = (function(originalMethod) {
        return function(tagName, options) {
            let element = originalMethod.call(document, tagName, options);
            if (tagName && tagName.toLowerCase() === 'audio') {
                initAudioElement(element);
            }
            return element;
        };
    })(document.createElement);

    if (navigator.mediaSession) {
        let originalMetadataSetter = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata').set;
        Object.defineProperty(MediaSession.prototype, 'metadata', {
            set: function(metadata) {
                if (metadata && metadata.title) {
                    onTrackChanged(metadata.title, metadata.artist);
                }
                originalMetadataSetter.call(this, metadata);
            },
            configurable: true
        });
    }

    getHistory(true);

    if (document.body) {
        createSettingsBox();
    } else {
        window.addEventListener('DOMContentLoaded', createSettingsBox);
    }
})();
