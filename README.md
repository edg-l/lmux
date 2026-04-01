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
- **Tool Calling** -- Built-in `web_search` (via SearXNG) and `fetch_url` tools with SSRF protection. Collapsible tool status cards in the chat UI. Configurable per-session
- **System Prompts** -- Global default with per-model overrides. Template variables (`{{date}}`, `{{time}}`, `{{day}}`, `{{model}}`, `{{user}}`) expanded at send time
- **Prompt Presets** -- Save and load sampling + system prompt combos (e.g. "Creative writing", "Code assistant")
- **Reasoning Budget** -- Control max thinking tokens for models that support reasoning/thinking
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

Schema migrations use [migralite](https://github.com/i9or/migralite). SQL files live in `src/lib/server/migrations/` and are applied automatically on startup. To add a migration, create a new file like `002_add_column.sql`.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/) (bun:sqlite, Bun.spawn)
- **Framework**: [SvelteKit](https://svelte.dev/) with Svelte 5 runes
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4 with dark theme
- **Markdown**: [marked](https://github.com/markedjs/marked) + [DOMPurify](https://github.com/cure53/DOMPurify) + [KaTeX](https://katex.org/)
- **Migrations**: [migralite](https://github.com/i9or/migralite)

## License

MIT
