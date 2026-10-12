#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
mkdir -p "$ANDROID_AVD_HOME"
avdmanager="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
image='system-images;android-34;android-tv;arm64-v8a'
if [[ "$(uname -m)" == x86_64 ]]; then image='system-images;android-34;android-tv;x86'; fi
if [[ ! -f "$ANDROID_AVD_HOME/PelisflixTV.ini" ]]; then
  printf 'no\n' | "$avdmanager" create avd --name PelisflixTV --package "$image" --device tv_1080p --path "$ANDROID_AVD_HOME/PelisflixTV.avd"
fi
python3 - "$ANDROID_AVD_HOME/PelisflixTV.avd/config.ini" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
s=s.replace('disk.dataPartition.size=10G','disk.dataPartition.size=2G').replace('hw.initialOrientation=portrait','hw.initialOrientation=landscape').replace('sdcard.size=512 MB','sdcard.size=128 MB')
p.write_text(s)
PY
device=''
while read -r serial status; do
  if [[ "$serial" == emulator-* && "$status" == device ]] && [[ "$("$ANDROID_HOME/platform-tools/adb" -s "$serial" emu avd name 2>/dev/null | head -n 1 | tr -d '\r')" == PelisflixTV ]]; then device="$serial"; break; fi
done < <("$ANDROID_HOME/platform-tools/adb" devices)
if [[ -z "$device" ]]; then
  device=emulator-5580
  "$ANDROID_HOME/emulator/emulator" -avd PelisflixTV -port 5580 -no-snapshot -gpu "${REZKA_TV_GPU:-swiftshader}" &
  emulator_pid=$!
fi
ready=false
for ((attempt=0;attempt<90;attempt++)); do
  if [[ -n "${emulator_pid:-}" ]] && ! kill -0 "$emulator_pid" 2>/dev/null; then echo 'The TV emulator could not start. Check its SDK and system image.'; exit 1; fi
  if [[ "$("$ANDROID_HOME/platform-tools/adb" -s "$device" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then ready=true; break; fi
  sleep 2
done
if [[ "$ready" != true ]]; then echo 'The TV emulator did not finish starting. Check its window and try again.'; exit 1; fi
npm run android:build
"$ANDROID_HOME/platform-tools/adb" -s "$device" install -r android/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/platform-tools/adb" -s "$device" shell am start -n app.pelisflix.personal/app.rezka.tv.MainActivity --ez tvLayout true

# Keep an emulator launched by this command attached to the terminal session.
if [[ -n "${emulator_pid:-}" ]]; then wait "$emulator_pid"; fi
