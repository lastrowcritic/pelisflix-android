#!/usr/bin/env bash
# Builds an installable APK into the project folder.
# With PELISFLIX_KEYSTORE set (see README), a signed release APK is built. Otherwise a debug APK is built.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/android-env.sh
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PWD/.tools/gradle}"
if [[ -n "${ANDROID_HOME:-}" ]]; then printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties; fi
version="$(grep -m1 'versionName' android/app/build.gradle | sed -E 's/.*"(.*)".*/\1/')"
cd android
if [[ -n "${PELISFLIX_KEYSTORE:-}" ]]; then
  ./gradlew assembleRelease -Dorg.gradle.java.home="$JAVA_HOME"
  cp app/build/outputs/apk/release/app-release.apk "../Pelisflix-${version}.apk"
else
  ./gradlew assembleDebug -Dorg.gradle.java.home="$JAVA_HOME"
  cp app/build/outputs/apk/debug/app-debug.apk "../Pelisflix-${version}-debug.apk"
fi
