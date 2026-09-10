#!/bin/sh

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mode=${1:-desktop}
server_pid=""

case "$mode" in
	desktop|web) ;;
	*) printf 'usage: %s [desktop|web]\n' "$0" >&2; exit 2 ;;
esac

cleanup() {
	status=$?
	trap - EXIT INT TERM HUP
	if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
		kill "$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
	launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.ctw.hue-production.plist" 2>/dev/null ||
		launchctl kickstart -k "gui/$(id -u)/com.ctw.hue-production" 2>/dev/null || true
	exit "$status"
}
trap cleanup EXIT INT TERM HUP

launchctl bootout "gui/$(id -u)/com.ctw.hue-production" 2>/dev/null || true
"$root/scripts/stop-services.sh" all
HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd "$root/docs" build

(
	cd "$root/app"
	HUE_DATABASE_PATH="${HUE_DATABASE_PATH:-$HOME/.hue/hue.db}" bun --env-file=.env --bun vite dev
) &
server_pid=$!

if [ "$mode" = web ]; then
	wait "$server_pid"
	server_pid=""
	exit 0
fi

attempt=0
until curl --fail --silent --show-error http://127.0.0.1:44010/ >/dev/null 2>&1; do
	if ! kill -0 "$server_pid" 2>/dev/null; then
		wait "$server_pid"
	fi
	attempt=$((attempt + 1))
	if [ "$attempt" -ge 200 ]; then
		printf 'HUE development server did not become ready on port 44010.\n' >&2
		exit 1
	fi
	sleep 0.1
done

HUE_DESKTOP_ORIGIN=http://127.0.0.1:44010 bun run --cwd "$root/desktop" dev
