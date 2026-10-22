// ==UserScript==
// @name         Yandex Music Autoskip
// @namespace    http://tampermonkey.net/
// @version      40.2
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
    let skipTimeoutId = null;

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
        if (days < 14) return `${days} ${pluralize(days, 'день', 'дня', 'дней')} назад`;

        let weeks = (days / 7) | 0;
        let months = (days / 30.44) | 0;
        let years = (days / 365.25) | 0;

        if (months < 2) return `${weeks} ${pluralize(weeks, 'неделю', 'недели', 'недель')} назад`;
        if (years < 2) return `${months} ${pluralize(months, 'месяц', 'месяца', 'месяцев')} назад`;
        return `${years} ${pluralize(years, 'год', 'года', 'лет')} назад`;
    }

   // --- УПРАВЛЕНИЕ ХРАНИЛИЩЕМ INDEXEDDB С АВТОКОНВЕРТАЦИЕЙ ФОРМАТА ---
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

        // ОБРАБОТКА ПОВРЕЖДЕНИЯ БАЗЫ ДАННЫХ
        request.onerror = function(event) {
            console.error('YandexMusicAutoskip: База данных повреждена или заблокирована. Попытка автоматического пересоздания...', event.target.error);

            // Закрываем соединение, если оно было частично открыто
            if (db) {
                db.close();
                db = null;
            }

            // Удаляем поврежденную базу данных
            const deleteRequest = indexedDB.deleteDatabase(DB_NAME);

            deleteRequest.onsuccess = function() {
                console.warn('YandexMusicAutoskip: Поврежденная база данных успешно удалена. Инициализация новой базы...');
                // Рекурсивно вызываем инициализацию заново, чтобы создать чистую базу
                initDatabase();
            };

            deleteRequest.onerror = function() {
                console.error('YandexMusicAutoskip: КРИТИЧЕСКАЯ ОШИБКА. Не удалось удалить поврежденную базу данных.');
            };
        };

        request.onsuccess = function(event) {
            db = event.target.result;

            // Проверяем, нужно ли выполнить миграцию из LocalStorage (для совсем старых версий)
            let oldData = GM_getValue('ym_counter_v9', null);
            if (oldData) {
                try {
                    let history = (typeof oldData === 'string') ? JSON.parse(oldData) : oldData;
                    let transaction = db.transaction(['history'], 'readwrite');
                    let store = transaction.objectStore(['history']);
                    for (let key in history) {
                        let parts = key.split(' — ');
                        let newKey = parts.slice(1).join(' — ') + ' — ' + parts[0];
                        store.put(history[key], newKey);
                    }
                    transaction.oncomplete = function() {
                        GM_setValue('ym_counter_v9', null);
                        GM_setValue('ym_base_format_v2', true);
                    };
                } catch (e) {
                    console.error('YandexMusicAutoskip: Ошибка миграции старых данных из LocalStorage', e);
                }
                return;
            }

            // ПРОВЕРКА И КОНВЕРТАЦИЯ СТАРОЙ БАЗЫ INDEXEDDB В НОВЫЙ ФОРМАТ
            if (!GM_getValue('ym_base_format_v2', false)) {
                try {
                    let tx = db.transaction(['history'], 'readonly');
                    let store = tx.objectStore('history');
                    let keysRequest = store.getAllKeys();
                    let valuesRequest = store.getAll();

                    tx.oncomplete = function() {
                        let oldKeys = keysRequest.result;
                        let oldValues = valuesRequest.result;

                        if (oldKeys.length > 0) {
                            let writeTx = db.transaction(['history'], 'readwrite');
                            let writeStore = writeTx.objectStore('history');
                            writeStore.clear();

                            for (let i = 0; i < oldKeys.length; i++) {
                                let parts = oldKeys[i].split(' — ');
                                let newKey = parts.slice(1).join(' — ') + ' — ' + parts[0];
                                writeStore.put(oldValues[i], newKey);
                            }
                            writeTx.oncomplete = function() {
                                GM_setValue('ym_base_format_v2', true);
                                console.log('YandexMusicAutoskip: База данных успешно конвертирована в формат Исполнитель — Трек');
                            };
                        } else {
                            GM_setValue('ym_base_format_v2', true);
                        }
                    };
                    tx.onerror = function() {
                        console.error('YandexMusicAutoskip: Ошибка чтения при конвертации формата базы данных.');
                    };
                } catch (e) {
                    console.error('YandexMusicAutoskip: Не удалось запустить конвертацию формата базы данных.', e);
                }
            }
        };
    }

    function importHistoryFromFile(event) {
        let file = event.target.files;
        if (!file || !db) return;

        let reader = new FileReader();
        reader.onload = function(e) {
            try {
                // Для миллионной базы этот шаг потребует памяти, но порционная запись спасет от OOM в IndexedDB
                let importedData = JSON.parse(e.target.result);
                let isNewFormatFile = importedData["__version__"] === 2;
                delete importedData["__version__"];

                let keys = Object.keys(importedData);
                let totalTracks = keys.length;
                let currentIndex = 0;

                // Оптимальный размер пачки для миллиона записей, чтобы Main Thread не блокировался дольше 16мс (1 кадр)
                const BATCH_SIZE = 1500;

                let impBox = document.getElementById('ym-autoskip-imp-box');
                if (impBox) {
                    impBox.style.setProperty('border', '1px solid #ff9900', 'important');
                    impBox.style.setProperty('box-shadow', '0 0 10px #ff9900', 'important');
                }

                let clearTx = db.transaction(['history'], 'readwrite');
                clearTx.objectStore('history').clear();

                clearTx.oncomplete = function() {
                    function writeNextBatch() {
                        if (currentIndex >= totalTracks) {
                            // Успешное завершение
                            if (impBox) {
                                impBox.style.setProperty('border', '1px solid #00ff00', 'important');
                                impBox.style.setProperty('box-shadow', '0 0 15px #00ff00, inset 0 0 6px #00ff00', 'important');
                                impBox.style.setProperty('color', '#00ff00', 'important');
                                let impBtn = impBox.querySelector('.ym-btn');
                                if (impBtn) impBtn.style.setProperty('color', '#00ff00', 'important');

                                setTimeout(() => {
                                    impBox.style.borderColor = '#ffffff';
                                    impBox.style.boxShadow = '-1px 1px 5px rgba(0,0,0,0.4)';
                                    impBox.style.color = '#ffffff';
                                    if (impBtn) impBtn.style.setProperty('color', '#ffffff', 'important');
                                }, 1500);
                            }

                            if (currentTrackKey) {
                                onTrackChanged(currentTrackKey, null, true);
                            }

                            // Освобождаем память памяти принудительно
                            importedData = null;
                            keys = null;

                            alert('Импорт успешно завершен! Обработано треков: ' + totalTracks);
                            return;
                        }

                        let tx = db.transaction(['history'], 'readwrite');
                        let store = tx.objectStore('history');
                        let limit = Math.min(currentIndex + BATCH_SIZE, totalTracks);

                        for (let i = currentIndex; i < limit; i++) {
                            let key = keys[i];
                            let value = importedData[key];

                            if (!isNewFormatFile) {
                                let parts = key.split(' — ');
                                key = parts.slice(1).join(' — ') + ' — ' + (parts[0] || '');
                            }

                            store.put(value, key);
                        }

                        currentIndex = limit;

                        tx.oncomplete = function() {
                            // Небольшой таймаут в 10мс позволяет браузеру обработать клики/клипы в этот момент
                            setTimeout(writeNextBatch, 10);
                        };

                        tx.onerror = function(err) {
                            console.error('Ошибка IndexedDB при импорте пачки:', err);
                            alert('Произошла ошибка при записи данных.');
                        };
                    }

                    writeNextBatch();
                };
            } catch(err) {
                alert('Ошибка: Файл поврежден или имеет неверный формат.');
                console.error(err);
            }
        };
        reader.readAsText(file[0]);
        event.target.value = '';
    }


    function exportHistoryToFile() {
        if (!db) {
            initDatabase().then(() => {
                executeExport();
            }).catch((err) => {
                console.error(err);
                alert('Критическая ошибка базы данных. Попробуйте очистить кэш сайта Яндекс Музыка или перезапустить браузер.');
            });
            return;
        }
        executeExport();
    }

    function executeExport() {
        if (!db) return;

        let transaction = db.transaction(['history'], 'readonly');
        let store = transaction.objectStore('history');
        let cursorRequest = store.openCursor();

        let chunks = ['{\n"__version__": 2'];
        let currentChunk = '';
        let recordCount = 0;

        let expBox = document.getElementById('ym-autoskip-exp-box');
        if (expBox) {
            expBox.style.setProperty('border', '1px solid #ff9900', 'important');
            expBox.style.setProperty('box-shadow', '0 0 10px #ff9900', 'important');
        }

        cursorRequest.onsuccess = function(event) {
            let cursor = event.target.result;
            if (cursor) {
                currentChunk += ',\n' + JSON.stringify(cursor.key) + ':' + JSON.stringify(cursor.value);
                recordCount++;

                // Каждые 2000 записей сбрасываем строку в Blob-чанк, освобождая оперативную память
                if (recordCount % 2000 === 0) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                    // Передаем управление браузеру на 1 микросекунду, чтобы интерфейс не зависал
                    setTimeout(() => cursor.continue(), 0);
                } else {
                    cursor.continue();
                }
            } else {
                // Финализируем экспорт
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

                // Явно очищаем ссылки для сборщика мусора (GC)
                chunks = null;
                currentChunk = null;

                if (expBox) {
                    expBox.style.borderColor = '#ffffff';
                    expBox.style.boxShadow = '-1px 1px 5px rgba(0,0,0,0.4)';
                }
            }
        };
    }

    function getStatusColor(timestamp) {
        if (!timestamp) return '#8a2be2';
        let daysPassed = (Date.now() - timestamp) / 86400000;
        if (daysPassed < 11) return '#ff3333';
        if (daysPassed < 21) return '#ff9900';
        if (daysPassed < 31) return '#ffff00';
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

    function updateBorders() {
        let isEnabled = GM_getValue('ym_autoskip_enabled', true);
        let borderStyle = `1px solid ${isEnabled ? '#ffffff' : '#333333'}`;
        let settingsBox = document.getElementById('ym-autoskip-box');
        if (settingsBox) settingsBox.style.setProperty('border', borderStyle, 'important');
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
            PlaybackController.checkAndTriggerSkip();
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

    function checkAndTriggerSkip() {
        if (skipTimeoutId) {
            clearTimeout(skipTimeoutId);
            skipTimeoutId = null;
        }

        if (lastPlayedTimestamp && GM_getValue('ym_autoskip_enabled', true)) {
            if ((((Date.now() - lastPlayedTimestamp) / 86400000) | 0) <= GM_getValue('ym_autoskip_days', 10)) {
                let delay = skipsCount > 7 ? Math.random() * 543 + 567 : Math.random() * 321 + 345;
                skipTimeoutId = setTimeout(() => {
                    skipTrk();
                    skipTimeoutId = null;
                }, delay);
            } else {
                skipsCount = 0;
            }
        }
    }

    // ИСПРАВЛЕНО: Формат изменен на Исполнитель — Название трека
    function onTrackChanged(title, artist, forceUpdate = false) {
        let trackKey = artist ? `${artist} — ${title}` : title;
        if (trackKey === currentTrackKey && !forceUpdate) return;

        if (skipTimeoutId) {
            clearTimeout(skipTimeoutId);
            skipTimeoutId = null;
        }

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
