.PHONY: install dev build serve restart stop stop-dev stop-build

HOST ?= 127.0.0.1
PORT ?= 4173
ORIGIN ?= http://$(HOST):$(PORT)
HUE_DATABASE_PATH ?= $(HOME)/.hue/hue.db

install:
	bun install --frozen-lockfile

dev: install
	@./scripts/stop-services.sh dev
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	cd app && HUE_DATABASE_PATH="$(HOME)/.hue/hue-dev.db" bun --env-file=.env --bun vite dev

build: install
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	bun run --cwd app build

serve:
	@./scripts/stop-services.sh serve
	cd app && HOST="$(HOST)" PORT="$(PORT)" ORIGIN="$(ORIGIN)" HUE_DATABASE_PATH="$(HUE_DATABASE_PATH)" BODY_SIZE_LIMIT="$${BODY_SIZE_LIMIT:-60000000}" ../scripts/serve-build.sh build bun --env-file=.env

restart: build
	launchctl kickstart -k "gui/$$(id -u)/com.ctw.hue-production"

stop-dev:
	@./scripts/stop-services.sh dev

stop-build:
	@./scripts/stop-services.sh serve

stop:
	@./scripts/stop-services.sh all
