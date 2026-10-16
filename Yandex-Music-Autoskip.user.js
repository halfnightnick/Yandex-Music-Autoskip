// ==UserScript==
// @name         Yandex Music Autoskip
// @namespace    http://tampermonkey.net/
// @version      37.7
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
    let isReadyToCheck = false;
    let db = null;

    const liveAudioCollection = document.getElementsByTagName('audio');
    const cachedKeyEvent = { key: 'n', code: 'KeyN', keyCode: 78, which: 78, bubbles: true, cancelable: true };

    // --- ПОБИТОВАЯ МАТЕМАТИКА И ПЛЮРАЛИЗАЦИЯ ---

    const pluralize = (number, form1, form2, form5) => {
        let n = number % 100;
        let n1 = n % 10;
        if (n > 10 && n < 20) return form5;
        if (n1 > 1 && n1 < 5) return form2;
        if (n1 === 1) return form1;
        return form5;
    };

    function getRelativeTimeStr(timestamp) {
        if (!timestamp) return null;
        let diffMs = Date.now() - timestamp;
        if (isNaN(diffMs) || diffMs < 0) return null;

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
    // --- УПРАВЛЕНИЕ ХРАНИЛИЩЕМ INDEXEDDB ---

    function initDatabase() {
        const request = indexedDB.open('YandexMusicAutoskipDB', 1);
        request.onupgradeneeded = function(event) {
            let database = event.target.result;
            if (!database.objectStoreNames.contains('history')) {
                database.createObjectStore('history');
            }
        };
        request.onsuccess = function(event) {
            db = event.target.result;
            let oldData = GM_getValue('ym_counter_v9', null);
            if (oldData) {
                let history = (typeof oldData === 'string') ? JSON.parse(oldData) : oldData;
                let transaction = db.transaction(['history'], 'readwrite');
                let store = transaction.objectStore(['history']);
                for (let key in history) { store.put(history[key], key); }
                GM_setValue('ym_counter_v9', null);
            }
        };
    }

    function exportHistoryToFile() {
        if (!db) return alert('База данных еще загружается, попробуйте снова.');
        let transaction = db.transaction(['history'], 'readonly');
        let store = transaction.objectStore('history');
        let request = store.openCursor();
        let exportData = {};

        request.onsuccess = function(event) {
            let cursor = event.target.result;
            if (cursor) {
                exportData[cursor.key] = cursor.value;
                cursor.continue();
            } else {
                let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData));
                let downloadAnchor = document.createElement('a');
                downloadAnchor.setAttribute("href", dataStr);
                downloadAnchor.setAttribute("download", "yandex_music_history.json");
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                downloadAnchor.remove();
            }
        };
    }

    function importHistoryFromFile(event) {
        let file = event.target.files;
        if (!file || !db) return;

        let reader = new FileReader();
        reader.onload = function(e) {
            try {
                let importedData = JSON.parse(e.target.result);
                let transaction = db.transaction(['history'], 'readwrite');
                let store = transaction.objectStore('history');

                for (let key in importedData) {
                    store.put(importedData[key], key);
                }
                alert('История прослушиваний успешно импортирована!');
                if (currentTrackKey) onTrackChanged(currentTrackKey.split(' — '), currentTrackKey.split(' — '), true);
            } catch(err) {
                alert('Ошибка: Файл поврежден или имеет неверный формат.');
            }
        };
        reader.readAsText(file);
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
    // --- ОБНОВЛЕННЫЙ ТРЕХЭТАЖНЫЙ CSS МОДУЛЬ С ПРИВЯЗКОЙ К ПРАВОМУ КРАЮ ---
    function injectStyles() {
        if (document.getElementById('ym-autoskip-styles')) return;
        let style = document.createElement('style');
        style.id = 'ym-autoskip-styles';
        style.innerText = `
            .ym-base { position:fixed!important; background:rgba(20,20,20,0.85)!important; backdrop-filter:blur(4px)!important; border-radius:6px!important; z-index:2147483647!important; font:10px system-ui,sans-serif!important; box-shadow:-1px 1px 5px rgba(0,0,0,0.4)!important; box-sizing:border-box!important; line-height:1.2!important; height:18px!important; padding:2px 8px!important; display:flex!important; align-items:center!important; }

            /* ЭТАЖ 1 (top: 0px): Окошко автоскипа (280px) прижато к правому краю экрана (right: 0px) */
            .ym-settings { top:0px!important; right:0px!important; width:280px!important; cursor:default!important; user-select:none!important; pointer-events:auto!important; color:rgba(255,255,255,0.7)!important; }

            /* ЭТАЖ 2 (top: 19px, слева): Окошко статуса трека, смещенное влево под ширину кнопок */
            .ym-notify { top:19px!important; right:46px!important; width:auto!important; max-width:400px!important; pointer-events:none!important; color:rgba(255,255,255,0.85)!important; white-space:nowrap!important; }

            /* ПРАВАЯ ВЕРТИКАЛЬНАЯ КОЛОНКА (right: 0px): Кнопки стоят строго у кромки экрана друг под другом */
            .ym-btn-box { right:0px!important; width:45px!important; justify-content:center!important; padding:0!important; }
            .ym-btn-exp { top:19px!important; }  /* Кнопка Экспорт находится на ЭТАЖЕ 2 */
            .ym-btn-imp { top:38px!important; }  /* Кнопка Импорт находится на ЭТАЖЕ 3 */

            .ym-btn { background:transparent!important; color:#fff!important; border:none!important; cursor:pointer!important; font-size:9px!important; font-weight:bold!important; width:100%!important; height:100%!important; text-align:center!important; padding:0!important; margin:0!important; display:flex!important; align-items:center!important; justify-content:center!important; }

            #ym-rng { -webkit-appearance:none!important; background:#555!important; width:45px!important; height:2px!important; cursor:pointer!important; margin:0 6px!important; flex-shrink:0!important; outline:none!important; }
            #ym-rng::-webkit-slider-thumb { -webkit-appearance:none!important; width:6px!important; height:6px!important; border-radius:50%!important; background:#fff!important; }
        `;
        document.head.appendChild(style);
    }

    function skipTrk() {
        skipsCount++;
        for (let i = 0; i < liveAudioCollection.length; i++) { liveAudioCollection[i].dataset.ymSkipping = "true"; }
        window.dispatchEvent(new KeyboardEvent('keydown', cachedKeyEvent));
        window.dispatchEvent(new KeyboardEvent('keyup', cachedKeyEvent));
    }

    // Синхронно красит рамки верхнего окна и обеих боковых независимых кнопок
    function updateBorders() {
        let isEnabled = GM_getValue('ym_autoskip_enabled', true);
        let borderStyle = `1px solid ${isEnabled ? '#ffffff' : '#333333'}`;

        let settingsBox = document.getElementById('ym-autoskip-box');
        if (settingsBox) settingsBox.style.setProperty('border', borderStyle, 'important');

        let expBox = document.getElementById('ym-autoskip-exp-box');
        if (expBox) expBox.style.setProperty('border', borderStyle, 'important');

        let impBox = document.getElementById('ym-autoskip-imp-box');
        if (impBox) impBox.style.setProperty('border', borderStyle, 'important');
    }

    function checkAndTriggerSkip() {
        if (lastPlayedTimestamp && GM_getValue('ym_autoskip_enabled', true)) {
            if (((Date.now() - lastPlayedTimestamp) / 86400000) < GM_getValue('ym_autoskip_days', 10)) {
                setTimeout(skipTrk, skipsCount > 10 ? Math.random() * 100 + 1500 : Math.random() * 10 + 50);
                skipsCount = skipsCount > 10 ? 0 : skipsCount;
            } else { skipsCount = 0; }
        }
    }

    function createSettingsBox() {
        let box = document.getElementById('ym-autoskip-box');
        if (box || !document.body) return;

        injectStyles();

        // 1. Создаем верхнее окно настроек (Этаж 1, справа у края)
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

        // 2. Создаем окошко-кнопку "Экспорт" (Этаж 2, у кромки экрана)
        let expBox = document.createElement('div');
        expBox.id = 'ym-autoskip-exp-box';
        expBox.className = 'ym-base ym-btn-box ym-btn-exp';
        let expBtn = document.createElement('button');
        expBtn.className = 'ym-btn';
        expBtn.innerText = 'Экспорт';
        expBtn.addEventListener('click', exportHistoryToFile);
        expBox.appendChild(expBtn);
        document.body.appendChild(expBox);

        // 3. Создаем окошко-кнопку "Импорт" (Этаж 3, под Экспортом)
        let impBox = document.createElement('div');
        impBox.id = 'ym-autoskip-imp-box';
        impBox.className = 'ym-base ym-btn-box ym-btn-imp';
        let impBtn = document.createElement('button');
        impBtn.className = 'ym-btn';
        impBtn.innerText = 'Импорт';

        let fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', importHistoryFromFile);

        impBtn.addEventListener('click', () => fileInput.click());
        impBox.appendChild(impBtn);
        impBox.appendChild(fileInput);
        document.body.appendChild(impBox);

        updateBorders();
    }
    function showNotification(text, isSavedGreen = false, timestamp = null) {
        createSettingsBox();
        let notifyBox = document.getElementById('ym-history-notify');
        let settingsBox = document.getElementById('ym-autoskip-box');
        let expBox = document.getElementById('ym-autoskip-exp-box');
        let impBox = document.getElementById('ym-autoskip-imp-box');

        if (settingsBox && settingsBox.parentElement !== document.body) document.body.appendChild(settingsBox);
        if (expBox && expBox.parentElement !== document.body) document.body.appendChild(expBox);
        if (impBox && impBox.parentElement !== document.body) document.body.appendChild(impBox);

        if (!notifyBox) {
            notifyBox = document.createElement('div');
            notifyBox.id = 'ym-history-notify';
            notifyBox.className = 'ym-base ym-notify';
            document.body.appendChild(notifyBox);
        } else if (notifyBox.parentElement !== document.body) {
            document.body.appendChild(notifyBox);
        }

        notifyBox.innerText = text;
        let color = getStatusColor(timestamp);
        let borderStyle = `border:1px solid ${isTrackSaved ? '#ffffff' : color}!important;`;

        if (isSavedGreen) {
            notifyBox.style.cssText = 'border:1px solid #00ff00!important;box-shadow:0 0 15px #00ff00,inset 0 0 6px #00ff00!important;color:#00ff00!important;font-weight:bold!important;';
            setTimeout(() => { if (notifyBox.innerText === text) { notifyBox.style.cssText = `border:1px solid ${isTrackSaved ? '#ffffff' : getStatusColor(timestamp)}!important;`; } }, 1000);
        } else {
            notifyBox.style.cssText = `border:1px solid ${isTrackSaved ? '#ffffff' : getStatusColor(timestamp)}!important;`;
        }
        updateBorders();
    }

    function onTrackChanged(title, artist, forceUpdate = false) {
        let trackKey = `${title} — ${artist || 'Неизвестный исполнитель'}`;
        if (trackKey === currentTrackKey && !forceUpdate) return;

        currentTrackKey = trackKey;
        isTrackSaved = false;
        isReadyToCheck = true;

        if (!db) return;

        let transaction = db.transaction(['history'], 'readonly');
        let store = transaction.objectStore('history');
        let getRequest = store.get(trackKey);

        getRequest.onsuccess = function(event) {
            let lastPlay = event.target.result;
            if (lastPlay) {
                lastPlayedTimestamp = parseInt(lastPlay, 10);
                statusText = `Последний раз трек играл ${getRelativeTimeStr(lastPlayedTimestamp)}`;
            } else {
                statusText = 'Трек играет впервые';
                lastPlayedTimestamp = null;
            }
            showNotification(statusText, false, lastPlayedTimestamp);
        };
    }

    function checkPlaybackProgress(event) {
        if (!currentTrackKey || isTrackSaved || !event.target.duration || event.target.dataset.ymSkipping === "true") return;
        let midpoint = event.target.duration / 2;
        if (event.target.currentTime >= midpoint && event.target.currentTime <= midpoint + 2) {
            isTrackSaved = true;
            let now = Date.now();
            if (db) {
                let transaction = db.transaction(['history'], 'readwrite');
                transaction.objectStore('history').put(now, currentTrackKey);
            }
            showNotification(statusText, true, now);
        }
    }

    function onAudioPlayEvent(event) {
        if (isReadyToCheck && event.target.dataset.ymSkipping !== "true") {
            isReadyToCheck = false;
            setTimeout(checkAndTriggerSkip, 50);
        }
    }

    function initAudioElement(audio) {
        if (audio.dataset.ymM) return;
        audio.dataset.ymM = "true";
        audio.addEventListener('timeupdate', checkPlaybackProgress);
        audio.addEventListener('play', onAudioPlayEvent);
    }

    document.createElement = (function(originalMethod) {
        return function(tagName, options) {
            let element = originalMethod.call(document, tagName, options);
            if (tagName && tagName.toLowerCase() === 'audio') { initAudioElement(element); }
            return element;
        };
    })(document.createElement);

    if (navigator.mediaSession) {
        let originalMetadataSetter = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata').set;
        Object.defineProperty(MediaSession.prototype, 'metadata', {
            set: function(metadata) {
                if (metadata && metadata.title) { onTrackChanged(metadata.title, metadata.artist); }
                originalMetadataSetter.call(this, metadata);
            },
            configurable: true
        });
    }

    initDatabase();
    if (document.body) { createSettingsBox(); } else { window.addEventListener('DOMContentLoaded', createSettingsBox); }
})();
