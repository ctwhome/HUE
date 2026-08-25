#!/bin/sh

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
app="$root/app"
uid=$(id -u)
pids=""

for label in com.ctw.hue-workspace com.ctw.hue-tailnet-proxy; do
	launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
done

for pid in $(lsof -t -a -d cwd "$app" 2>/dev/null || true); do
	command=$(ps -p "$pid" -o command= 2>/dev/null || true)
	case "$command" in
		*"bun run dev"* | *"bun run --cwd app dev"* | *"bun --bun vite dev"* | \
			*"$app/node_modules/.bin/vite dev"* | *"bun run start"* | *"bun run --cwd app start"* | \
			*"bun build/index.js"* | *"/.hermes/hermes-agent/hermes serve --isolated"* | \
			*"/.hermes/hermes-agent/hermes acp"*)
			pids="$pids $pid"
			;;
	esac
done

for script in \
	"$HOME/Library/Application Support/HUE/hue-tailnet-proxy.ts" \
	"$HOME/Library/Application Support/HUE/hue-production-proxy.ts" \
	"$HOME/.hue/run-dev-pty.py"; do
	for pid in $(pgrep -f "$script" 2>/dev/null || true); do
		pids="$pids $pid"
	done
done

if [ -n "$pids" ]; then
	kill $pids 2>/dev/null || true
	sleep 1
	for pid in $pids; do
		kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
	done
fi

printf 'HUE services stopped.\n'
