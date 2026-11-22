#!/bin/sh
# Автообновление Link Extractor: раз в UPDATE_INTERVAL_MINUTES проверяет GitHub и пересобирает контейнер.
git config --global --add safe.directory '*'
if ! docker compose version >/dev/null 2>&1; then apk add --no-cache docker-cli-compose >/dev/null 2>&1; fi
echo "[updater] старт, каталог $(pwd), интервал ${UPDATE_INTERVAL_MINUTES:-10} мин"
while true; do
  if [ "${AUTO_UPDATE:-true}" != "false" ]; then sh ./updater/check.sh || echo "[updater] ошибка проверки"; fi
  sleep $(( ${UPDATE_INTERVAL_MINUTES:-10} * 60 ))
done
