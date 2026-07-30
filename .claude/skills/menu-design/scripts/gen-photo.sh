#!/usr/bin/env bash
# 料理写真をOpenAI画像APIで生成して保存する
# 使い方: OPENAI_API_KEY=... ./gen-photo.sh "プロンプト" 出力.png [サイズ]
# サイズ: 1024x1024 | 1536x1024 | 1024x1536 (既定: 1024x1536 縦)
#
# 前提: 実行環境のネットワークポリシーで api.openai.com が許可されていること。
# 403 CONNECT で失敗する場合は claude.ai/code の環境設定でドメイン許可を追加する。
#
# プロンプトの定石(スキルの写真規則と対応):
#  - 「俯瞰」or「45度」を明示 / 器を指定(白磁・藍染・黒釉)/ 背景を指定(黒スレート・木盆・和紙)
#  - シズル要素を1つ(湯気・照り・断面)/ 「商業写真、メニュー撮影、自然光」を付ける
#  - 例: "炭火焼き鳥の串5本、黒釉の長皿、俯瞰、湯気、照り、暗い背景、商業メニュー写真"

set -euo pipefail
PROMPT="${1:?プロンプト必須}"
OUT="${2:?出力パス必須}"
SIZE="${3:-1024x1536}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY が未設定}"

resp=$(curl -sS https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(python3 - "$PROMPT" "$SIZE" <<'PY'
import json,sys
print(json.dumps({"model":"gpt-image-1","prompt":sys.argv[1],"size":sys.argv[2],"quality":"high","n":1}))
PY
)")

echo "$resp" | python3 - "$OUT" <<'PY'
import json,sys,base64
d=json.load(sys.stdin)
if "error" in d: raise SystemExit(f"APIエラー: {d['error'].get('message')}")
open(sys.argv[1],'wb').write(base64.b64decode(d["data"][0]["b64_json"]))
print(f"saved: {sys.argv[1]}")
PY
