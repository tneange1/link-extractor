#!/bin/sh
# Сервис-помощник: автообновление с GitHub + бэкапы БД панели. Каждые 30 с запускает tick.sh (он перечитывается).
git config --global --add safe.directory '*'
if ! docker compose version >/dev/null 2>&1; then apk add --no-cache docker-cli-compose >/dev/null 2>&1; fi
echo "[updater] старт, каталог $(pwd)"
while true; do
  sh ./updater/tick.sh || echo "[updater] ошибка tick"
  sleep 30
done
