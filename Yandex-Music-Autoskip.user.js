// ==UserScript==
// @name         Yandex Music Autoskip
// @namespace    http://tampermonkey.net/
// @version      38.4
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
        // Исправлено: берем первый файл из списка [0]
        let file = event.target.files[0];
        if (!file || !db) return;

        let reader = new FileReader();
        reader.onload = function(e) {
            try {
                let importedData = JSON.parse(e.target.result);
                let transaction = db.transaction(['history'], 'readwrite');
                let store = transaction.objectStore('history');

                // Очищаем существующую базу перед импортом новых данных
                store.clear();

                for (let key in importedData) {
                    store.put(importedData[key], key);
                }

                // Логика визуального отклика выполняется после успешной записи всех данных
                transaction.oncomplete = function() {
                    // Эффект зеленого свечения для контейнера кнопки импорта на 1 секунду
                    let impBox = document.getElementById('ym-autoskip-imp-box');
                    if (impBox) {
                        impBox.style.setProperty('border', '1px solid #00ff00', 'important');
                        impBox.style.setProperty('box-shadow', '0 0 15px #00ff00, inset 0 0 6px #00ff00', 'important');
                        impBox.style.setProperty('color', '#00ff00', 'important');

                        let impBtn = impBox.querySelector('.ym-btn');
                        if (impBtn) impBtn.style.setProperty('color', '#00ff00', 'important');

                        // Возвращаем исходный белый стиль через 1000 мс (1 секунда)
                        setTimeout(() => {
                            impBox.style.borderColor = '#ffffff';
                            impBox.style.boxShadow = '-1px 1px 5px rgba(0,0,0,0.4)';
                            impBox.style.color = '#ffffff';
                            if (impBtn) impBtn.style.setProperty('color', '#ffffff', 'important');
                        }, 1000);
                    }

                    if (currentTrackKey) onTrackChanged(currentTrackKey.split(' — '), currentTrackKey.split(' — '), true);
                };

            } catch(err) {
                alert('Ошибка: Файл поврежден или имеет неверный формат.');
            }
        };
        // Теперь передается правильный объект файла (Blob)
        reader.readAsText(file);
        event.target.value = ''; // Сбрасываем инпут, чтобы можно было загрузить тот же файл повторно
    }


    function getStatusColor(timestamp) {
        if (!timestamp) return '#8a2be2';
        let daysPassed = ((Date.now() - timestamp) / 86400000) | 0;
        if (daysPassed <= 10) return '#ff3333';
        if (daysPassed <= 20) return '#ff9900';
        if (daysPassed <= 30) return '#ffff00';
        if (daysPassed <= 90) return '#00ff00';
        if (daysPassed <= 180) return '#00ffff';
        if (daysPassed <= 360) return '#0066ff';
        return '#8a2be2';
    }
    // --- ФИНАЛЬНЫЙ CSS МОДУЛЬ: Кристально белый цвет текста (#fff) для всех элементов ---
    function injectStyles() {
        if (document.getElementById('ym-autoskip-styles')) return;
        let style = document.createElement('style');
        style.id = 'ym-autoskip-styles';
        style.innerText = `
            /* Сквозные правила для абсолютно всех текстовых элементов: 9px, центрирование и 100% БЕЛЫЙ ЦВЕТ */
            .ym-base, .ym-base span, .ym-base label, .ym-base button, #ym-range-val {
                font: normal 9px system-ui, -apple-system, sans-serif !important;
                color: #ffffff !important;
                text-align: center !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin: 0 !important;
                line-height: 1 !important;
            }

            .ym-base { position:fixed!important; background:rgba(20,20,20,0.85)!important; backdrop-filter:blur(4px)!important; border-radius:6px!important; z-index:2147483647!important; box-shadow:-1px 1px 5px rgba(0,0,0,0.4)!important; box-sizing:border-box!important; height:18px!important; padding:2px 3px!important; }

            /* Этаж 1: Окошко настроек автоскипа прижато к правому краю экрана */
            .ym-settings { top:0px!important; right:0px!important; width:auto!important; max-width:287px!important; cursor:default!important; user-select:none!important; pointer-events:auto!important; gap:3px!important; }

            /* Этаж 2 (слева): Окошко статуса трека, смещенное под ширину кнопок */
            .ym-notify { top:19px!important; right:42px!important; width:auto!important; max-width:245px!important; pointer-events:none!important; white-space:nowrap!important; }

            /* Правая вертикальная колонка кнопок у кромки экрана */
            .ym-btn-box { right:0px!important; width:41px!important; padding:0!important; border: 1px solid #ffffff !important;}
            .ym-btn-exp { top:19px!important; }
            .ym-btn-imp { top:38px!important; }

            .ym-btn { background:transparent!important; border:none!important; cursor:pointer!important; width:100%!important; height:100%!important; padding:0!important; }

            #ym-rng { -webkit-appearance:none!important; background:#555!important; width:100px!important; height:2px!important; cursor:pointer!important; flex-shrink:0!important; outline:none!important; }
            #ym-rng::-webkit-slider-thumb { -webkit-appearance:none!important; width:6px!important; height:6px!important; border-radius:50%!important; background:#fff!important; }

            #ym-range-val { width: 25px !important; min-width: 25px !important; }
        `;
        document.head.appendChild(style);
    }

    function simulateHumanKeyPress() {
        const downEvent = new KeyboardEvent('keydown', cachedKeyEvent);
        const upEvent = new KeyboardEvent('keyup', cachedKeyEvent);

        window.dispatchEvent(downEvent);

        setTimeout(() => {
            window.dispatchEvent(upEvent);
        }, Math.random() * 80 + 40);
    }

    function skipTrk() {
        skipsCount++;
        for (let i = 0; i < liveAudioCollection.length; i++) { liveAudioCollection[i].dataset.ymSkipping = "true"; }
        simulateHumanKeyPress();
    }

    function updateBorders() {
        let isEnabled = GM_getValue('ym_autoskip_enabled', true);
        let borderStyle = `1px solid ${isEnabled ? '#ffffff' : '#333333'}`;

        let settingsBox = document.getElementById('ym-autoskip-box');
        if (settingsBox) settingsBox.style.setProperty('border', borderStyle, 'important');

    }

    function checkAndTriggerSkip() {
        if (lastPlayedTimestamp && GM_getValue('ym_autoskip_enabled', true)) {
            if ((((Date.now() - lastPlayedTimestamp) / 86400000) | 0) <= GM_getValue('ym_autoskip_days', 10)) {

                let delay;
                if (skipsCount > 7) {
                    delay = Math.random() * 543 + 567;
                } else {
                    delay = Math.random() * 321 + 345;
                }

                setTimeout(skipTrk, delay);
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
        label.style.cssText = 'cursor:pointer!important; gap:4px!important;';

        let checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.cssText = 'margin:0!important;width:11px!important;height:11px!important;cursor:pointer!important;flex-shrink:0!important;';
        checkbox.checked = GM_getValue('ym_autoskip_enabled', true);

        let labelText = document.createElement('span');
        labelText.innerText = 'Скипать игравшее в последние';

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
        rangeInput.min = '1';
        rangeInput.max = '90';
        let currentDaysSetting = GM_getValue('ym_autoskip_days', 10);
        rangeInput.value = currentDaysSetting;

        let rangeValueDisplay = document.createElement('span');
        rangeValueDisplay.id = 'ym-range-val';
        rangeValueDisplay.innerText = `${currentDaysSetting} дн.`;
        rangeValueDisplay.style.cssText = 'color:#fff!important; margin-left:auto!important; flex-shrink:0!important;';

        rangeInput.addEventListener('input', (e) => {
            GM_setValue('ym_autoskip_days', parseInt(e.target.value, 10));
            rangeValueDisplay.innerText = `${e.target.value} дн.`;
            checkAndTriggerSkip();
        });

        box.appendChild(rangeInput);
        box.appendChild(rangeValueDisplay);
        document.body.appendChild(box);

        let expBox = document.createElement('div');
        expBox.id = 'ym-autoskip-exp-box';
        expBox.className = 'ym-base ym-btn-box ym-btn-exp';
        let expBtn = document.createElement('button');
        expBtn.className = 'ym-btn';
        expBtn.innerText = 'Экспорт';
        expBtn.addEventListener('click', exportHistoryToFile);
        expBox.appendChild(expBtn);
        document.body.appendChild(expBox);

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
        let baseStyleAddition = isSavedGreen ? 'border:1px solid #00ff00!important;box-shadow:0 0 15px #00ff00,inset 0 0 6px #00ff00!important;color:#00ff00!important;' : `border:1px solid ${isTrackSaved ? '#ffffff' : color}!important;`;

        notifyBox.style.cssText = baseStyleAddition;

        if (isSavedGreen) {
            setTimeout(() => {
                if (notifyBox.innerText === text) {
                    notifyBox.style.borderColor = isTrackSaved ? '#ffffff' : color;
                    notifyBox.style.color = 'rgba(255,255,255,1.0)';
                    notifyBox.style.boxShadow = '-1px 1px 5px rgba(0,0,0,0.4)';
                }
            }, 1000);
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
            checkAndTriggerSkip();
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
