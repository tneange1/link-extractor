#!/bin/sh
# Раз в 30 секунд: автообновление по расписанию или по кнопке из бота/страницы.
STATE=./data/.updater
mkdir -p "$STATE"
now=$(date +%s)
due() { last=$(cat "$STATE/$1" 2>/dev/null || echo 0); [ $((now - last)) -ge "$2" ]; }

if [ -f ./data/.update-request ]; then
  rm -f ./data/.update-request
  echo "$now" > "$STATE/last-check"
  FORCE=1 sh ./updater/check.sh || echo "[updater] ошибка обновления"
elif [ "${AUTO_UPDATE:-true}" != "false" ] && due last-check $(( ${UPDATE_INTERVAL_MINUTES:-10} * 60 )); then
  echo "$now" > "$STATE/last-check"
  sh ./updater/check.sh || echo "[updater] ошибка проверки обновлений"
fi

if [ -f ./data/.remnawave-update-request ]; then
  rm -f ./data/.remnawave-update-request
  echo "$now" > "$STATE/last-rw-update"
  FORCE=1 sh ./updater/remnawave-update.sh
elif [ "${REMNAWAVE_AUTO_UPDATE:-false}" = "true" ] && due last-rw-update $(( ${REMNAWAVE_UPDATE_INTERVAL_HOURS:-24} * 3600 )); then
  echo "$now" > "$STATE/last-rw-update"
  sh ./updater/remnawave-update.sh
fi
exit 0
