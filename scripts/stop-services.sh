#!/bin/sh

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
app="$root/app"
mode=${1:-all}

case "$mode" in
	dev|serve|all) ;;
	*) printf 'usage: %s [dev|serve|all]\n' "$0" >&2; exit 2 ;;
esac

pids=""
for pid in $(lsof -t -a -d cwd "$app" 2>/dev/null || true); do
	command=$(ps -p "$pid" -o command= 2>/dev/null || true)
	case "$mode:$command" in
		dev:*"vite dev"*|all:*"vite dev"*|serve:*"bun build/index.js"*|all:*"bun build/index.js"*|serve:*"hue-serve."*"/index.js"*|all:*"hue-serve."*"/index.js"*)
			pids="$pids $pid"
			;;
	esac
done

if [ -n "$pids" ]; then
	kill $pids 2>/dev/null || true
fi

printf 'HUE %s processes stopped.\n' "$mode"
