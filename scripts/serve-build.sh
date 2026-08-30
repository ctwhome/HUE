#!/bin/sh

set -eu

if [ "$#" -lt 2 ]; then
	printf 'usage: %s BUILD_DIR COMMAND [ARG ...]\n' "$0" >&2
	exit 2
fi

build=$1
shift
parent=$(CDPATH= cd -- "$(dirname -- "$build")" && pwd)
release=$(mktemp -d "$parent/.hue-serve.XXXXXX")

cleanup() {
	rm -rf "$release"
}
trap cleanup EXIT HUP INT TERM

cp -R "$build/." "$release/"
"$@" "$release/index.js"
