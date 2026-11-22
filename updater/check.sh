#!/bin/sh
# Одна проверка обновления. Перечитывается каждый цикл, поэтому её правки применяются без перезапуска.
BRANCH="${UPDATE_BRANCH:-main}"

tg() {
  [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_CHAT_ID" ] || return 0
  curl -s -m 10 -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT_ID}" \
    ${TG_THREAD_ID:+--data-urlencode "message_thread_id=${TG_THREAD_ID}"} \
    --data-urlencode "parse_mode=HTML" \
    --data-urlencode "text=🔗 <b>Link Extractor</b>
$1" >/dev/null
}

git fetch -q origin "$BRANCH" || { echo "[updater] git fetch не удался"; exit 1; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0

CHANGES=$(git log --format='• %s' "$LOCAL..$REMOTE" | head -15 | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
echo "[updater] обновление $LOCAL -> $REMOTE"
git reset -q --hard "origin/$BRANCH"

if docker compose up -d --build link-extractor; then
  tg "✅ Обновлён до <code>$(git rev-parse --short HEAD)</code>
$CHANGES"
else
  echo "[updater] сборка не удалась, откат"
  git reset -q --hard "$LOCAL"
  docker compose up -d --build link-extractor
  tg "❌ Обновление до <code>$(echo "$REMOTE" | cut -c1-7)</code> не собралось — откатился на <code>$(echo "$LOCAL" | cut -c1-7)</code>. Смотри: docker logs link-extractor-updater"
fi
