#!/bin/sh
# Раз в 30 секунд: решает, пора ли проверить обновления и сделать бэкап БД панели.
STATE=./data/.updater
mkdir -p "$STATE" ./data/backups
now=$(date +%s)
due() { last=$(cat "$STATE/$1" 2>/dev/null || echo 0); [ $((now - last)) -ge "$2" ]; }

if [ "${AUTO_UPDATE:-true}" != "false" ] && due last-check $(( ${UPDATE_INTERVAL_MINUTES:-10} * 60 )); then
  echo "$now" > "$STATE/last-check"
  sh ./updater/check.sh || echo "[updater] ошибка проверки обновлений"
fi

if [ -f ./data/backups/.panel-db-request ]; then
  rm -f ./data/backups/.panel-db-request
  sh ./updater/backup-db.sh manual
elif [ "${BACKUP_PANEL_DB:-false}" = "true" ] && due last-db-backup $(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 )); then
  echo "$now" > "$STATE/last-db-backup"
  sh ./updater/backup-db.sh auto
fi
exit 0
