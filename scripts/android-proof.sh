#!/bin/sh
set -eu

hue_repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/android-env.sh
. "$hue_repo_dir/scripts/android-env.sh"

hue_avd=${HUE_ANDROID_AVD:-Medium_Phone_API_36}
hue_serial=${ANDROID_SERIAL:-emulator-5554}
hue_port=${HUE_ANDROID_PORT:-4186}
hue_https_origin=${HUE_ANDROID_HTTPS_ORIGIN:-}
if [ -n "$hue_https_origin" ]; then
	hue_origin=$hue_https_origin
	hue_mode=https
else
	hue_origin=${HUE_SERVER_URL:-http://127.0.0.1:$hue_port}
	hue_mode=debug-loopback
fi
hue_artifacts="$hue_repo_dir/artifacts/android-proof/$hue_mode"
hue_temp=$(mktemp -d /tmp/hue-android-proof.XXXXXX)
hue_server_pid=''
hue_emulator_pid=''
hue_app_link_approved=''
hue_app_link_host=''

cleanup() {
	if [ -n "$hue_server_pid" ]; then kill "$hue_server_pid" 2>/dev/null || true; fi
	if [ -n "$hue_app_link_approved" ]; then
		adb -s "$hue_serial" shell pm set-app-links --package studio.ctw.hue 0 "$hue_app_link_host" >/dev/null 2>&1 || true
	fi
	if [ -n "$hue_emulator_pid" ]; then
		adb -s "$hue_serial" emu kill >/dev/null 2>&1 || true
		wait "$hue_emulator_pid" 2>/dev/null || true
	fi
	HUE_SERVER_URL=http://10.0.2.2:4173 "$hue_repo_dir/scripts/android-sync.sh" >/dev/null 2>&1 || true
	rm -rf "$hue_temp"
}
trap cleanup EXIT INT TERM

mkdir -p "$hue_artifacts"

if ! adb -s "$hue_serial" get-state >/dev/null 2>&1; then
	emulator -avd "$hue_avd" -no-audio -no-snapshot-save >"$hue_temp/emulator.log" 2>&1 &
	hue_emulator_pid=$!
	adb -s "$hue_serial" wait-for-device
	while [ "$(adb -s "$hue_serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != 1 ]; do sleep 2; done
fi

if [ "$hue_mode" = debug-loopback ]; then
	cd "$hue_repo_dir/app"
	bun run build
	HOST=0.0.0.0 PORT="$hue_port" ORIGIN="http://127.0.0.1:$hue_port" BODY_SIZE_LIMIT=60000000 HUE_DATABASE_PATH="$hue_temp/hue.db" bun build/index.js >"$hue_temp/server.log" 2>&1 &
	hue_server_pid=$!
	for hue_attempt in $(jot 60 1); do
		if curl -fsS "http://127.0.0.1:$hue_port/api/health" >"$hue_artifacts/origin-health.txt" 2>&1; then break; fi
		if [ "$hue_attempt" = 60 ]; then
			printf '%s\n' 'HUE debug server did not become healthy.' >&2
			exit 1
		fi
		sleep 1
	done
	adb -s "$hue_serial" reverse "tcp:$hue_port" "tcp:$hue_port"
else
	curl -fsS "$hue_origin/api/health" >"$hue_artifacts/origin-health.txt"
fi

HUE_SERVER_URL="$hue_origin" "$hue_repo_dir/scripts/android-gradle.sh" :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
cd "$hue_repo_dir/app/android"
{
	rg -n -F "$hue_origin" app/src/main/assets/capacitor.config.json
	rg -n -F "$hue_origin" app/build/generated/source/buildConfig/debug/studio/ctw/hue/BuildConfig.java
} >"$hue_artifacts/origin-injection.txt"

hue_apk="$hue_repo_dir/app/android/app/build/outputs/apk/debug/app-debug.apk"
adb -s "$hue_serial" install -r "$hue_apk"
adb -s "$hue_serial" shell pm grant studio.ctw.hue android.permission.POST_NOTIFICATIONS
adb -s "$hue_serial" shell appwidget grantbind --package studio.ctw.hue --user 0
ANDROID_SERIAL=$hue_serial ./gradlew --no-daemon -PHUE_SERVER_URL="$hue_origin" :app:connectedDebugAndroidTest
for hue_result in "$hue_repo_dir"/app/android/app/build/outputs/androidTest-results/connected/debug/TEST-*.xml; do
	if [ -f "$hue_result" ]; then cp "$hue_result" "$hue_artifacts/connected-tests.xml"; break; fi
done
adb -s "$hue_serial" install -r "$hue_apk"
adb -s "$hue_serial" install -r "$hue_repo_dir/app/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
adb -s "$hue_serial" shell pm grant studio.ctw.hue android.permission.POST_NOTIFICATIONS

hue_runner='studio.ctw.hue.test/androidx.test.runner.AndroidJUnitRunner'
hue_proof_class='studio.ctw.hue.ProofStateInstrumentedTest'
run_proof() {
	hue_proof_name=$1
	hue_proof_method=$2
	hue_proof_output=$3
	adb -s "$hue_serial" shell am instrument -w -e proof "$hue_proof_name" -e class "$hue_proof_class#$hue_proof_method" "$hue_runner" >"$hue_proof_output"
	rg -q '^OK \(1 test\)$' "$hue_proof_output"
}
run_proof webview quickCaptureWebViewIsDraftOnly "$hue_artifacts/webview-quick-capture.txt"
if [ "$hue_mode" = https ]; then
	run_proof https configuredHttpsProjectAndSessionAppLinksLoadHue "$hue_artifacts/https-app-links-instrumentation.txt"
	hue_app_link_host=${hue_origin#https://}
	hue_app_link_host=${hue_app_link_host%%:*}
	adb -s "$hue_serial" shell pm set-app-links --package studio.ctw.hue 2 "$hue_app_link_host"
	hue_app_link_approved=1
	adb -s "$hue_serial" shell pm get-app-links --user 0 studio.ctw.hue >"$hue_artifacts/https-app-link-association.txt"
	rg -q "$hue_app_link_host: approved" "$hue_artifacts/https-app-link-association.txt"
	adb -s "$hue_serial" shell am force-stop studio.ctw.hue
	adb -s "$hue_serial" shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "$hue_origin/?project=project-1" >"$hue_artifacts/https-project-app-link.txt"
	rg -q 'Activity: studio.ctw.hue/.MainActivity' "$hue_artifacts/https-project-app-link.txt"
	adb -s "$hue_serial" shell am force-stop studio.ctw.hue
	adb -s "$hue_serial" shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "$hue_origin/?project=project-1&session=session-1" >"$hue_artifacts/https-session-app-link.txt"
	rg -q 'Activity: studio.ctw.hue/.MainActivity' "$hue_artifacts/https-session-app-link.txt"
fi
run_proof seed seedGenericProofState "$hue_artifacts/proof-state-seed.txt"
adb -s "$hue_serial" shell am broadcast -a studio.ctw.hue.DEBUG_UPDATE_QUICK_IDEA_WIDGET -n studio.ctw.hue/.QuickIdeaWidgetProvider >"$hue_artifacts/widget-update.txt"
rg -q 'Broadcast completed: result=0' "$hue_artifacts/widget-update.txt"
adb -s "$hue_serial" shell dumpsys package studio.ctw.hue >"$hue_artifacts/package.txt"
rg -n 'allowBackup="false"|dataExtractionRules|fullBackupContent="false"' app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml >"$hue_artifacts/backup-disabled.txt"
if rg -i 'local.?notifications|SCHEDULE_EXACT_ALARM|RECEIVE_BOOT_COMPLETED' app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml >"$hue_artifacts/local-notifications-removed.txt"; then
	printf '%s\n' 'Unexpected Local Notifications manifest surface remains.' >&2
	exit 1
fi
{
	adb -s "$hue_serial" shell getprop ro.build.version.release
	adb -s "$hue_serial" shell getprop ro.build.version.sdk
	adb -s "$hue_serial" shell getprop ro.product.cpu.abi
	adb -s "$hue_serial" shell getconf PAGESIZE
} >"$hue_artifacts/device.txt"
adb -s "$hue_serial" shell dumpsys shortcut | rg 'studio\.ctw\.hue|hue-project-|hue-session-|HUE Project|HUE Session|project-1|session-1' >"$hue_artifacts/shortcuts-present.txt"
adb -s "$hue_serial" shell dumpsys notification --noredact | rg 'studio\.ctw\.hue|completion|attention|errors|HUE needs attention|Open HUE to review' >"$hue_artifacts/notifications.txt"
run_proof clear clearGenericProofState "$hue_artifacts/proof-state-clear.txt"
adb -s "$hue_serial" shell dumpsys shortcut | rg 'studio\.ctw\.hue|hue-project-|hue-session-|HUE Project|HUE Session|project-1|session-1' >"$hue_artifacts/shortcuts-removed.txt" || true
shasum -a 256 "$hue_apk" >"$hue_artifacts/apk-sha256.txt"
unzip -l "$hue_apk" | rg '\.so$' >"$hue_artifacts/native-libraries.txt" || true
printf 'MODE=%s\nAPK=%s\nORIGIN=%s\nAVD=%s\n' "$hue_mode" "$hue_apk" "$hue_origin" "$hue_avd" >"$hue_artifacts/summary.txt"
