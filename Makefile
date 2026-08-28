.PHONY: install dev build stop stop-dev stop-build

install:
	bun install --frozen-lockfile

dev: install
	$(MAKE) stop-dev
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	cd app && HUE_DATABASE_PATH="$$HOME/.hue/hue-dev.db" bun --env-file=.env --bun vite dev

build: install
	$(MAKE) stop-build
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	bun run --cwd app build
	cd app && bun --env-file=.env -e 'if (!process.env.HUE_ACCESS_SECRET) throw new Error("HUE_ACCESS_SECRET is required in app/.env")'
	cd app && HOST=127.0.0.1 PORT=4174 ORIGIN=https://m3-max.tail33436f.ts.net:4173 bun --env-file=.env run start

stop-dev:
	@pids="$$(lsof -tiTCP:4010 -sTCP:LISTEN 2>/dev/null || true)"; if [ -n "$$pids" ]; then kill $$pids; fi

stop-build:
	@pids="$$(lsof -tiTCP:4174 -sTCP:LISTEN 2>/dev/null || true)"; if [ -n "$$pids" ]; then kill $$pids; fi

stop:
	@./scripts/stop-services.sh
