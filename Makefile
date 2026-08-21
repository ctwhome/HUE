.PHONY: install dev

install:
	bun install --frozen-lockfile

dev: install
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	bun run --cwd app dev
