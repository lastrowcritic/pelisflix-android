#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
adb="$ANDROID_HOME/platform-tools/adb"
device="${ANDROID_SERIAL:-$("$adb" devices | awk '$1 ~ /^emulator-/ && $2 == "device" {print $1;exit}')}"
if [[ -z "$device" ]]; then echo 'Start the TV app first with npm run tv.'; exit 1; fi
echo 'Testing the installed debug app. Let the home catalogue finish any website verification before running this command.'
"$adb" -s "$device" shell run-as app.pelisflix.tv rm -f files/native-live-check.json
"$adb" -s "$device" shell am start -n app.pelisflix.tv/app.rezka.tv.MainActivity --ez tvLayout true --ez audit true
report_file="$(mktemp)"
trap 'rm -f "$report_file"' EXIT
for ((attempt=0;attempt<300;attempt++)); do
  "$adb" -s "$device" shell run-as app.pelisflix.tv cat files/native-live-check.json > "$report_file" 2>/dev/null || true
  status="$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("status","running"))
except Exception: print("running")' "$report_file")"
  if [[ "$status" == passed || "$status" == failed ]]; then
    cp "$report_file" docs/native-live-check.json
    cat docs/native-live-check.json
    [[ "$status" == passed ]]; exit
  fi
  sleep 2
done
echo 'The native check timed out. Check the TV screen for website verification or a playback error.'
exit 1
