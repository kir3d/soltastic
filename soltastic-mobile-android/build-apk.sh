#!/usr/bin/env bash
set -euo pipefail

pkill -f "GradleDaemon" || true
pkill -f "org.gradle" || true

./android/gradlew --stop || true

rm -rf android/app/.cxx
rm -rf android/app/build
rm -rf android/build
rm -rf android/.gradle

./android/gradlew -p android --no-daemon :app:assembleRelease --stacktrace

echo
echo "APK:"
echo "android/app/build/outputs/apk/release/app-release.apk"
