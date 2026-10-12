#!/usr/bin/env bash
if [[ -d "$PWD/.tools/sdk/system-images/android-34/android-tv" && ! -d "${ANDROID_HOME:-}/system-images/android-34/android-tv" ]]; then
  export ANDROID_HOME="$PWD/.tools/sdk"
elif [[ -d "$PWD/.tools/sdk/platforms/android-36" && ! -d "${ANDROID_HOME:-}/platforms/android-36" ]]; then
  export ANDROID_HOME="$PWD/.tools/sdk"
elif [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "$PWD/.tools/sdk" ]]; then export ANDROID_HOME="$PWD/.tools/sdk";
  else export ANDROID_HOME="$HOME/Library/Android/sdk"; fi
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]] || [[ "$("$JAVA_HOME/bin/java" -version 2>&1)" == *'version "26'* ]]; then
  for candidate in /opt/homebrew/Cellar/openjdk/24.0.1/libexec/openjdk.jdk/Contents/Home /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home /Applications/Android\ Studio.app/Contents/jbr/Contents/Home; do
    if [[ -x "$candidate/bin/java" ]]; then export JAVA_HOME="$candidate"; break; fi
  done
fi
export ANDROID_AVD_HOME="$PWD/.tools/avd"
