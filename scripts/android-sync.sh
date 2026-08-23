#!/bin/sh
set -eu

hue_repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
hue_origin=${HUE_SERVER_URL:-http://10.0.2.2:4173}
HUE_SERVER_URL=$hue_origin
export HUE_SERVER_URL

cd "$hue_repo_dir/app"
exec bunx cap sync android
