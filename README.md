# Auto-Vision — Cognitive Automation

> A local-first desktop agent that **sees your screen, thinks with any LLM, and acts with your keyboard.**
> Build visual, hotkey-triggered workflows that capture screen regions, run them through vision models, and type, paste, or chain the results — without leaving the app you're working in.

[![Tauri v2](https://img.shields.io/badge/Tauri-v2-orange)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Backend-Rust-b7410e)](https://www.rust-lang.org/)
[![React + TS](https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-blue)](https://react.dev/)
[![Tests](https://img.shields.io/badge/vitest-21%2F21%20passing-brightgreen)](pluely/src/workflow/__tests__)
[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](pluely/LICENSE)

Auto-Vision started as a fork of the open-source [Pluely](https://github.com/iamsrikanthnani/pluely) overlay assistant (a Cluely alternative). Since then it has been rebuilt into a workflow automation engine: a Rust input-injection layer, a visual node editor, a typed workflow AST with schema migrations, a multi-provider LLM layer with OS-keychain secrets, and human-in-the-loop hotkey dispatch.

---

## What it does

A **workflow** is a sequence of steps bound to a global hotkey. Press the hotkey from any app and Auto-Vision runs it in the background:

```
[Hotkey] → Capture region ─┐
           Page Down       ├─ Loop ×N → Stitch images → AI (vision model) → Type / Copy / Notify
           Wait 300 ms   ──┘                                   ↓
                                             Await input: [1] accept  [2] retry  [3] run sub-workflow
```

| Step type | What it does |
|---|---|
| `capture_region` / `capture_screen` | Screenshot a saved region (with a region picker) or the full screen |
| `ai_process` | Send text + captured images to any LLM; optional vertical **image stitching** for multi-page captures |
| `keypress` | Inject keystrokes into the focused app via the Rust input layer |
| `wait` | Fixed delays between steps |
| `loop` | Repeat a body of steps (e.g. capture → Page Down → wait, N times) |
| `await_input` | **Human-in-the-loop dispatch** — pause and map keys to actions, including running another workflow |
| `action_notification` | Output result: type it out, copy to clipboard, or show a notification |

Every workflow has a **trigger hotkey** and a separate **emergency-stop hotkey** that halts execution mid-stream (per-chunk, milliseconds — down from 30 s+ before the streaming-loop fix).

## Features built

### Workflow engine
- **Visual node editor** (React Flow) with tree / graph toggle, per-type accent colors, hover tooltips, and click-to-edit sidebar
- **Step registry** — single source of truth for step labels, icons, defaults, and summaries, split into a runtime registry (no React) and a UI registry
- **Typed workflow AST** — `WorkflowStep` is a discriminated union; control-flow types (`if`, `foreach`, `try_catch`, `sub_workflow`) declared for upcoming phases
- **Schema v1 → v2 migrator** — lazy on read, idempotent, never throws on malformed data; rewrites deprecated `delay` / `system_action` / `loop.children`
- **Zod config schemas** on every built-in step with `validateStepConfig()`
- **Sub-workflow composition** via `await_input` → "Run Workflow"

### Native layer (Rust / Tauri v2)
- **Input injection system** with a `KEY_IGNORE` pattern so injected keys don't re-trigger hotkeys, Playwright-style key names, and modifier-trap prevention
- **Image stitching** (`stitch_images_vertical`) for combining scrolling captures into one vision prompt
- **Dynamic global-shortcut registration** — `await_input` keys are registered with the OS only while a step is waiting, then restored; duplicate-owner key conflicts are rejected
- **Cross-window sync** over Tauri IPC (`emit_to` targeted at specific windows so screenshots and audio never broadcast)
- Hardened capture session (`RwLock` held through window build), lifecycle guards that cancel audio capture on reload/close
- Path-traversal-safe downloads and validated persistent-storage keys

### AI providers
- Any OpenAI-compatible endpoint, Anthropic, Gemini, and local models (Ollama, LM Studio)
- Provider presets, **API keys stored in the OS keychain**, and automatic `/v1/models` discovery
- **Model profiles** with capability flags (e.g. `supportsVision` — images are only sent to vision-capable models) and a built-in capability tester
- Per-conversation provider/model persistence with global fallback and an in-chat model switcher
- Quick Setup / Standard / All Providers configuration views

### Assistant app
- Always-on-top overlay with chat, file/image attachments, screenshot and region capture
- Speech-to-text with multiple STT providers and system-audio capture
- SQLite conversation history (UPSERT saves, summary queries for list views, metadata migrations), Markdown export / download

## Engineering

- **Tests:** Vitest suite covering the migrator, step registry/schemas, and v1 fixtures for every legacy step type — `21/21` passing
- **Build gates:** `cargo check`, `cargo test`, `tsc --noEmit`, and `npm test` before every commit
- **Governance:** [`pluely/CLAUDE.md`](pluely/CLAUDE.md) enforces a 250-line file limit, Tauri-v2-only APIs, and IPC-push (no `storage` events) for cross-window state, with a tracked tech-debt ledger
- **Refactors:** `useWorkflowRunner` split from 588 → 204 lines into capture/AI/state hooks; six duplicated provider-resolution code paths consolidated into one resolver; eight hand-rolled event-listener cleanups replaced with `useTauriEvent`

## Timeline

| When | Milestone |
|---|---|
| Nov 2025 | Forked Pluely; dynamic model support, chat attachments, workflow runner repair |
| Dec 2025 | Rust input injection · image stitching · wait/loop steps · two-hotkey model with emergency stop · `await_input` human-in-the-loop dispatch · visual node editor · provider persistence · model profiles |
| Jan 2026 | Vision-aware profile routing · **rebrand to Auto-Vision** |
| Mar 2026 | Hardening pass, context split, cross-window sync fixes · provider system refactor + keychain storage · [strategic execution plan](pluely/EXECUTION_PLAN.md) |
| Apr 2026 | Download/copy fixes, SQLite efficiency (UPSERT, summary queries) |
| May 2026 | Workflow architecture overhaul: test harness, persistence & Rust security fixes, step registry, typed AST + migrator, Zod schemas |

See the [execution plan](pluely/EXECUTION_PLAN.md) for the 90-day roadmap: variables and data transforms, branching, data-source steps, sub-workflows, and parallel execution.

## Getting started

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (Rust, Node.js 18+, and the platform toolchain), then:

```bash
git clone https://github.com/AdityaBaranwal1/Cognitive-Automation.git
cd Cognitive-Automation/pluely
npm install
npm run tauri dev      # run the desktop app
npm test               # vitest suite
npm run tauri build    # platform installers → src-tauri/target/release/bundle/
```

## Repository layout

```
pluely/                    # the Auto-Vision app (folder name kept from the fork)
├── src/
│   ├── workflow/          # step registry, per-step definitions + Zod schemas
│   ├── hooks/workflow/    # runner split: state, capture steps, AI step
│   ├── lib/               # providers, keychain, storage, migrations, shortcuts
│   ├── pages/workflows/   # visual node editor
│   └── contexts/          # config / audio / workflow / theme
└── src-tauri/src/         # Rust: capture, input injection, shortcuts, persistence, audio
```

## License & credits

GPL-3.0, inherited from [Pluely](https://github.com/iamsrikanthnani/pluely) by Srikanth Nani — this project is a modified version of that work.
