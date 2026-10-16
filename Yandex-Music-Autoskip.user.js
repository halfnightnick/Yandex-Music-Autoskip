// ==UserScript==
// @name         Yandex Music Autoskip
// @namespace    http://tampermonkey.net/
// @version      36.0
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
    let skipsCount = 0;              // Счётчик последовательных автопропусков
    let currentTrackKey = null;      // Уникальный ключ текущего трека ("Название — Исполнитель")
    let isTrackSaved = false;        // Флаг: был ли текущий трек уже сохранён в историю (на середине)
    let lastPlayedTimestamp = null;  // Временная метка, когда трек играл в последний раз
    let statusText = 'Трек играет впервые'; // Текст для отображения на информационной панели

    // Кэш истории прослушиваний в оперативной памяти (для исключения чтения диска каждую секунду)
    let cachedHistory = null;

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

    /**
     * Функция для склонения дней, часов, минут и т.д. (плюрализация)
     */
    const pluralize = (number, form1, form2, form5) => {
        number = Math.abs(number) % 100;
        let lastDigit = number % 10;
        if (number > 10 && number < 20) return form5;
        if (lastDigit > 1 && lastDigit < 5) return form2;
        if (lastDigit === 1) return form1;
        return form5;
    };

    /**
     * Получение истории прослушиваний из локального хранилища браузера (с кэшированием)
     */
    function getHistory(forceReload = false) {
        // Если кэш в памяти существует и принудительное обновление не требуется — возвращаем кэш
        if (cachedHistory && !forceReload) {
            return cachedHistory;
        }

        try {
            // Загружаем строку из хранилища Tampermonkey и парсим её в объект
            let history = JSON.parse(GM_getValue('ym_counter_v9', null)) || {};

            // Записываем данные в оперативную память и возвращаем
            cachedHistory = history;
            return history;
        } catch(error) {
            return cachedHistory || {};
        }
    }
    /**
     * Преобразование временной метки в относительную текстовую строку (например, "3 дня назад")
     */
    function getRelativeTimeStr(timestamp) {
        if (!timestamp) return null;

        let diffMs = Date.now() - timestamp;
        if (isNaN(diffMs) || diffMs < 0) return null;

        let minutes = Math.floor(diffMs / 60000);
        let hours = Math.floor(diffMs / 3600000);
        let days = Math.floor(diffMs / 86400000);

        if (minutes < 1) return 'только что';
        if (minutes < 60) return `${minutes} ${pluralize(minutes, 'минуту', 'минуты', 'минут')} назад`;
        if (hours < 24) return `${hours} ${pluralize(hours, 'час', 'часа', 'часов')} назад`;
        if (days < 7) return `${days} ${pluralize(days, 'день', 'дня', 'дней')} назад`;

        let weeks = Math.floor(days / 7);
        let months = Math.floor(days / 30.44);
        let years = Math.floor(days / 365.25);

        if (months < 1) return `${weeks} ${pluralize(weeks, 'неделю', 'недели', 'недель')} назад`;
        if (years < 1) return `${months} ${pluralize(months, 'месяц', 'месяца', 'месяцев')} назад`;
        return `${years} ${pluralize(years, 'год', 'года', 'лет')} назад`;
    }

    /**
     * Определение цвета рамки информационной панели в зависимости от давности прослушивания трека
     */
    function getStatusColor(timestamp) {
        if (!timestamp) return '#8a2be2'; // Фиолетовый (для новых треков)
        let daysPassed = (Date.now() - timestamp) / 86400000;
        if (daysPassed < 10)  return '#ff3333'; // Красный (играл совсем недавно)
        if (daysPassed < 20)  return '#ff9900'; // Оранжевый
        if (daysPassed < 30)  return '#ffff00'; // Желтый
        if (daysPassed < 90)  return '#00ff00'; // Зеленый
        if (daysPassed < 180) return '#00ffff'; // Голубой
        if (daysPassed < 360) return '#0066ff'; // Синий
        return '#8a2be2';                       // Фиолетовый (играл больше года назад)
    }

    // --- CSS СТИЛИ ДЛЯ ИНТЕРФЕЙСА СКРИПТА ---
    const BASE_STYLE = `position:fixed!important;right:0!important;background:rgba(20,20,20,0.85)!important;backdrop-filter:blur(4px)!important;border-radius:6px!important;z-index:2147483647!important;font:10px system-ui,sans-serif!important;box-shadow:-1px 1px 5px rgba(0,0,0,0.4)!important;box-sizing:border-box!important;line-height:1.2!important;height:18px!important;padding:2px 8px!important;display:flex!important;align-items:center!important;`;
    const STYLE_SETTINGS_BOX = BASE_STYLE + `top:0!important;width:280px!important;cursor:default!important;user-select:none!important;pointer-events:auto!important;color:rgba(255,255,255,0.7)!important;`;
    const STYLE_NOTIFY_BOX   = BASE_STYLE + `pointer-events:none!important;justify-content:flex-end!important;color:rgba(255,255,255,0.85)!important;white-space:nowrap!important;`;

    /**
     * Функция автоматического пропуска трека (Клавиатурный метод + клик-подстраховка)
     */
    function skipTrk() {
        skipsCount++;
        // Помечаем все аудио-элементы специальным дата-атрибутом, чтобы скрипт знал об автопропуске
        document.querySelectorAll('audio').forEach(audio => audio.dataset.ymSkipping = "true");

        // Создаем клавиатурное событие нажатия клавиши 'N' (дефолтная кнопка "Вперед" в Яндекс Музыке)
        let keyEvent = { key: 'n', code: 'KeyN', keyCode: 78, which: 78, bubbles: true, cancelable: true };
        window.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
        window.dispatchEvent(new KeyboardEvent('keyup', keyEvent));
    }

    /**
     * Обновление цвета границ элементов интерфейса в зависимости от того, включен ли автоскип
     */
    function updateBorders() {
        let box = document.getElementById('ym-autoskip-box');
        if (box) {
            let isEnabled = GM_getValue('ym_autoskip_enabled', true);
            box.style.setProperty('border', `1px solid ${isEnabled ? '#ffffff' : '#333333'}`, 'important');
        }
    }

    /**
     * Проверка необходимости пропуска текущего трека
     */
    function checkAndTriggerSkip() {
        let isEnabled = GM_getValue('ym_autoskip_enabled', true);
        let skipDaysLimit = GM_getValue('ym_autoskip_days', 10);

        if (lastPlayedTimestamp && isEnabled) {
            let daysSinceLastPlay = (Date.now() - lastPlayedTimestamp) / 86400000;
            if (daysSinceLastPlay < skipDaysLimit) {
                let delay = skipsCount > 10 ? Math.random() * 100 + 1500 : Math.random() * 10 + 50;
                setTimeout(skipTrk, delay);
                skipsCount = skipsCount > 10 ? 0 : skipsCount;
            } else {
                skipsCount = 0;
            }
        }
    }

    /**
     * Создание верхней панели управления (чекбокс и поллунок выбора дней)
     */
    function createSettingsBox() {
        let box = document.getElementById('ym-autoskip-box');
        if (box || !document.body) return;

        let styleTag = document.createElement('style');
        styleTag.innerText = `#ym-rng::-webkit-slider-thumb{-webkit-appearance:none!important;width:6px!important;height:6px!important;border-radius:50%!important;background:#fff!important;} #ym-rng::-moz-range-thumb{width:6px!important;height:6px!important;border-radius:50%!important;background:#fff!important;border:none!important;}`;
        document.head.appendChild(styleTag);

        box = document.createElement('div');
        box.id = 'ym-autoskip-box';
        box.style.cssText = STYLE_SETTINGS_BOX;

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
        rangeInput.style.cssText = '-webkit-appearance:none!important;background:#555!important;width:45px!important;height:2px!important;cursor:pointer!important;margin:0 6px 0 6px!important;flex-shrink:0!important;outline:none!important;';

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
    /**
     * Отображение плашки с информацией о последнем воспроизведении трека
     */
    function showNotification(text, isSavedGreen = false, timestamp = null, isNewTrack = false) {
        let notifyBox = document.getElementById('ym-history-notify');
        let settingsBox = document.getElementById('ym-autoskip-box');

        // Восстанавливаем элементы интерфейса в DOM, если Яндекс Музыка их удалила
        if (settingsBox && settingsBox.parentElement !== document.body) {
            document.body.appendChild(settingsBox);
            updateBorders();
        }
        if (!notifyBox) {
            notifyBox = document.createElement('div');
            notifyBox.id = 'ym-history-notify';
            document.body.appendChild(notifyBox);
        } else if (notifyBox.parentElement !== document.body) {
            document.body.appendChild(notifyBox);
        }

        notifyBox.innerText = text;
        let color = getStatusColor(timestamp);
        let borderStyle = `border:1px solid ${isTrackSaved ? '#ffffff' : color}!important;`;

        // Подсвечиваем неоново-зеленым при сохранении трека на середине
        notifyBox.style.cssText = STYLE_NOTIFY_BOX + (isSavedGreen ? `border:1px solid #00ff00!important;box-shadow:0 0 15px #00ff00,inset 0 0 6px #00ff00!important;color:#00ff00!important;font-weight:bold!important;` : borderStyle);
        if (settingsBox) notifyBox.style.top = `${settingsBox.offsetHeight + 1}px`;
        updateBorders();

        if (isSavedGreen) {
            setTimeout(() => {
                if (notifyBox.innerText === text) {
                    notifyBox.style.cssText = STYLE_NOTIFY_BOX + borderStyle;
                    if (settingsBox) notifyBox.style.top = `${settingsBox.offsetHeight + 1}px`;
                }
            }, 1000);
        }
    }

    // Флаг-предохранитель: показывает, что сменился трек и плеер готов к одной проверке на скип
    let isReadyToCheck = false;

    /**
     * Обработчик смены музыкального трека
     */
    function onTrackChanged(title, artist, forceUpdate = false) {
        if (!title || title === "Яндекс Музыка") return;

        let trackKey = `${title.trim()} — ${artist ? artist.trim() : 'Неизвестный исполнитель'}`;
        if (trackKey === currentTrackKey && !forceUpdate) return;

        let isNewTrack = (trackKey !== currentTrackKey);
        if (isNewTrack) {
            currentTrackKey = trackKey;
            isTrackSaved = false;
            isReadyToCheck = true; // Разрешаем проверку автоскипа для этого нового трека
        }

        let history = getHistory();
        let lastPlay = history[trackKey];

        if (lastPlay) {
            lastPlayedTimestamp = parseInt(lastPlay, 10);
            statusText = `Последний раз трек играл ${getRelativeTimeStr(lastPlayedTimestamp)}`;
        } else {
            statusText = 'Трек играет впервые';
            lastPlayedTimestamp = null;
        }

        showNotification(statusText, false, lastPlayedTimestamp, isNewTrack);
    }

    /**
     * Проверка прогресса воспроизведения (вызывается по событию timeupdate браузера)
     */
    function checkPlaybackProgress(event) {
        if (!currentTrackKey || isTrackSaved || !event.target.duration || event.target.dataset.ymSkipping === "true") return;

        let midpoint = event.target.duration / 2;
        if (event.target.currentTime >= midpoint && event.target.currentTime <= midpoint + 2) {
            isTrackSaved = true;
            let history = getHistory();
            let now = Date.now();
            history[currentTrackKey] = now;

            try {
                GM_setValue('ym_counter_v9', JSON.stringify(history));
                getHistory(true);
            } catch(err) {}

            showNotification(statusText, true, now, false);
        }
    }

    /**
     * Инициализация аудио-элемента строго по событиям
     */
    function initAudioElement(audio) {
        if (audio.dataset.ymM) return;
        audio.dataset.ymM = "true";

        // Отслеживаем прогресс проигрывания для сохранения трека в историю
        audio.addEventListener('timeupdate', checkPlaybackProgress);

        // ОБЪЕДИНЕННЫЙ ВАРИАНТ: Проверяем необходимость скипа строго в момент старта звука,
        // но только если флаг подтверждает, что это действительно новый трек (isReadyToCheck)
        audio.addEventListener('play', () => {
            if (isReadyToCheck && audio.dataset.ymSkipping !== "true") {
                isReadyToCheck = false; // Сразу закрываем замок, чтобы обычные паузы не вызывали повторный скип

                // Микро-пауза в 50мс гарантирует, что плеер успел среагировать на поток данных
                setTimeout(checkAndTriggerSkip, 50);
            }
        });
    }

    // --- ПЕРЕХВАТ СОБЫТИЙ БРАУЗЕРА И ИНТЕГРАЦИЯ ---

    // Перехват динамического создания аудио-элементов через createElement
    document.createElement = (function(originalMethod) {
        return function(tagName, options) {
            let element = originalMethod.call(document, tagName, options);
            if (tagName && tagName.toLowerCase() === 'audio') {
                initAudioElement(element);
            }
            return element;
        };
    })(document.createElement);

    // Мгновенный перехват метаданных трека через MediaSession API
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

    // Первичная инициализация истории
    getHistory(true);

    // Безопасный запуск отрисовки интерфейса сразу при загрузке страницы
    if (document.body) {
        createSettingsBox();
    } else {
        // Если тело страницы еще не готово, ждем его полной загрузки браузером
        window.addEventListener('DOMContentLoaded', createSettingsBox);
    }
})();
