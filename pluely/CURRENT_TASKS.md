# Current Development Tasks

> Last Updated: Jan 9, 2026

## ✅ Recently Completed

### Model Switching & Capabilities (Phase 10A, 10A.2) - Jan 2025
- [x] In-Chat Model Switcher (`ModelSwitcher.tsx`) with provider/model dropdown
- [x] Dynamic model fetching from `/v1/models` endpoint per provider
- [x] Model Profiles system with vision + context window tracking
- [x] Default profiles: `vision-large`, `vision-standard`, `text-only`, `local-conservative`
- [x] Pattern matching for auto-profile suggestion based on model name
- [x] `useModelTester` hook with automated vision + context window testing
- [x] Context Management page (`pages/context/index.tsx`) for profile CRUD
- [x] Profile persistence in localStorage with model→profile mappings

### Incremental Shortcut Registration (Dec 17, 2024)
- [x] Add `register_shortcut` Rust command
- [x] Add `unregister_shortcut` Rust command  
- [x] Register commands in `lib.rs`
- [x] Update `useWorkflowRunner` await_input to use incremental registration
- [x] Verified fix works - no more full shortcut rebuild on F1 press

### Visual Node Editor (Phase 8B)
- [x] React Flow setup with `@xyflow/react`
- [x] Custom `WorkflowNode.tsx` with dark theme styling
- [x] Step naming hierarchy (User name → System type → Details)
- [x] Hover tooltips for Await Input and Loop nodes
- [x] Click-to-edit sidebar integration
- [x] React Flow CSS overrides in `global.css`

### Provider Persistence (Phase 9)
- [x] Store `providerId`/`model` per conversation
- [x] Hybrid provider logic (conversation → global fallback)
- [x] Model dropdown with `/v1/models` auto-fetch
- [x] Database migration for provider columns

---

## 🔜 Next Priority: Phase 10A.1, 10B (Model Switching Polish)

### Phase 10A.1: Visual Divider (~10 min)
- [ ] Insert special message: `--- Switched to X ---`
- [ ] Store as `type: 'model_switch'` in messages

### Phase 10B: Context Sanitization (~30 min)
- [ ] Detect when switching vision→text model
- [ ] Strip images from history
- [ ] Replace with placeholder: `[Image removed: ...]`

---

## 📋 Backlog

### Phase 7: HUD Overlay
- Transparent overlay showing workflow progress
- Miniature graph with current step highlighted
- Keymap display during await_input
- **Thought**: For debugging, helps users see what step is running

### Phase 8.5: Reference Nodes
- "Dictionary" nodes showing available sub-workflows
- Shows connections visually in graph
- **Thought**: When editing, you need to know what other workflows exist

### Phase 8.6: Collapsible Groups
- Loops visually contain their child steps
- Collapse/expand for cleaner graph
- **Thought**: Current flat visualization doesn't show loop scope

### Phase 10C: Context Checkpoints
- Avoid resending full history on every message
- Create "checkpoint" on model switch
- Send: [checkpoint summary] + [messages after checkpoint]

### Phase 10D: Handoff Profiles
- UI for "Quick" / "Full" / "Vision" transfer modes
- User control over what gets transferred

### Phase 11: Branding
- Strip Pluely branding
- Rename to user's brand

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/pages/chats/components/ModelSwitcher.tsx` | In-chat provider/model dropdown |
| `src/hooks/useModelTester.ts` | Automated vision + context testing |
| `src/lib/storage/model-profiles.storage.ts` | Profile persistence + model mapping |
| `src/config/model-profiles.constants.ts` | Built-in profiles + pattern matching |
| `src/pages/context/index.tsx` | Context management dashboard |
| `src/hooks/useWorkflowRunner.ts` | Workflow execution engine |
| `src/hooks/useChatCompletion.ts` | AI chat with provider logic |
| `src/contexts/app.context.tsx` | Global state, workflows |
| `src-tauri/src/shortcuts.rs` | Shortcut registration |
| `DEVELOPMENT_CONTEXT.md` | Full design decisions |
