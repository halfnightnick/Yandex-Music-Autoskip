// ==UserScript==
// @name         Yandex Music Autoskip
// @namespace    http://tampermonkey.net/
// @version      45.10
// @updateURL    https://github.com/halfnightnick/Yandex-Music-Autoskip/raw/refs/heads/main/Yandex-Music-Autoskip.user.js
// @downloadURL  https://github.com/halfnightnick/Yandex-Music-Autoskip/raw/refs/heads/main/Yandex-Music-Autoskip.user.js
// @description  Пользовательский скрипт для браузера, который накапливает историю прослушиваний Яндекс Музыки и автоматически скипает недавно игравшие треки, а также отображает, когда трек играл последний раз.
// @author       halfnightnick
// @icon         https://music.yandex.ru/favicon.svg
// @icon64       https://music.yandex.ru/favicon.svg
// @include      *://music.yandex.*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    let isTrackSaved = false;
    let skipsCount = 0;
    let newtrackKey = null;
    let currentTrackKey = null;
    let lastPlayedTimestamp = null;
    let db = null;
    let skipTimeoutId = null;
    let notifyTimeoutId = null;
    let statusText = 'Трек играет впервые';

    const cachedKeyEvent = { key: 'n', code: 'KeyN', keyCode: 78, which: 78, bubbles: true, cancelable: true };

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
        let minutes = Math.floor(diffMs / 60000);
        if (minutes < 1) return 'только что';
        if (minutes < 60) return `${minutes} ${pluralize(minutes, 'минуту', 'минуты', 'минут')} назад`;
        let hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} ${pluralize(hours, 'час', 'часа', 'часов')} назад`;
        let days = Math.floor(hours / 24);
        if (days < 21) return `${days} ${pluralize(days, 'день', 'дня', 'дней')} назад`;
        let weeks = Math.floor(days / 7);
        let months = Math.floor(days / 30.44);
        let years = Math.floor(days / 365.25);
        if (months < 3) return `${weeks} ${pluralize(weeks, 'неделю', 'недели', 'недель')} назад`;
        if (years < 3) return `${months} ${pluralize(months, 'месяц', 'месяца', 'месяцев')} назад`;
        return `${years} ${pluralize(years, 'год', 'года', 'лет')} назад`;
    }

    function writeBatchToDB(database, keysBatch, valsBatch, length) {
        const tx = database.transaction(['history'], 'readwrite');
        const store = tx.objectStore('history');
        const keys = keysBatch;
        const vals = valsBatch;
        let i = 0;
        const limit = length - 3;
        for (; i < limit; i += 4) {
            store.put(vals[i], keys[i]);
            store.put(vals[i + 1], keys[i + 1]);
            store.put(vals[i + 2], keys[i + 2]);
            store.put(vals[i + 3], keys[i + 3]);
        }
        for (; i < length; i++) {
            store.put(vals[i], keys[i]);
        }
    }

    async function initDatabase() {
        if (navigator.storage && navigator.storage.persist) {
            try {
                const isPersisted = await navigator.storage.persisted();
                if (!isPersisted) await navigator.storage.persist();
            } catch (e) {
                console.warn('YandexMusicAutoskip: Не удалось включить Persistent Storage.');
            }
        }
        const DB_NAME = 'YandexMusicAutoskipDB';
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = function(event) {
            let database = event.target.result;
            if (!database.objectStoreNames.contains('history')) {
                database.createObjectStore('history');
            }
        };

        request.onerror = function(event) {
            console.error('YandexMusicAutoskip: База данных повреждена. Пересоздание...', event.target.error);
            if (db) { db.close(); db = null; }
            const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
            deleteRequest.onsuccess = function() { initDatabase(); };
        };

        request.onsuccess = function(event) {
            db = event.target.result;
            let oldData = GM_getValue('ym_counter_v9', null);
            if (oldData) {
                try {
                    let history = (typeof oldData === 'string') ? JSON.parse(oldData) : oldData;
                    let keys = Object.keys(history);
                    let currentIndex = 0;
                    const BATCH_SIZE = 2000;

                    function writeMigrationBatch() {
                        if (!db || currentIndex >= keys.length) {
                            GM_setValue('ym_counter_v9', null);
                            GM_setValue('ym_base_format_v2', true);
                            keys = null;
                            history = null;
                            if (currentTrackKey) onTrackChanged(true);
                            return;
                        }
                        let transaction = db.transaction(['history'], 'readwrite');
                        let store = transaction.objectStore('history');
                        let limit = Math.min(currentIndex + BATCH_SIZE, keys.length);
                        for (let i = currentIndex; i < limit; i++) {
                            let oldKey = keys[i];
                            let parts = oldKey.split(' — ');
                            let newKey = oldKey;

                            if (parts.length > 1) {
                                newKey = parts.slice(1).join(' — ') + ' — ' + parts[0];
                            }
                            store.put(history[oldKey], newKey);
                        }
                        currentIndex = limit;
                        transaction.oncomplete = function() {
                            setTimeout(writeMigrationBatch, 5);
                        };
                    }
                    writeMigrationBatch();
                } catch (e) {
                    console.error('YandexMusicAutoskip: Ошибка миграции старых данных из LocalStorage', e);
                    GM_setValue('ym_base_format_v2', true);
                }
                return;
            }
            GM_setValue('ym_base_format_v2', true);
        };
    }

    async function importHistoryFromFile(event) {
        const files = event.target.files;
        if (!files || files.length === 0 || !db) return;
        const file = files[0];
        const impBox = document.getElementById('ym-autoskip-imp-box');
        if (impBox) {
            impBox.style.setProperty('border', '1px solid #ff9900', 'important');
            impBox.style.setProperty('box-shadow', '0 0 10px #ff9900', 'important');
        }
        const clearTx = db.transaction(['history'], 'readwrite');
        clearTx.objectStore('history').clear();
        clearTx.oncomplete = async function() {
            let totalTracks = 0;
            let batchIdx = 0;
            const BATCH_LIMIT = 3000;
            let keysBatch = new Array(BATCH_LIMIT).fill(null);
            let valsBatch = new Array(BATCH_LIMIT).fill(null);
            try {
                const fileText = await file.text();
                const regex = /"((?:[^"\\]|\\.)*)"\s*:\s*([0-9]+)/g;
                let match;
                while ((match = regex.exec(fileText)) !== null) {
                    const rawKeyInside = match[1];
                    if (rawKeyInside === "__version__") continue;
                    try {
                        const key = JSON.parse('"' + rawKeyInside + '"');
                        const val = parseInt(match[2], 10);
                        if (key && !isNaN(val)) {
                            keysBatch[batchIdx] = key;
                            valsBatch[batchIdx] = val;
                            batchIdx++;
                            totalTracks++;
                        }
                        if (batchIdx >= BATCH_LIMIT) {
                            writeBatchToDB(db, keysBatch, valsBatch, batchIdx);
                            keysBatch = new Array(BATCH_LIMIT).fill(null);
                            valsBatch = new Array(BATCH_LIMIT).fill(null);
                            batchIdx = 0;
                            await new Promise(resolve => setTimeout(resolve, 0));
                        }
                    } catch (e) {
                        console.warn('YandexMusicAutoskip: Пропущен поврежденный трек:', rawKeyInside, e);
                    }
                }
                if (batchIdx > 0) {
                    writeBatchToDB(db, keysBatch, valsBatch, batchIdx);
                }
                if (impBox) {
                    impBox.style.setProperty('border', '1px solid #00ff00', 'important');
                    impBox.style.setProperty('box-shadow', '0 0 15px #00ff00, inset 0 0 6px #00ff00', 'important');
                    impBox.style.setProperty('color', '#00ff00', 'important');
                    setTimeout(() => {
                        if(impBox) {
                            impBox.style.borderColor = '#ffffff';
                            impBox.style.boxShadow = '-1px 1px 5px rgba(0,0,0,0.4)';
                            impBox.style.color = '#ffffff';
                        }
                    }, 1500);
                }
                if (currentTrackKey) onTrackChanged(true);
                alert('Импорт завершен! Успешно восстановлено треков: ' + totalTracks);

            } catch (err) {
                console.error('Критическая ошибка импорта:', err);
                alert('Ошибка при импорте файла.');
            } finally {
                keysBatch = null;
                valsBatch = null;
            }
        };
        event.target.value = '';
    }

    function exportHistoryToFile() {
        if (!db) {
            initDatabase().then(() => executeExport()).catch(() => alert('Ошибка базы данных.'));
            return;
        }
        executeExport();
    }

    function executeExport() {
        if (!db) return;
        let transaction = db.transaction(['history'], 'readonly');
        let store = transaction.objectStore('history');
        let cursorRequest = store.openCursor();
        let chunks = ['\uFEFF{\n"__version__": 2'];
        let currentChunk = '';
        let recordCount = 0;
        let expBox = document.getElementById('ym-autoskip-exp-box');
        if (expBox) {
            expBox.style.setProperty('border', '1px solid #ff9900', 'important');
            expBox.style.setProperty('box-shadow', '0 0 10px #ff9900', 'important');
        }

        function cleanExportMemory() {
            chunks = null;
            currentChunk = null;
            if (expBox) {
                expBox.style.borderColor = '#ffffff';
                expBox.style.boxShadow = '-1px 1px 5px rgba(0,0,0,0.4)';
            }
        }

        cursorRequest.onerror = function() {
            cleanExportMemory();
            alert('Ошибка чтения базы данных при экспорте.');
        };

        cursorRequest.onsuccess = function(event) {
            let cursor = event.target.result;
            if (cursor) {
                currentChunk += ',\n' + JSON.stringify(cursor.key) + ':' + String(cursor.value).trim();
                recordCount++;
                if (recordCount % 5000 === 0) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                    setTimeout(() => { if (cursor) cursor.continue(); }, 0);
                } else {
                    cursor.continue();
                }
            } else {
                try {
                    if (currentChunk) chunks.push(currentChunk);
                    chunks.push('\n}');
                    let blob = new Blob(chunks, { type: 'application/json;charset=utf-8;' });
                    let blobUrl = URL.createObjectURL(blob);
                    let downloadAnchor = document.createElement('a');
                    downloadAnchor.href = blobUrl;
                    downloadAnchor.download = "yandex_music_history.json";
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    document.body.removeChild(downloadAnchor);
                    URL.revokeObjectURL(blobUrl);
                } finally {
                    cleanExportMemory();
                }
            }
        };
    }

    function getStatusColor(timestamp) {
        if (!timestamp) return '#8a2be2';
        let daysPassed = (Date.now() - timestamp) / 86400000;
        if (daysPassed < 11) return '#ff3333';
        if (daysPassed < 21) return '#ff9900';
        if (daysPassed < 42) return '#ffff00';
        if (daysPassed < 92) return '#00ff00';
        if (daysPassed < 183) return '#00ffff';
        if (daysPassed < 366) return '#0066ff';
        return '#8a2be2';
    }

    function injectStyles() {
        if (document.getElementById('ym-autoskip-styles')) return;
        let style = document.createElement('style');
        style.id = 'ym-autoskip-styles';
        style.innerText = `
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
            .ym-settings { top:0px!important; right:0px!important; width:auto!important; max-width:287px!important; cursor:default!important; user-select:none!important; pointer-events:auto!important; gap:3px!important; }
            .ym-notify { top:19px!important; right:42px!important; width:auto!important; max-width:245px!important; pointer-events:none!important; white-space:nowrap!important; }
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

    function createSettingsBox() {
        if (document.getElementById('ym-autoskip-box') || !document.body) return;
        injectStyles();
        let box = document.createElement('div');
        box.id = 'ym-autoskip-box';
        box.className = 'ym-base ym-settings';
        let isEnabled = GM_getValue('ym_autoskip_enabled', true);
        box.style.border = `1px solid ${isEnabled ? '#ffffff' : '#333333'}`;
        let label = document.createElement('label');
        label.style.cssText = 'cursor:pointer!important; gap:4px!important;';
        let checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.cssText = 'margin:0!important;width:11px!important;height:11px!important;cursor:pointer!important;flex-shrink:0!important;';
        checkbox.checked = isEnabled;
        let labelText = document.createElement('span');
        labelText.innerText = 'Скипать игравшее в последние';
        checkbox.addEventListener('change', (e) => {
            GM_setValue('ym_autoskip_enabled', e.target.checked);
            box.style.border = `1px solid ${e.target.checked ? '#ffffff' : '#333333'}`;
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
    }

    function showNotification(text, isSavedGreen = false, timestamp = null) {
        createSettingsBox();
        let notifyBox = document.getElementById('ym-history-notify');
        if (!notifyBox || !document.body.contains(notifyBox)) {
            if (notifyBox) notifyBox.remove();
            notifyBox = document.createElement('div');
            notifyBox.id = 'ym-history-notify';
            notifyBox.className = 'ym-base ym-notify';
            document.body.appendChild(notifyBox);
        }
        notifyBox.innerText = text;
        let color = getStatusColor(timestamp);
        let baseStyleAddition = isSavedGreen ? 'border:1px solid #00ff00!important;box-shadow:0 0 15px #00ff00,inset 0 0 6px #00ff00!important;color:#00ff00!important;' : `border:1px solid ${isTrackSaved ? '#ffffff' : color}!important;`;
        notifyBox.style.cssText = baseStyleAddition;
        if (isSavedGreen) {
            if (notifyTimeoutId) clearTimeout(notifyTimeoutId);
            notifyTimeoutId = setTimeout(() => {
                let currentNotifyBox = document.getElementById('ym-history-notify');
                if (currentNotifyBox && document.body.contains(currentNotifyBox)) {
                    currentNotifyBox.style.borderColor = isTrackSaved ? '#ffffff' : color;
                    currentNotifyBox.style.color = 'rgba(255,255,255,1.0)';
                    currentNotifyBox.style.boxShadow = '-1px 1px 5px rgba(0,0,0,0.4)';
                }
                notifyTimeoutId = null;
            }, 1000);
        }
    }

    function skipTrk() {
    }

    function checkAndTriggerSkip() {
        if (skipTimeoutId) {
            clearTimeout(skipTimeoutId);
            skipTimeoutId = null;
        }
        if (lastPlayedTimestamp && GM_getValue('ym_autoskip_enabled', true)) {
            if (Math.floor((Date.now() - lastPlayedTimestamp) / 86400000) <= GM_getValue('ym_autoskip_days', 10)) {
                let delay = skipsCount > 7 ? Math.random() * 543 + 567 : Math.random() * 321 + 345;
                skipTimeoutId = setTimeout(() => {
                    const downEvent = new KeyboardEvent('keydown', cachedKeyEvent);
                    const upEvent = new KeyboardEvent('keyup', cachedKeyEvent);
                    document.dispatchEvent(downEvent);
                    window.dispatchEvent(downEvent);
                    setTimeout(() => {
                        document.dispatchEvent(upEvent);
                        window.dispatchEvent(upEvent);
                    }, Math.random() * 30 + 30);
                    skipsCount++;
                    skipTimeoutId = null;
                }, delay);
            } else {
                skipsCount = 0;
            }
        }
    }

    function onTrackChanged(forceUpdate = false) {
        if (newtrackKey === currentTrackKey && !forceUpdate) return;
        if (skipTimeoutId) { clearTimeout(skipTimeoutId); skipTimeoutId = null; }
        if (!db) {
            statusText = 'Трек играет впервые';
            lastPlayedTimestamp = null;
            showNotification(statusText, false, null);
            let checkDbInterval = setInterval(() => {
                if (db) {
                    clearInterval(checkDbInterval);
                    onTrackChanged(true);
                }
            }, 100);
            return;
        }
        let transaction = db.transaction(['history'], 'readonly');
        let store = transaction.objectStore('history');
        let getRequest = store.get(newtrackKey);
        getRequest.onsuccess = function(event) {
            let lastPlay = event.target.result;
            if (lastPlay) {
                lastPlayedTimestamp = parseInt(lastPlay, 10);
                statusText = `Последний раз трек играл ${getRelativeTimeStr(lastPlayedTimestamp)}`;
                checkAndTriggerSkip();
            } else {
                statusText = 'Трек играет впервые';
                lastPlayedTimestamp = null;
            }
            showNotification(statusText, false, lastPlayedTimestamp);
        };
        currentTrackKey = newtrackKey;
        isTrackSaved = false;
    }

    (async function() {
        while (typeof MediaSession === 'undefined' || !navigator.mediaSession) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        let originalMetadataSetter = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata').set;
        Object.defineProperty(MediaSession.prototype, 'metadata', {
            set: function(metadata) {
                if (metadata && metadata.title) {
                    originalMetadataSetter.call(this, metadata);
                    setTimeout(() => {
                        let title = metadata.title;
                        const artist = metadata.artist || '';
                        const vibeTrackNameEl = document.querySelector('[class*="VibePlayerbarTrackName_trackNameText__"]');
                        if (vibeTrackNameEl) {
                            const domText = vibeTrackNameEl.textContent ? vibeTrackNameEl.textContent.trim() : "";
                            if (domText && domText.toLowerCase().includes(title.toLowerCase())) title = domText;
                        } else {
                            let version = document.querySelector([
                                '[class*="NowPlayingBlock"] [class*="Meta_version__"]',
                                '[class*="FullscreenPlayerDesktopContent_title__"] [class*="Meta_version__"]',
                                '[class*="PlayerBar"] [class*="Meta_version__"]',
                                '[class*="FullscreenPlayerMobileContent_metaText__"] [class*="Meta_version__"]'
                            ].join(', '));
                            if (version && version.textContent.trim()) {
                                version = version.textContent.trim().replace(/\u00A0/g, ' ').replace(/^[\(\[](.*)[\)\]]$/, '$1').trim();
                                const lowerVersion = version.toLowerCase();
                                if (lowerVersion && !title.toLowerCase().includes(lowerVersion)) title = `${title} (${version})`;
                            }
                        }
                        newtrackKey = artist ? `${artist} — ${title}` : title;
                        if (newtrackKey !== currentTrackKey) onTrackChanged();
                    }, 0);
                }
            },
            configurable: true
        });
    })();

    function initHtml5AudioTracking() {
        try {
            const origPlay = HTMLAudioElement.prototype.play;
            HTMLAudioElement.prototype.play = function (...args) {
                const audio = this;
                if (!audio._ym_autoskip_tracked) {
                    audio._ym_autoskip_tracked = true;
                    audio.addEventListener('timeupdate', () => {
                        if (isTrackSaved || !newtrackKey) return;
                        const currentTime = audio.currentTime;
                        if (isNaN(currentTime)) return;
                        const duration = audio.duration;
                        if (isNaN(duration) || duration <= 0) return;
                        const midpoint = duration / 2;
                        if (currentTime >= midpoint && currentTime <= midpoint + 5) {
                            const now = Date.now();
                            if (db) {
                                const transaction = db.transaction(['history'], 'readwrite');
                                transaction.objectStore('history').put(now, currentTrackKey);
                            }
                            isTrackSaved = true;
                            showNotification(statusText, true, now);
                        }
                    });
                }
                return origPlay.apply(this, args);
            };
        } catch (e) {
            console.error("YandexMusicAutoskip: Не удалось запустить перехват версий", e);
        }
    }

    initHtml5AudioTracking();

    window.addEventListener('beforeunload', () => {
        if (skipTimeoutId) clearTimeout(skipTimeoutId);
        if (notifyTimeoutId) clearTimeout(notifyTimeoutId);
    });

    initDatabase();

    if (document.body) { createSettingsBox(); } else { window.addEventListener('DOMContentLoaded', createSettingsBox); }
})();
