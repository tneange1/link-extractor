#!/bin/sh
# Обновление панели Remnawave: docker compose pull + up -d в её папке (по умолчанию /opt/remnawave).
. ./updater/tg.sh
RW_DIR="${REMNAWAVE_DIR:-/opt/remnawave}"
if ! docker run --rm -v "$RW_DIR:$RW_DIR" docker:27-cli test -f "$RW_DIR/docker-compose.yml"; then
  [ -n "$FORCE" ] && tg_msg "⚠️ Не нашёл <code>$RW_DIR/docker-compose.yml</code> — укажи REMNAWAVE_DIR в .env"
  exit 0
fi
ids() { docker ps --format '{{.Names}} {{.Image}}' | grep -i remnawave | awk '{print $2}' | sort -u | xargs -r docker image inspect -f '{{.Id}}' 2>/dev/null | sort | tr '\n' ' '; }
BEFORE=$(ids)
OUT=$(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$RW_DIR:$RW_DIR" -w "$RW_DIR" docker:27-cli \
  sh -c 'docker compose pull -q 2>&1 && docker compose up -d 2>&1' 2>&1)
RC=$?
AFTER=$(ids)
echo "[remnawave] rc=$RC"
if [ $RC -ne 0 ]; then
  tg_msg "❌ Обновление Remnawave не удалось:
<pre>$(echo "$OUT" | tail -8 | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')</pre>"
elif [ "$BEFORE" != "$AFTER" ]; then
  tg_msg "✅ Remnawave обновлён и перезапущен"
elif [ -n "$FORCE" ]; then
  tg_msg "ℹ️ Remnawave уже последней версии"
fi
