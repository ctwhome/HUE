.PHONY: install dev stop

install:
	bun install --frozen-lockfile

dev: install
	$(MAKE) stop
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	cd app && if [ -f .env ]; then bun --env-file=.env --bun vite dev; else bun --bun vite dev; fi

stop:
	@./scripts/stop-services.sh
