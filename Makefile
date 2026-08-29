.PHONY: install dev build serve stop stop-dev stop-build

HOST ?= 127.0.0.1
PORT ?= 4173
ORIGIN ?= http://$(HOST):$(PORT)
HUE_DATABASE_PATH ?= $(HOME)/.hue/hue.db

install:
	bun install --frozen-lockfile

dev: install
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	cd app && HUE_DATABASE_PATH="$(HOME)/.hue/hue-dev.db" bun --env-file=.env --bun vite dev

build: install
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	bun run --cwd app build

serve:
	cd app && HOST="$(HOST)" PORT="$(PORT)" ORIGIN="$(ORIGIN)" HUE_DATABASE_PATH="$(HUE_DATABASE_PATH)" bun --env-file=.env run start

stop-dev:
	@./scripts/stop-services.sh dev

stop-build:
	@./scripts/stop-services.sh serve

stop:
	@./scripts/stop-services.sh all
