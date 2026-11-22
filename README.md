# Link Extractor для Remnawave

Добавляет в подписки Remnawave ключи со сторонних серверов, панелей и провайдеров без ботов и ручной работы.

Вставляете ключи `vless://`, `vmess://`, `trojan://`, `ss://`, `hysteria2://`, `tuic://` или ссылку на подписку, а экстрактор:

- расшифровывает ключи и подписки, включая base64, Xray JSON, sing-box JSON и Clash/Mihomo YAML;
- создаёт в панели **внутренний сквад** и **хосты** с тегом из названия;
- выдаёт ключи только юзерам из этого сквада, в любом формате клиента (base64, Clash/Mihomo, sing-box, Xray JSON для Happ/v2rayNG);
- собирает ключи в **группы по странам**: одна точка входа «🇺🇸 США» с автовыбором по пингу и общий автовыбор «⚡ Авто · все страны», а сами ключи становятся скрытыми хостами;
- сам обновляет подписки-источники по таймеру;
- шлёт **уведомления в Telegram**: новые и пропавшие ключи, ошибки подписок, обновления;
- **обновляется сам** с GitHub без захода на сервер;
- добавляет пункт «Экстрактор ссылок» в меню панели.

## Как это работает

```
клиент → reverse proxy → link-extractor → remnawave-subscription-page → Remnawave
                              │
                              └─ подменяет хосты-заглушки на настоящие ключи
```

1. На каждый ключ в Remnawave создаётся **скрытый** хост на **инбаунде-заглушке**: профиль без нод, например `Balancer`. Адрес хоста имеет вид `server.le-xxxxxxxx`, тег хоста берётся из названия.
2. Хост закрыт сквадом источника (`ALLOW_ONLY`), поэтому Remnawave сам решает, кому его отдать. Вкл/выкл, порядок и название хоста настраиваются прямо в панели.
3. На каждую страну создаётся **видимый** хост-группа (`🇺🇸 США`, тег `AUTO`), плюс общий хост `⚡ Авто · все страны`.
4. Экстрактор стоит перед страницей подписки и находит в ответе заглушки `.le-xxxxxxxx`:
   - **хост-группу** превращает в автовыбор из ключей этой страны, доступных юзеру;
   - **хост-ключ** (если группы выключены) заменяет настоящим ключом.

## Требования

- Remnawave **2.x** и `remnawave-subscription-page` в docker-сети `remnawave-network`
- Docker и Docker Compose
- API-токен Remnawave: *Настройки Remnawave → API-токены*
- Профиль конфигурации **без нод** с одним любым инбаундом, например профиль `Balancer` с инбаундом `VM`. Это заглушка: юзеры на неё никуда не подключаются. Если такого профиля нет, создайте его и не назначайте ни на одну ноду.

## Установка

```bash
cd /opt && git clone https://github.com/tneange1/link-extractor && cd link-extractor
cp .env.example .env
mkdir -p data && chown 1000:1000 data
nano .env
docker compose up -d --build && docker compose logs -f
```

В логе должно быть:

```
[link-extractor] :3020, upstream http://remnawave-subscription-page:3010, admin /link-extractor/, API Remnawave: вкл
```

### Переменные `.env`

| Переменная | По умолчанию | Описание |
|---|---|---|
| `ADMIN_PASSWORD` | — | Пароль страницы экстрактора. **Обязательно.** |
| `REMNAWAVE_API_TOKEN` | — | API-токен Remnawave. Нужен для сквадов, хостов и проверки статуса юзера. |
| `REMNAWAVE_API_URL` | `http://remnawave:3000` | Адрес панели внутри docker-сети. |
| `UPSTREAM_URL` | `http://remnawave-subscription-page:3010` | Куда проксировать запросы подписки. |
| `PANEL_DOMAIN` | — | Домен панели. Нужен только для Caddy, чтобы добавить пункт в меню (см. ниже). |
| `PANEL_UPSTREAM_URL` | `http://remnawave:3000` | Панель для режима `PANEL_DOMAIN`. |
| `ONLY_ACTIVE_USERS` | `true` | Дописывать ключи только юзерам со статусом `ACTIVE` (для источников без хостов). |
| `SUB_PATH_PREFIX` | — | Если в subscription-page задан `CUSTOM_SUB_PREFIX`, укажите его здесь же. |
| `BASE_PATH` | `/link-extractor` | Путь страницы экстрактора. |
| `REFRESH_MINUTES` | `10` | Как часто обновлять подписки-источники. |
| `TG_BOT_TOKEN` | — | Токен бота от @BotFather для уведомлений. |
| `TG_CHAT_ID` | — | Куда слать: ваш id, id группы или канала (бот должен быть там). |
| `TG_THREAD_ID` | — | Номер топика, если чат с темами. |
| `AUTO_UPDATE` | `true` | Автообновление с GitHub. `false` — выключить. |
| `UPDATE_INTERVAL_MINUTES` | `10` | Как часто проверять обновления. |
| `UPDATE_BRANCH` | `main` | Ветка для обновлений. |

## Reverse proxy

Нужно сделать две вещи:

1. **Домен подписки** направить в `link-extractor:3020` вместо `remnawave-subscription-page:3010`.
2. **Домен панели:** путь `/link-extractor/` направить в экстрактор и вставить в страницу панели скрипт пункта меню.

### Caddy

Стоковый Caddy не умеет менять HTML. Поэтому HTML-страницы панели отдаёт сам экстрактор: в `.env` укажите `PANEL_DOMAIN=panel.example.com`.

```caddy
https://panel.example.com {
        @extractor path /link-extractor /link-extractor/*
        handle @extractor {
                reverse_proxy link-extractor:3020
        }
        @html header Accept *text/html*
        handle @html {
                reverse_proxy link-extractor:3020
        }
        handle {
                reverse_proxy * http://remnawave:3000
        }
}

https://sub.example.com {
        reverse_proxy * http://link-extractor:3020
}
```

```bash
cd /opt/remnawave/caddy
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile && docker compose restart caddy
```

### Nginx

Nginx умеет вставлять скрипт сам (`sub_filter`), поэтому `PANEL_DOMAIN` не нужен.

**Если nginx в docker-сети `remnawave-network`:**

```nginx
# Панель
server {
    server_name panel.example.com;
    # ... ваши listen / ssl / прочие настройки ...

    location /link-extractor/ {
        proxy_pass http://link-extractor:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://remnawave:3000;
        # ... ваши proxy_set_header ...

        # пункт «Экстрактор ссылок» в меню
        proxy_set_header Accept-Encoding "";
        sub_filter '</head>' '<script src="/link-extractor/inject.js" defer></script></head>';
        sub_filter_once on;
        sub_filter_types text/html;
    }
}

# Подписка
server {
    server_name sub.example.com;
    # ... ваши listen / ssl ...

    location / {
        proxy_pass http://link-extractor:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Если nginx работает на хосте или в `network_mode: host`** (например, установлен скриптом eGames):

1. Пробросьте порт в `docker-compose.yml` экстрактора. Если 3020 занят, возьмите любой свободный:
   ```yaml
       ports:
         - "127.0.0.1:3020:3020"
   ```
2. В конфиге выше замените `link-extractor:3020` → `127.0.0.1:3020`, а `remnawave:3000` → `127.0.0.1:3000`. Если у вас есть `upstream`-блоки, просто поменяйте адрес в upstream подписки.
3. Найти нужные места в конфиге можно так:
   ```bash
   grep -rn "3010\|subscription-page" /opt/remnawave/nginx.conf
   ```

Проверка и перезапуск:

```bash
docker exec remnawave-nginx nginx -t && docker exec remnawave-nginx nginx -s reload
# или для nginx на хосте:
nginx -t && systemctl reload nginx
```

## Использование

Откройте `https://panel.example.com/link-extractor/` или пункт **«Экстрактор ссылок»** в меню панели (Ctrl+F5 после настройки прокси) и войдите с `ADMIN_PASSWORD`.

### Добавление ключей

1. Вставьте в поле ключи и/или ссылки на подписки, по одной на строку. Подойдёт и целиком вставленный Xray/sing-box JSON или Clash YAML.
2. **Название.** Из него получается имя сквада (`My VPN` → `MY VPN`) и тег хостов (`MY_VPN`). Кириллица переводится в латиницу.
3. **User-Agent** для загрузки подписки:
   - **Авто** перебирает Happ Android → Happ iOS → INCY → v2rayNG → Happ Windows до первого, на котором подписка отдала настоящие ключи. Заглушки вида `127.0.0.1` отбрасываются.
   - **Пресеты** Happ / INCY / v2rayNG / v2rayN. Для Happ и INCY отправляются заголовки устройства с постоянным HWID: у провайдера это займёт одно устройство.
   - **Свой** — любая строка.
4. **Кому выдавать:**
   - *Создать сквад из названия* (по умолчанию) — новый сквад с инбаундом-заглушкой;
   - *существующий сквад* — в него добавится инбаунд-заглушка;
   - *Всем пользователям* — хосты без ограничения по сквадам.
5. **«Расшифровать»** показывает, что будет добавлено. **«Добавить»** сохраняет источник и создаёт сквад и хосты.
6. Добавьте нужных юзеров в созданный сквад: *Внутренние сквады → сквад → юзеры*. Юзер может состоять в нескольких сквадах одновременно.

### Управление

- **В панели, раздел «Хосты»:** переименовать, выключить, удалить, поменять порядок или тег. **Адрес и порт хостов `*.le-xxxxxxxx` не меняйте**: по ним экстрактор находит ключ. Удалённый в панели хост не пересоздаётся.
- **В экстракторе:**
  - вкл/выкл источник целиком или отдельные ключи;
  - сменить сквад или User-Agent;
  - обновить подписку вручную;
  - удалить источник: его хосты удалятся, сквад — по желанию.
- **Подписки-источники** обновляются каждые `REFRESH_MINUTES` минут. Новые ключи становятся новыми хостами, хосты исчезнувших ключей удаляются. Если провайдер недоступен, остаются последние полученные ключи.
- **Инбаунд-заглушка** выбирается автоматически (профиль `Balancer` или любой профиль без нод). Сменить её можно в блоке «Источники».

### Группы стран (автовыбор)

Включены по умолчанию (блок **«Группы стран»** на странице экстрактора).

- Страна ключа определяется по флагу в названии (`🇺🇸`), а без флага — по словам «США», «USA», «Польша», «Poland» и т.п. Ключи без страны попадают в группу `🌐 Другие`.
- В панели на каждую страну появляется один видимый хост с тегом `AUTO`, плюс общий `⚡ Авто · все страны`. Название общего автовыбора можно поменять. Порядок групп меняется перетаскиванием в «Хостах».
- Ключи становятся **скрытыми** хостами со своим тегом. Выключенный в панели ключ выпадает из автовыбора.
- Юзер получает в группе только ключи тех источников, в чьих сквадах он состоит.

Что видит клиент:

| Клиент / формат | Группа страны | «Все страны» |
|---|---|---|
| Happ, v2rayNG JSON (Xray JSON) | один сервер с балансером `leastPing` | один сервер с балансером |
| Clash / Mihomo | группа `url-test` | группа `url-test` |
| sing-box / Hiddify | `urltest` | `urltest` |
| base64 / обычный список | ключи по отдельности: «🇺🇸 США 1», «🇺🇸 США 2»… (автовыбора в этом формате нет) | не показывается |

Если выключить группы, ключи снова станут обычными видимыми хостами, а хосты групп удалятся.

### Telegram-уведомления

1. Создайте бота у [@BotFather](https://t.me/BotFather) и возьмите токен.
2. Напишите боту `/start` (или добавьте его в группу) и узнайте chat id, например через [@userinfobot](https://t.me/userinfobot).
3. Впишите в `.env` `TG_BOT_TOKEN` и `TG_CHAT_ID`, затем выполните `docker compose up -d`.
4. На странице экстрактора нажмите **«Отправить тест»**.

Приходят сообщения о новых и пропавших ключах в подписках-источниках, об ошибке и восстановлении подписки, о добавлении источника и об автообновлении (успех или откат).

### Проверка подписки юзера

Блок **«Проверка подписки юзера»**: вставьте ссылку подписки юзера и выберите клиента. Экстрактор покажет:

- статус юзера и его сквады;
- формат ответа;
- сколько хостов-заглушек подменено;
- почему ключи не добавились, если не добавились.

Из консоли то же самое видно по заголовку `X-Link-Extractor`:

```bash
curl -sI -A "v2rayNG/1.10" https://sub.example.com/<shortUuid> | grep -i x-link
# x-link-extractor: base64;+3
```

## Обновление

Контейнер `link-extractor-updater` раз в `UPDATE_INTERVAL_MINUTES` минут проверяет GitHub. Если есть новый коммит, он делает `git reset --hard`, пересобирает `link-extractor` и пишет в Telegram. Если сборка упала, откатывается на прошлую версию. `.env` и `data/` не трогаются.

Логи автообновления:

```bash
docker logs -f link-extractor-updater
```

Обновить вручную:

```bash
cd /opt/link-extractor && git pull && docker compose up -d --build
```

> Апдейтеру нужен доступ к `/var/run/docker.sock`, чтобы пересобирать контейнер. Если не хотите этого, поставьте `AUTO_UPDATE=false` или удалите сервис `updater` из `docker-compose.yml`.

## Резервная копия

Все данные лежат в `data/store.json`: источники, ключи, связи с хостами и сквадами.

```bash
cp /opt/link-extractor/data/store.json ~/link-extractor-backup.json
```

## Удаление

1. Удалите источники на странице экстрактора: их хосты удалятся из панели.
2. Верните в reverse proxy адрес `remnawave-subscription-page:3010` для домена подписки и уберите блоки экстрактора.
3. Остановите контейнер:
   ```bash
   cd /opt/link-extractor && docker compose down
   ```

## Ограничения

- **Страница подписки в браузере** показывает заглушки `…le-xxxxxxxx`. VPN-клиенты получают настоящие ключи.
- **Hysteria2 в Xray JSON** выдаётся через `protocol: "hysteria"` (нужен свежий Xray-core у клиента). Hysteria2 с `obfs`/port hopping в Xray JSON не выдаётся. В base64, Clash и sing-box выдаются все ключи.
- **xhttp в sing-box** не поддерживается: такие ключи в sing-box-подписку не попадут.
- **Трафик и лимиты** по сторонним ключам Remnawave не считает: их считает сервер-источник.
