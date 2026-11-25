#!/bin/sh
# Чинит .env с повторяющимися ключами (например, после дописывания .env.example):
#  • у каждого ключа остаётся одна строка (на месте первой);
#  • значение — последнее непустое; COMPOSE_PROFILES — объединение всех.
F="${1:-.env}"
[ -f "$F" ] || exit 0
TMP="$F.fix.$$"
awk '
  function key(l) { return (l ~ /^[A-Za-z_][A-Za-z0-9_]*=/) ? substr(l, 1, index(l, "=") - 1) : "" }
  NR == FNR {
    k = key($0); if (k == "") next
    v = substr($0, length(k) + 2)
    if (k == "COMPOSE_PROFILES") {
      n = split(v, parts, ",")
      for (i = 1; i <= n; i++) { p = parts[i]; gsub(/[ \t]/, "", p); if (p != "" && !(p in had)) { had[p] = 1; val[k] = (val[k] == "" ? p : val[k] "," p) } }
    } else if (v != "") val[k] = v
    next
  }
  { k = key($0) }
  k == "" { print; next }
  (k in done) { next }
  { done[k] = 1; print k "=" val[k] }
' "$F" "$F" > "$TMP" || { rm -f "$TMP"; exit 0; }
if ! cmp -s "$F" "$TMP"; then
  cp "$F" "$F.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null
  cat "$TMP" > "$F"
  echo "[fix-env] убраны дубли в $F"
  rm -f "$TMP"; exit 10
fi
rm -f "$TMP"; exit 0
