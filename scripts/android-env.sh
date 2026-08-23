#!/bin/sh

if [ -z "${ANDROID_SDK_ROOT:-}" ]; then
	for hue_sdk_candidate in \
		"${ANDROID_HOME:-}" \
		'/Volumes/DATA-ext/Android SDK/sdk'
	do
		if [ -n "$hue_sdk_candidate" ] && [ -d "$hue_sdk_candidate/platform-tools" ]; then
			ANDROID_SDK_ROOT=$hue_sdk_candidate
			break
		fi
	done
fi

if [ -z "${ANDROID_SDK_ROOT:-}" ] || [ ! -x "$ANDROID_SDK_ROOT/platform-tools/adb" ]; then
	printf '%s\n' 'Android SDK not found. Set ANDROID_SDK_ROOT or mount DATA-ext.' >&2
	exit 1
fi

ANDROID_HOME=$ANDROID_SDK_ROOT
export ANDROID_HOME ANDROID_SDK_ROOT

if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
	JAVA_HOME=$(/usr/libexec/java_home -v 21)
	export JAVA_HOME
fi

PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"
export PATH
