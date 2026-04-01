.PHONY: dev build preview check lint format test clean

dev:
	bun run dev

build:
	bun run build

preview:
	bun run preview

check:
	bun run check

lint:
	bun run lint

format:
	bun run format

test:
	bun run test

install:
	bun install

clean:
	rm -rf .svelte-kit build node_modules/.vite
