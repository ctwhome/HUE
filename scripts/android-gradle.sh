#!/bin/sh
set -eu

hue_repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/android-env.sh
. "$hue_repo_dir/scripts/android-env.sh"

hue_origin=${HUE_SERVER_URL:-http://10.0.2.2:44011}
for hue_argument in "$@"; do
	case "$hue_argument" in
		-PHUE_SERVER_URL=*) hue_origin=${hue_argument#-PHUE_SERVER_URL=} ;;
	esac
done
HUE_SERVER_URL=$hue_origin
export HUE_SERVER_URL
"$hue_repo_dir/scripts/android-sync.sh"

cd "$hue_repo_dir/app/android"
exec ./gradlew --no-daemon "-PHUE_SERVER_URL=$hue_origin" "$@"
