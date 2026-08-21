.PHONY: install dev

install:
	bun install --frozen-lockfile

dev: install
	bun run --cwd docs dev
	@trap 'bun run --cwd docs dev:stop; exit 0' INT TERM; \
	bun run --cwd app dev; status=$$?; \
	bun run --cwd docs dev:stop; exit $$status
