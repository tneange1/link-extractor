#!/bin/sh
# tg_msg "текст" | tg_doc файл "подпись"
PFX="🔗 <b>Link Extractor${PANEL_NAME:+ · $PANEL_NAME}</b>"
API="${TG_API_BASE:-https://api.telegram.org}"
[ -z "$TG_CHAT_ID" ] && TG_CHAT_ID=$(echo "$TG_ADMIN_IDS" | tr ', ' '\n\n' | grep -m1 .)
tg_msg() {
  [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_CHAT_ID" ] || return 0
  curl -s -m 15 -X POST "$API/bot${TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT_ID}" ${TG_THREAD_ID:+--data-urlencode "message_thread_id=${TG_THREAD_ID}"} \
    --data-urlencode "parse_mode=HTML" --data-urlencode "text=$PFX
$1" >/dev/null
}
tg_doc() {
  [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_CHAT_ID" ] || return 0
  curl -s -m 300 -X POST "$API/bot${TG_BOT_TOKEN}/sendDocument" \
    -F "chat_id=${TG_CHAT_ID}" ${TG_THREAD_ID:+-F "message_thread_id=${TG_THREAD_ID}"} \
    -F "caption=${PANEL_NAME:+[$PANEL_NAME] }$2" -F "document=@$1" >/dev/null
}
