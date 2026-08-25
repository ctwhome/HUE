.PHONY: install dev stop

install:
	bun install --frozen-lockfile

dev: install
	$(MAKE) stop
	HUE_DOCS_BASE=/docs HUE_DOCS_OUT_DIR=../app/static/docs bun run --cwd docs build
	bun run --cwd app dev

stop:
	@./scripts/stop-services.sh
