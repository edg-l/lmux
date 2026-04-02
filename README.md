<p align="center">
  <img src="static/logo.svg" alt="lmux" width="200"/>
</p>

<h1 align="center">lmux</h1>

<p align="center">A lightweight web UI for <a href="https://github.com/ggerganov/llama.cpp">llama.cpp</a>. Manage local GGUF models, browse and download from HuggingFace, configure launch profiles based on your hardware, and chat with running models.</p>

Built with SvelteKit, Bun, and SQLite.

## Features

### Zero-Config Model Setup

Scan your local GGUF files, detect your hardware (NVIDIA/AMD/CPU), and auto-generate optimized launch profiles. lmux estimates VRAM for weights + KV cache (including hybrid SSM/attention models like Qwen3.5), maximizes GPU layers, and picks the best context size for your hardware. Browse and download models directly from HuggingFace with VRAM fit indicators per quant variant.

### Coding Agent with Self-Planning

Project mode turns your local model into a coding agent with file read/write/edit, search, and sandboxed command execution. A research-backed self-planning pipeline (inspired by [Self-Planning](https://arxiv.org/abs/2303.06689) and [BRAID](https://arxiv.org/abs/2512.15959)) generates a step plan before execution:

1. **Retrieval** -- searches the codebase for relevant files based on your request
2. **Planning** -- generates a numbered step plan with no tools (forces thinking before acting)
3. **Execution** -- follows the plan using tools, with a verify-and-repair loop at the end

Commands run inside a [Landlock](https://landlock.io/) sandbox with an approval flow. Background processes (dev servers, watchers) are tracked with auto-kill. Workspace UI includes file tree, git diff view, and a control panel with sampling sliders tuned to Qwen3.5 coding defaults.

### Chat

Streaming chat with markdown, KaTeX math, syntax highlighting, and `<think>` block support. Built-in web search (SearXNG) and URL fetch tools. Multi-turn editing, image/vision support, adjustable sampling and reasoning budget, conversation tags, export, and prompt presets.

### Everything Else

- HuggingFace search, trending, download with progress/resume
- Per-model system prompts with template variables
- KV cache persistence across sessions
- Server log viewer, model comparison page
- Keyboard shortcuts (Ctrl+N, Escape, etc.)

## Requirements

- [Bun](https://bun.sh/) (runtime and package manager)
- [llama.cpp](https://github.com/ggerganov/llama.cpp) server binary (`llama-server`)
- Linux (hardware detection reads `/proc/cpuinfo`, `/proc/meminfo`, uses `nvidia-smi`/`rocm-smi`)
- Optional: [landlock-restrict](https://github.com/landlock-lsm/go-landlock) for sandboxed command execution in coding agent (`go install github.com/landlock-lsm/go-landlock/cmd/landlock-restrict@latest`)
- Optional: [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) for file search in coding agent

## Getting Started

```sh
# Install dependencies
bun install

# Start dev server
bun run dev

# Open http://localhost:5173
```

On first launch, lmux will:

1. Create its database at `~/.local/share/lmux/lmux.db`
2. Create a models directory at `~/.local/share/lmux/models/`
3. Auto-detect your hardware and llama-server path

Go to **Settings** to configure paths and your HuggingFace token, then browse **Models** to scan local files or **Search** to find models on HuggingFace.

## Development

```sh
bun run dev          # Start dev server
bun run check        # TypeScript type checking
bun run lint         # Prettier + ESLint
bun run format       # Auto-format
bun run test         # Run tests
```

### Database Migrations

Schema migrations use a synchronous runner built on bun:sqlite. SQL files live in `src/lib/server/migrations/` and are applied automatically on startup. To add a migration, create a new numbered file like `012_add_column.sql`.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/) (bun:sqlite, Bun.spawn)
- **Framework**: [SvelteKit](https://svelte.dev/) with Svelte 5 runes
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4 with dark theme
- **Markdown**: [marked](https://github.com/markedjs/marked) + [DOMPurify](https://github.com/cure53/DOMPurify) + [KaTeX](https://katex.org/)
- **Syntax Highlighting**: [highlight.js](https://highlightjs.org/)
- **Sandbox**: [Landlock](https://landlock.io/) via [go-landlock](https://github.com/landlock-lsm/go-landlock) (optional)

## License

MIT
