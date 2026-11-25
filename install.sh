#!/usr/bin/env bash
# Link Extractor — установщик.
#   bash <(curl -fsSL https://raw.githubusercontent.com/tneange1/link-extractor/main/install.sh)
# Режимы:
#   extractor — экстрактор на сервер с панелью Remnawave (+ авто-настройка Caddy/nginx)
#   bot       — Telegram-бот управления (на любой сервер)
#   both      — экстрактор и бот на одном сервере с панелью
# Неинтерактивно (так ставит бот по SSH):
#   install.sh --mode extractor --yes --panel-name NL --tg-token ... --tg-chat ...
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tneange1/link-extractor.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/link-extractor}"
MODE=""; YES=0; DETECT_ONLY=0
PANEL_NAME=""; RW_TOKEN=""; SUB_DOMAIN=""; PANEL_DOMAIN=""; PROXY="auto"
TG_TOKEN=""; TG_CHAT=""; TG_ADMINS=""; AUTO_UPDATE="1"; ADMIN_PASSWORD_IN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2;;
    --yes|-y) YES=1; shift;;
    --detect) DETECT_ONLY=1; shift;;
    --panel-name) PANEL_NAME="$2"; shift 2;;
    --api-token) RW_TOKEN="$2"; shift 2;;
    --sub-domain) SUB_DOMAIN="$2"; shift 2;;
    --panel-domain) PANEL_DOMAIN="$2"; shift 2;;
    --proxy) PROXY="$2"; shift 2;;
    --tg-token) TG_TOKEN="$2"; shift 2;;
    --tg-chat) TG_CHAT="$2"; shift 2;;
    --tg-admins) TG_ADMINS="$2"; shift 2;;
    --auto-update) AUTO_UPDATE="$2"; shift 2;;
    --db-backup) shift 2;;   # устарело
    --admin-password) ADMIN_PASSWORD_IN="$2"; shift 2;;
    --dir) DIR="$2"; shift 2;;
    --repo) REPO_URL="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    *) echo "Неизвестный параметр: $1"; exit 2;;
  esac
done

c_ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
c_info() { printf '\033[36m•\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m✘ %s\033[0m\n' "$*"; echo "LE_ERROR $*"; exit 1; }
ask() { # ask VAR "Вопрос" "по умолчанию"
  local __v="$1" __q="$2" __d="${3:-}" __a=""
  if [ "$YES" = 1 ]; then printf -v "$__v" '%s' "$__d"; return; fi
  read -r -p "$__q${__d:+ [$__d]}: " __a < /dev/tty || true
  printf -v "$__v" '%s' "${__a:-$__d}"
}
rand() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "${1:-32}"; }

[ "$(id -u)" = 0 ] || die "Запускай от root"

# ---------- определение окружения ----------
has_docker() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
cont_exists() { docker inspect "$1" >/dev/null 2>&1; }
cont_by_image() { docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk -v p="$1" '$2 ~ p {print $1; exit}'; }
mount_src() { docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Source}}{{end}}{{end}}" "$1" 2>/dev/null; }

CADDY_C=""; CADDYFILE=""; NGINX_C=""; NGINX_CONF=""; NGINX_HOSTNET=0; NGINX_HOST=0; PANEL_HERE=0
detect() {
  if has_docker; then
    cont_exists remnawave && cont_exists remnawave-subscription-page && PANEL_HERE=1
    CADDY_C=$(cont_by_image caddy || true)
    if [ -n "$CADDY_C" ]; then CADDYFILE=$(mount_src "$CADDY_C" /etc/caddy/Caddyfile); fi
    NGINX_C=$(cont_by_image nginx || true)
    if [ -n "$NGINX_C" ] && [ -z "$CADDY_C" ]; then
      for d in /etc/nginx/nginx.conf /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/remnawave.conf; do
        s=$(mount_src "$NGINX_C" "$d"); [ -n "$s" ] && [ -f "$s" ] && grep -q '3010\|subscription-page' "$s" && { NGINX_CONF="$s"; break; }
      done
      [ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$NGINX_C")" = host ] && NGINX_HOSTNET=1
    fi
  fi
  if [ -z "$CADDY_C" ] && [ -z "$NGINX_CONF" ] && command -v nginx >/dev/null 2>&1; then
    NGINX_CONF=$(grep -rlE '3010|subscription-page' /etc/nginx 2>/dev/null | head -1 || true)
    [ -n "$NGINX_CONF" ] && NGINX_HOST=1
  fi
  # домены
  if [ -n "$CADDYFILE" ] && [ -f "$CADDYFILE" ]; then
    local blk
    blk=$(awk '/^[^ \t#].*\{[ \t]*$/ {site=$1} /remnawave:3000/ {print "P " site} /subscription-page:3010|link-extractor:3020/ {print "S " site}' "$CADDYFILE")
    [ -z "$PANEL_DOMAIN" ] && PANEL_DOMAIN=$(echo "$blk" | awk '$1=="P"{print $2; exit}')
    [ -z "$SUB_DOMAIN" ] && SUB_DOMAIN=$(echo "$blk" | awk '$1=="P"{p[$2]=1} $1=="S"{s[++n]=$2} END{for(i=1;i<=n;i++) if(!(s[i] in p)){print s[i]; exit}}')
  elif [ -n "$NGINX_CONF" ] && [ -f "$NGINX_CONF" ]; then
    local blk
    blk=$(awk '
      /upstream[ \t]+[A-Za-z0-9_-]+[ \t]*\{/ {up=$2}
      up!="" && /server[ \t]+[^;]*:(3000|3010|3020)/ {match($0,/:(3000|3010|3020)/); port[up]=substr($0,RSTART+1,4)}
      /\}/ && up!="" {up=""}
      {lines[NR]=$0}
      END{
        for(i=1;i<=NR;i++){l=lines[i]
          if(l ~ /server_name/){sn=l; sub(/.*server_name[ \t]+/,"",sn); sub(/[ \t;].*/,"",sn)}
          if(l ~ /proxy_pass/){t=l; sub(/.*proxy_pass[ \t]+https?:\/\//,"",t); sub(/[;\/ \t].*/,"",t)
            p=""; if(t ~ /:[0-9]+$/){p=t; sub(/.*:/,"",p)} else if(t in port){p=port[t]}
            if(p=="3000") print "P " sn; if(p=="3010"||p=="3020"||t ~ /subscription-page/) print "S " sn}}
      }' "$NGINX_CONF")
    [ -z "$PANEL_DOMAIN" ] && PANEL_DOMAIN=$(echo "$blk" | awk '$1=="P"{print $2; exit}')
    [ -z "$SUB_DOMAIN" ] && SUB_DOMAIN=$(echo "$blk" | awk '$1=="P"{p[$2]=1} $1=="S"{s[++n]=$2} END{for(i=1;i<=n;i++) if(!(s[i] in p)){print s[i]; exit}}')
  fi
  PANEL_DOMAIN=$(echo "${PANEL_DOMAIN:-}" | sed -E 's#^https?://##; s#:443$##; s#[/{].*##')
  SUB_DOMAIN=$(echo "${SUB_DOMAIN:-}" | sed -E 's#^https?://##; s#:443$##; s#[/{].*##')
  PROXY_KIND="none"
  [ -n "$CADDYFILE" ] && PROXY_KIND="caddy"
  [ -n "$NGINX_CONF" ] && PROXY_KIND="nginx"
  return 0
}

detect
if [ "$DETECT_ONLY" = 1 ]; then
  echo "LE_DETECT docker=$(has_docker && echo 1 || echo 0)"
  echo "LE_DETECT panel=$PANEL_HERE"
  echo "LE_DETECT proxy=$PROXY_KIND"
  echo "LE_DETECT panel_domain=$PANEL_DOMAIN"
  echo "LE_DETECT sub_domain=$SUB_DOMAIN"
  echo "LE_DETECT api_token=$([ -n "$(sed -n 's/^REMNAWAVE_API_TOKEN=//p' "$DIR/.env" 2>/dev/null)" ] && echo found || echo missing)"
  echo "LE_DETECT installed=$([ -f "$DIR/.env" ] && echo 1 || echo 0)"
  exit 0
fi

# ---------- режим ----------
if [ -z "$MODE" ]; then
  echo
  echo "Link Extractor — установка"
  echo "  1) Экстрактор — на этот сервер с панелью Remnawave"
  echo "  2) Telegram-бот — управление (можно на отдельный сервер)"
  echo "  3) Экстрактор + бот — всё на этот сервер с панелью"
  ask n "Выбери" "3"
  case "$n" in 1) MODE=extractor;; 2) MODE=bot;; *) MODE=both;; esac
fi
case "$MODE" in extractor|bot|both) ;; *) die "--mode: extractor | bot | both";; esac
WANT_EXTRACTOR=0; WANT_BOT=0
[ "$MODE" != bot ] && WANT_EXTRACTOR=1
[ "$MODE" != extractor ] && WANT_BOT=1
[ "$WANT_EXTRACTOR" = 1 ] && [ "$PANEL_HERE" != 1 ] && die "На этом сервере не найдена панель (контейнеры remnawave и remnawave-subscription-page). Экстрактор ставится на сервер с панелью."

# ---------- docker и git ----------
if ! has_docker; then
  c_info "Ставлю Docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "Не удалось поставить Docker"
fi
command -v git >/dev/null 2>&1 || { c_info "Ставлю git…"; (apt-get update -qq && apt-get install -y -qq git) >/dev/null 2>&1 || (yum install -y git || dnf install -y git || apk add git) >/dev/null 2>&1; }
docker network inspect remnawave-network >/dev/null 2>&1 || docker network create remnawave-network >/dev/null

if [ -d "$DIR/.git" ]; then
  c_info "Обновляю $DIR"
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  c_info "Скачиваю в $DIR"
  git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" "$DIR"
fi
cd "$DIR"
mkdir -p data/bot data/backups && chown -R 1000:1000 data
[ -f .env ] && sh ./updater/fix-env.sh .env >/dev/null || true

# ---------- .env ----------
touch .env
get_env() { sed -n "s/^$1=//p" .env | tail -1; }
set_env() { # set_env KEY VALUE [force]
  local k="$1" v="$2" cur; cur=$(get_env "$k")
  if [ -n "$cur" ] && [ "${3:-}" != force ]; then return; fi
  if grep -q "^$k=" .env; then
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > .env.tmp && cat .env.tmp > .env && rm -f .env.tmp
  else echo "$k=$v" >> .env; fi
  return 0
}

PROFILES=""; [ "$WANT_EXTRACTOR" = 1 ] && PROFILES="extractor"
[ "$WANT_BOT" = 1 ] && PROFILES="${PROFILES:+$PROFILES,}bot"
# если на сервере уже что-то стоит — не теряем
OLD_PROFILES=$(get_env COMPOSE_PROFILES)
for p in $(echo "$OLD_PROFILES" | tr ',' ' '); do case ",$PROFILES," in *",$p,"*) ;; *) PROFILES="$PROFILES,$p";; esac; done
set_env COMPOSE_PROFILES "$PROFILES" force

if [ "$WANT_EXTRACTOR" = 1 ]; then
  [ -z "$PANEL_NAME" ] && ask PANEL_NAME "Название панели (для бота и уведомлений)" "${PANEL_DOMAIN:-$(hostname)}"
  if [ -z "$RW_TOKEN" ] && [ -z "$(get_env REMNAWAVE_API_TOKEN)" ]; then ask RW_TOKEN "API-токен Remnawave (панель → Настройки Remnawave → API-токены → создать)" ""; fi
  set_env ADMIN_PASSWORD "${ADMIN_PASSWORD_IN:-$(rand 20)}"
  set_env API_TOKEN "$(rand 40)"
  set_env PANEL_NAME "$PANEL_NAME"
  set_env UPSTREAM_URL "http://remnawave-subscription-page:3010"
  set_env REMNAWAVE_API_URL "http://remnawave:3000"
  [ -n "$RW_TOKEN" ] && set_env REMNAWAVE_API_TOKEN "$RW_TOKEN" force   # только если токен передали явно
  set_env ONLY_ACTIVE_USERS true
  set_env BASE_PATH /link-extractor
  set_env REFRESH_MINUTES 10
fi
if [ "$WANT_BOT" = 1 ]; then
  [ -z "$TG_TOKEN" ] && [ -z "$(get_env TG_BOT_TOKEN)" ] && ask TG_TOKEN "Токен бота от @BotFather" ""
  [ -z "$TG_ADMINS" ] && [ -z "$(get_env TG_ADMIN_IDS)" ] && ask TG_ADMINS "Твой Telegram id (узнать: @userinfobot), можно несколько через запятую" ""
  [ -z "$(get_env TG_BOT_TOKEN)$TG_TOKEN" ] && die "Без токена бота не поставить"
  [ -z "$(get_env TG_ADMIN_IDS)$TG_ADMINS" ] && die "Нужен хотя бы один id админа"
  [ -z "$TG_CHAT" ] && TG_CHAT="${TG_ADMINS%%,*}"
fi
[ -n "$TG_TOKEN" ] && set_env TG_BOT_TOKEN "$TG_TOKEN" force
[ -n "$TG_CHAT" ] && set_env TG_CHAT_ID "$TG_CHAT" force
[ -n "$TG_ADMINS" ] && set_env TG_ADMIN_IDS "$TG_ADMINS" force
set_env AUTO_UPDATE "$([ "$AUTO_UPDATE" = 1 ] && echo true || echo false)"
set_env UPDATE_INTERVAL_MINUTES 10
set_env UPDATE_BRANCH "$BRANCH"
set_env BACKUP_INTERVAL_HOURS 24
set_env BACKUP_KEEP 14
set_env BACKUP_TO_TELEGRAM true
chmod 600 .env

# ---------- reverse proxy ----------
PATCHED=""
patch_caddy() {
  local f="$CADDYFILE" bak; bak="$f.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$f" "$bak"
  local tmp; tmp=$(mktemp)
  sed 's#remnawave-subscription-page:3010#link-extractor:3020#g' "$f" > "$tmp"
  if ! grep -q 'path /link-extractor' "$tmp" && [ -n "$PANEL_DOMAIN" ]; then
    awk '
      /^[^ \t#].*\{[ \t]*$/ {site=$1}
      !done && index(site, D) && /reverse_proxy/ && /remnawave:3000/ {
        match($0,/^[ \t]*/); ind=substr($0,1,RLENGTH)
        print ind "@extractor path /link-extractor /link-extractor/*"
        print ind "handle @extractor {"; print ind "    reverse_proxy link-extractor:3020"; print ind "}"
        print ind "@html header Accept *text/html*"
        print ind "handle @html {"; print ind "    reverse_proxy link-extractor:3020"; print ind "}"
        print ind "handle {"; print ind "    " substr($0, RLENGTH+1); print ind "}"
        done=1; next }
      {print}' D="$PANEL_DOMAIN" "$tmp" > "$tmp.2" && mv "$tmp.2" "$tmp"
    set_env PANEL_DOMAIN "$PANEL_DOMAIN" force
  fi
  cat "$tmp" > "$f"; rm -f "$tmp"   # cat >, чтобы не сломать bind-mount файла
  if docker exec "$CADDY_C" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
     && docker exec "$CADDY_C" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    PATCHED="caddy"; c_ok "Caddy настроен (копия: $bak)"
  else
    cat "$bak" > "$f"; docker exec "$CADDY_C" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
    c_warn "Caddy не принял изменения — вернул как было. Настрой вручную по README."
  fi
  return 0
}
patch_nginx() {
  local f="$NGINX_CONF" bak; bak="$f.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$f" "$bak"
  local tmp; tmp=$(mktemp)
  if [ "$NGINX_HOSTNET" = 1 ] || [ "$NGINX_HOST" = 1 ]; then
    local port=3020
    while { ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null; } | awk '{print $4}' | grep -q ":$port\$"; do port=$((port+1)); done
    printf 'services:\n  link-extractor:\n    ports:\n      - "127.0.0.1:%s:3020"\n' "$port" > docker-compose.override.yml
    docker compose up -d link-extractor >/dev/null 2>&1 || true
    sed -E "s#(127\.0\.0\.1|localhost):3010#127.0.0.1:$port#g; s#remnawave-subscription-page:3010#127.0.0.1:$port#g" "$f" > "$tmp"
  else
    sed 's#remnawave-subscription-page:3010#link-extractor:3020#g' "$f" > "$tmp"
  fi
  cat "$tmp" > "$f"; rm -f "$tmp"
  local ok=0
  if [ "$NGINX_HOST" = 1 ]; then nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok=1
  else docker exec "$NGINX_C" nginx -t >/dev/null 2>&1 && docker exec "$NGINX_C" nginx -s reload >/dev/null 2>&1 && ok=1; fi
  if [ "$ok" = 1 ]; then PATCHED="nginx"; c_ok "nginx настроен (копия: $bak). Пункт в меню панели для nginx — вручную, см. README."
  else
    cat "$bak" > "$f"
    if [ "$NGINX_HOST" = 1 ]; then systemctl reload nginx || true; else docker exec "$NGINX_C" nginx -s reload >/dev/null 2>&1 || true; fi
    c_warn "nginx не принял изменения — вернул как было. Настрой вручную по README."
  fi
  return 0
}

c_info "Собираю и запускаю контейнеры…"
docker compose up -d --build >/dev/null 2>&1 || docker compose up -d --build || die "docker compose не запустился"

if [ "$WANT_EXTRACTOR" = 1 ] && [ "$PROXY" = auto ]; then
  if grep -qs 'link-extractor:3020\|127.0.0.1:30[2-9][0-9]' "${CADDYFILE:-/nonexistent}" "${NGINX_CONF:-/nonexistent}" 2>/dev/null && ! grep -qs 'subscription-page:3010' "${CADDYFILE:-/nonexistent}" "${NGINX_CONF:-/nonexistent}"; then
    PATCHED="already"; c_ok "Reverse proxy уже направлен на экстрактор"
  elif [ "$PROXY_KIND" = caddy ]; then patch_caddy
  elif [ "$PROXY_KIND" = nginx ]; then patch_nginx
  else c_warn "Caddy/nginx не найден — настрой reverse proxy вручную по README"; fi
fi

[ -n "$PATCHED" ] && docker compose up -d >/dev/null 2>&1 || true   # подхватить PANEL_DOMAIN / порт

# ---------- итог ----------
echo
c_ok "Готово: $DIR (профили: $PROFILES)"
if [ "$WANT_EXTRACTOR" = 1 ]; then
  URL=""; [ -n "$SUB_DOMAIN" ] && URL="https://$SUB_DOMAIN/link-extractor"
  echo "   Страница:  ${URL:-https://<домен подписки>/link-extractor}/"
  echo "   Пароль:    $(get_env ADMIN_PASSWORD)"
  echo "   API-токен: $(get_env API_TOKEN)   ← для добавления панели в бота"
  if [ -z "$(get_env REMNAWAVE_API_TOKEN)" ]; then c_warn "Токен Remnawave не задан — укажи его в боте или на странице экстрактора (Настройки → Токен Remnawave)"
  else
    sleep 3
    if docker exec link-extractor node -e "fetch((process.env.REMNAWAVE_API_URL||'http://remnawave:3000')+'/api/internal-squads',{headers:{Authorization:'Bearer '+process.env.REMNAWAVE_API_TOKEN,'X-Forwarded-For':'127.0.0.1','X-Forwarded-Proto':'https'}}).then(r=>process.exit(r.ok?0:3)).catch(()=>process.exit(4))" >/dev/null 2>&1; then c_ok "Токен Remnawave рабочий"
    else c_warn "Токен Remnawave не подходит (нет прав на сквады/хосты) — создай новый в панели и укажи его в боте или на странице экстрактора"; echo "LE_WARN token"; fi
  fi
  echo "LE_RESULT url=$URL token=$(get_env API_TOKEN) proxy=${PATCHED:-none} name=$(get_env PANEL_NAME | tr ' ' '_')"
fi
[ "$WANT_BOT" = 1 ] && echo "   Бот запущен — напиши ему /start"
exit 0
