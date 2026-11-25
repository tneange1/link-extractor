#!/bin/sh
# Бэкап БД Remnawave: pg_dumpall из контейнера remnawave-db → data/backups/panel-db-*.sql.gz (+ в Telegram)
. ./updater/tg.sh
DB="${PANEL_DB_CONTAINER:-remnawave-db}"
KEEP="${BACKUP_KEEP:-14}"
if ! docker inspect "$DB" >/dev/null 2>&1; then
  [ "$1" = "manual" ] && tg_msg "⚠️ Бэкап БД: контейнер <code>$DB</code> не найден на этом сервере"
  exit 0
fi
TS=$(date -u +%Y%m%d-%H%M%S)
F="./data/backups/panel-db-$TS.sql.gz"
if docker exec "$DB" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}"' | gzip > "$F" && [ -s "$F" ] && [ "$(gzip -dc "$F" | head -c 100 | wc -c)" -gt 10 ]; then
  SIZE=$(du -h "$F" | cut -f1)
  echo "[backup] $F ($SIZE)"
  ls -1t ./data/backups/panel-db-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  if [ "${BACKUP_TO_TELEGRAM:-true}" != "false" ]; then
    BYTES=$(wc -c < "$F")
    if [ "$BYTES" -lt 49000000 ]; then tg_doc "$F" "🗄 Бэкап БД панели ($SIZE)"
    else tg_msg "🗄 Бэкап БД панели готов ($SIZE), но он больше 50 МБ — лежит на сервере: <code>/opt/link-extractor/${F#./}</code>"; fi
  fi
else
  rm -f "$F"
  tg_msg "❌ Бэкап БД панели не удался (контейнер <code>$DB</code>)"
fi
