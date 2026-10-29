# CLAUDE.md — Auto-Vision Project Governance

## Build Validation (mandatory after every change)
```bash
cd src-tauri && cargo check        # Rust compilation
npx tsc --noEmit                   # TypeScript type checking
```
Both must pass before any PR or commit.

## Hard Rules
- **250-line file limit**: No source file may exceed 250 lines. Split into focused modules.
- **Tauri v2 patterns only**: Use `tauri::Manager`, `WebviewWindowBuilder`, `tauri::Emitter`. No v1 APIs.
- **IPC push architecture**: Cross-window sync via Rust `emit_to`/`emit` + `listen()` on the frontend. Never use `window.addEventListener("storage")` for cross-window communication.
- **No `window.addEventListener("storage")`**: Use `listen<string>("data-updated", ...)` from `@tauri-apps/api/event` instead. The Rust backend (`persistent.rs`) emits `data-updated` after every persistent write.

## Architecture Overview

### Rust Backend (`src-tauri/src/`)
- `lib.rs` — App setup, plugin registration, lifecycle guards
- `capture.rs` — Screen capture with RwLock-protected CaptureSession
- `shortcuts.rs` — Global shortcut registration and handling
- `persistent.rs` — Cross-window data sync (single source of truth)
- `speaker/` — System audio capture (platform-specific)
- `input.rs` — Keyboard/mouse input injection (Windows)
- `window.rs` — Window management utilities

### Frontend Contexts (`src/contexts/`)
- `config.context.tsx` — AI providers, system prompts, screenshot config
- `audio.context.tsx` — Audio capture state
- `workflow.context.tsx` — Workflow definitions and execution state
- `theme.context.tsx` — Theme and transparency settings

### Workflow Hook Split (`src/hooks/workflow/`)
- `useWorkflowState.ts` — ExecutionContext, CapturedImage types, emitProgress helper
- `useCaptureStep.ts` — Capture, keypress, wait, loop, await_input step execution
- `useAIStep.ts` — AI process step: provider resolution, LLM call, usage logging
- `src/hooks/useWorkflowRunner.ts` — Orchestrator importing the above three

### Lifecycle Guards (lib.rs)
1. `on_page_load(PageLoadEvent::Started)` — Catches F5/hot-reload, cancels audio capture
2. `WindowEvent::Destroyed` — Catches window close, cancels audio capture
Both cancel the `CancellationToken` and abort the stream task.

## Technical Debt Ledger
Files exceeding the 250-line limit that need future refactoring:

| File | Lines | Priority |
|------|-------|----------|
| `src/hooks/useCompletion.ts` | 1011 | High |
| `src/hooks/useSystemAudio.ts` | 918 | Medium |
| `src/hooks/useChatCompletion.ts` | 755 | Medium |
| `src/contexts/config.context.tsx` | 541 | Low |
| `src-tauri/src/capture.rs` | 744 | Low (already hardened) |
| `src-tauri/src/shortcuts.rs` | 716 | Low |
