# lmux

A lightweight web UI for [llama.cpp](https://github.com/ggerganov/llama.cpp). Manage local GGUF models, browse and download from HuggingFace, configure launch profiles based on your hardware, and chat with running models.

Built with SvelteKit, Bun, and SQLite.

## Features

- **Model Library** -- Scan local GGUF files and HuggingFace cache, parse metadata (architecture, params, quant type, context length), display in a browsable grid
- **HuggingFace Integration** -- Search models, browse trending, inspect repo files with VRAM fit indicators, download with progress/resume/cancel, fetch recommended sampling parameters from `generation_config.json`
- **Hardware Detection** -- NVIDIA (nvidia-smi), AMD (rocm-smi), CPU, RAM, and disk. Used to auto-generate launch profiles
- **VRAM Recommendations** -- Estimates VRAM for model weights + KV cache, including hybrid SSM/attention models (Qwen3.5, etc.). Layers-first allocation strategy (maximize GPU layers, then fit context into remaining VRAM)
- **Launch Profiles** -- Per-model saved configurations: GPU layers, context size, threads, batch size, flash attention, KV cache type, port, extra flags
- **Server Management** -- Spawn/stop llama-server, health polling, log viewer, one-server-at-a-time with mutex serialization
- **Chat-Model Coupling** -- Conversations are tied to specific models. Model selector for new chats, "Launch model" button when the conversation's model isn't running, stop-and-switch flow
- **Chat** -- SSE streaming, markdown rendering with KaTeX math support, `<think>` block collapsing, conversation CRUD, adjustable sampling parameters per model, multi-turn editing (edit and regenerate from any point)
- **Image/Vision** -- Upload images in chat for multimodal models. Configure mmproj path per launch profile. Inline image thumbnails in messages
- **Tool Calling** -- Built-in `web_search` (via SearXNG) and `fetch_url` tools with SSRF protection. Collapsible tool status cards with friendly labels and elapsed time. Configurable per-session
- **Coding Agent** -- Project mode with 9 coding tools: `read_file`, `write_file`, `edit_file`, `insert_lines`, `list_directory`, `search_files`, `run_command`, `start_process`, `stop_process`. Landlock-sandboxed command execution with command approval flow and "Always Allow". AGENTS.md support for per-project instructions
- **Self-Planning Pipeline** -- Three-pass plan-then-execute architecture inspired by Self-Planning (arXiv:2303.06689) and BRAID (arXiv:2512.15959). Pass 0: RAG retrieval (directory tree + model-generated search terms + file snippets). Pass 1: generate a step-by-step plan with no tools. Pass 2: execute with tools using the plan as guidance. Visible collapsible plan block in chat. Skips re-planning on continuations
- **Background Processes** -- `start_process` for long-running commands (dev servers, watchers) with `wait_for` string matching, configurable timeout, and auto-kill at 30 minutes. Process list in workspace sidebar with kill buttons. `run_command` rejects trailing `&` with guidance to use `start_process`
- **Verify-and-Repair Loop** -- Coding prompt instructs the model to always run build/tests after changes, read errors, fix, and re-run until passing. Auto-retry on empty responses with "Continue with the next step"
- **Workspace UI** -- Project file tree, file preview with syntax highlighting and git diff view, session list with delete. Right control panel (wide screens) with Plan toggle, Reasoning toggle, running processes, and sampling sliders with Qwen3.5-optimized coding defaults (temp 0.6, top_k 20, repeat_penalty 1.0)
- **System Prompts** -- Global default with per-model overrides. Template variables (`{{date}}`, `{{time}}`, `{{day}}`, `{{model}}`, `{{user}}`) expanded at send time
- **Prompt Presets** -- Save and load sampling + system prompt combos (e.g. "Creative writing", "Code assistant")
- **Reasoning Budget** -- Control max thinking tokens for models that support reasoning/thinking. On by default (32K) in workspace, auto-disabled for small contexts
- **Conversation Organization** -- Search/filter, taggable conversations with sidebar filter pills
- **Model Comparison** -- Side-by-side read-only view of two conversations
- **Server Logs** -- Collapsible terminal panel showing llama-server stderr output in real-time
- **Export** -- Download conversations as markdown or JSON
- **Keyboard Shortcuts** -- Ctrl+N new chat, Ctrl+Shift+S stop server, Escape cancel generation
- **KV Cache Persistence** -- Optional `--slot-save-path` support for resuming conversations without re-processing the prompt. Defaults to `~/.cache/lmux/kv`
- **Settings** -- Models directory, llama-server path (auto-detect), HuggingFace token, VRAM headroom, SearXNG URL, KV cache directory, global system prompt

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
