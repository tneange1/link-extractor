#!/bin/sh
# Одна проверка обновления. Перечитывается каждый раз, поэтому её правки применяются без перезапуска.
. ./updater/tg.sh
BRANCH="${UPDATE_BRANCH:-main}"

# миграция: раньше экстрактор был без профиля
if [ -f .env ] && ! grep -q '^COMPOSE_PROFILES=' .env; then echo 'COMPOSE_PROFILES=extractor' >> .env; fi

# Если работает старый цикл (без tick.sh) — разово перезапускаем updater, чтобы включились бэкапы БД
recreate_self() {
  docker run -d --rm --name link-extractor-updater-helper \
    -v /var/run/docker.sock:/var/run/docker.sock -v "$(pwd):$(pwd)" -w "$(pwd)" \
    docker:27-cli sh -c 'sleep 5; docker compose up -d --force-recreate updater' >/dev/null 2>&1 || true
}
if [ ! -d ./data/.updater ]; then mkdir -p ./data/.updater; echo "[updater] перехожу на новый цикл"; recreate_self; exit 0; fi

git fetch -q origin "$BRANCH" || { echo "[updater] git fetch не удался"; exit 1; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0

CHANGES=$(git log --format='• %s' "$LOCAL..$REMOTE" | head -15 | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
SELF_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" | grep -E '^(updater/loop\.sh|docker-compose\.yml)$' || true)
echo "[updater] обновление $LOCAL -> $REMOTE"
git reset -q --hard "origin/$BRANCH"

SERVICES=$(docker compose config --services 2>/dev/null | grep -v '^updater$' | tr '\n' ' ')
[ -n "$(echo $SERVICES)" ] || SERVICES="link-extractor"
if docker compose up -d --build $SERVICES; then
  tg_msg "✅ Обновлён до <code>$(git rev-parse --short HEAD)</code>
$CHANGES"
else
  echo "[updater] сборка не удалась, откат"
  git reset -q --hard "$LOCAL"
  docker compose up -d --build $SERVICES
  tg_msg "❌ Обновление до <code>$(echo "$REMOTE" | cut -c1-7)</code> не собралось — откатился на <code>$(echo "$LOCAL" | cut -c1-7)</code>. Смотри: docker logs link-extractor-updater"
  exit 1
fi

# Себя изнутри пересоздать нельзя — запускаем отдельный временный контейнер, он переживёт наш перезапуск
if [ -n "$SELF_CHANGED" ]; then
  echo "[updater] изменился сам updater — пересоздаю"
  recreate_self
fi
