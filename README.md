# Yandex-Music-Autoskip


Пользовательский скрипт для браузера, который накапливает историю прослушиваний Яндекс Музыки, отображает, когда трек играл последний раз, и, в зависимости от желания пользователя, автоматически скипает треки, игравшие в последние "X" дней ("X" можно выбрать в диапазоне от 3 до 30 дней, по умолчанию 10)

## Как работает:

Скрипт накапливает историю прослушиваний Яндекс Музыки и отображает в правом верхнем углу два окошка:

<img width="280" height="37" alt="YM-Autoskip" src="https://github.com/user-attachments/assets/a5754c95-4e2c-40eb-8a5d-dca3d32f90bf" />


Первое окошко позволяет с помощью галочки управлять автоскипом треков, которые играли в последние "X" дней, а также с помощью ползунка настроить "X" в диапазоне от 3 до 30 дней (по-умолчанию 10).

Второе окошко показывает, когда трек играл в последний раз, а также, пока не проиграется половина трека, подсвечивается рамкой разных цветов в зависимости от того, как давно последний раз играл трек: от красного, если играл недавно, до фиолетового, если играл очень давно или не играл никогда. По достижении половины трека окошко загорается зелёным цветом, это значит, что трек сохранился в историю прослушиваний. После этого рамка окошка остаётся белой до конца воспроизведения, чтобы было видно, что история успешно обновилась.



# ВАЖНО:

1. После первой установки история прослушиваний в базе скрипта пустая, поэтому все треки будут отображаться в статусе "Трек играет впервые", и скипаться начнут, когда скрипт встретит их повторно. Поэтому придётся подождать какое-то время, пока история наполнится, просто слушайте музыку.
2. Если понадобится переустановить браузер, чтобы история прослушиваний сохранилась, нужно зайти в панель управления Tampermonkey:

<img width="375" height="375" alt="YM-Export-Import0" src="https://github.com/user-attachments/assets/d62c06bc-7491-4993-97fe-479b83b7ae1e" />

Экспортировать её до переустановки, а после переустановки браузера импортировать обратно:

<img width="1920" height="991" alt="YM-Export-Import" src="https://github.com/user-attachments/assets/1b84ae81-04da-45c6-94a1-13d3ce34497e" />


## Процесс установки скрипта:

1. Установите расширение Tampermonkey для вашего браузера:

<a href="https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo/"><img width="160" height="50" alt="1" src="https://github.com/user-attachments/assets/35207113-c149-4d21-a57b-f925b65703d7" alt="Chrome"></a>
<a href="https://addons.opera.com/en/extensions/details/tampermonkey-beta/"><img width="160" height="50" alt="1" src="https://github.com/user-attachments/assets/047b7d71-ce58-48c5-87c4-db3f401bbbf8" alt="Opera"></a>
<a href="https://addons.mozilla.org/ru/firefox/addon/tampermonkey/"><img width="160" height="50" alt="1" src="https://github.com/user-attachments/assets/0bc978f9-f80f-4d4f-a112-db63924fdeda" alt="Firefox"></a>
<a href="https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd/"><img width="160" height="50" alt="1" src="https://github.com/user-attachments/assets/e81ad0ae-4bb2-4a5d-bd89-42536246418b" alt="Edge"></a>
<a href="https://apps.apple.com/app/tampermonkey/id1482490089/"><img width="160" height="50" alt="1" src="https://github.com/user-attachments/assets/6a8ed7fe-0ff0-42ef-b79c-c3faa2a7d5f4" alt="Safari"></a>

2. [Разрешите выполнение userscript’ов и режим разработчика](https://www.tampermonkey.net/faq.php?locale=ru#Q209) в вашем браузере.
3. Нажмите на ссылку ниже, чтобы установить скрипт:
   <br>**[Установить скрипт](https://github.com/halfnightnick/Yandex-Music-Autoskip/raw/refs/heads/main/Yandex-Music-Autoskip.user.js)**
4. В открывшемся окне Tampermonkey нажмите **«Установить»** (Install).
