# Auto-Vision Development Context & Roadmap

> **Purpose**: This document provides comprehensive context for AI assistants continuing development on Auto-Vision. It includes not just WHAT to build, but WHY decisions were made.

---

## Project Overview

**Auto-Vision** is a Tauri-based desktop application that enables visual workflow automation with AI integration. Think of it as a "workflow builder meets AI chat" - users create automated sequences that can capture screenshots, process them with AI, wait for user input, and execute actions.

### Key Architecture Decisions

1. **Tauri v2** - Chosen for cross-platform desktop app with Rust backend
2. **React + TypeScript** - Frontend with strong typing
3. **React Flow** - Visual node editor (added in Phase 8)
4. **SQLite** - Local database for conversations and settings
5. **Global Shortcuts** - Rust-side registration via `tauri-plugin-global-shortcut`

---

## Part 1: Engine (Foundation) ✅ Complete

### Phase 1: Execution Context Refactor
- **What**: Centralized `ExecutionContext` object passed through workflow steps
- **Why**: Steps need to share state (captured images, previous outputs, stop flags)
- **Key Files**: `src/hooks/useWorkflowRunner.ts`

### Phase 2: Rust Input Injection
- **What**: `send_keypress` and `send_text` Rust commands
- **Why**: Workflows need to type text or press keys in other applications
- **Key Files**: `src-tauri/src/input.rs`

### Phase 3: Image Stitching
- **What**: `stitch_images_vertical` command to combine multiple screenshots
- **Why**: Workflows might need to capture a long page in multiple screenshots
- **Key Files**: `src-tauri/src/capture.rs`

### Phase 4: Wait & Loop Primitives
- **What**: `wait` step (delay in ms) and `loop` step (repeat N times)
- **Why**: Workflows need timing control and iteration
- **Key Files**: `src/hooks/useWorkflowRunner.ts`, `src/types/workflow.ts`

### Phase 5: Safety Systems
- **What**: Emergency stop key, `shouldStop` flag in context
- **Why**: Users need to abort runaway workflows immediately
- **Key Files**: `useWorkflowRunner.ts` (stopActionId, shouldStopRef)

---

## Part 2: Brain (Orchestration) 🟡 In Progress

### Phase 6B: `await_input` Step ✅ Complete

**What It Does**:
- Pauses workflow execution
- Registers temporary hotkeys (F2, F3, etc.)
- Waits for user to press one of the configured keys
- Routes to different actions: Continue, Break, Keypress, Run Sub-Workflow

**Why This Design**:
The user wanted a "dispatch node" - a human-in-the-loop checkpoint where workflows pause and wait for decisions. This enables:
- Manual review of AI output before proceeding
- Branching based on human judgment
- Triggering sub-workflows from a single await point

**Technical Implementation**:
```
Workflow runs → Hits await_input → Registers F2/F7/F8 with OS
User presses F7 → Callback fires → Runs associated sub-workflow
Sub-workflow completes → Returns to await (looping) OR continues
```

**Bug Fixed (Dec 17, 2024)**: 
Original implementation used `update_shortcuts` which unregisters ALL shortcuts then re-registers. This caused visible "flashing" where trigger keys briefly stopped working.

**Solution**: Added `register_shortcut` and `unregister_shortcut` Rust commands for incremental registration. Await keys are added individually without touching existing shortcuts.

### Phase 6B.1: Incremental Shortcut Registration ✅ Complete

**What**: New Rust commands for single-key registration/unregistration
- `register_shortcut(action_id, key)` - Add one key
- `unregister_shortcut(action_id)` - Remove one key

**Why**: The old `update_shortcuts` approach caused all shortcuts to be unregistered and re-registered every time await_input ran. This was wasteful and caused visible issues.

**Key Files**:
- `src-tauri/src/shortcuts.rs` - New commands
- `src-tauri/src/lib.rs` - Register commands
- `src/hooks/useWorkflowRunner.ts` - Use incremental approach

### Phase 6C: Sub-Workflows ✅ Complete

**What**: `run_workflow` action in await_input keymap
**Why**: Enables composition - press F7 to run "Analyze Screenshot" workflow, press F8 to run "Send to Clipboard", etc.

### Phase 7: HUD Overlay ⬜ Not Started

**Vision**:
A transparent overlay that shows:
1. **Visual minimap** of the current workflow graph
2. **Current step highlight** - which node is executing
3. **Keymap display** - what keys are active during await_input
4. **Status indicators** - running, paused, failed

**Why This Matters**:
When workflows run, they're invisible. The user doesn't know what step is executing or what keys to press. The HUD provides situational awareness without blocking the screen.

**Technical Approach** (planned):
- Render React Flow graph in miniature
- Highlight current node with pulsing animation
- Show await_input keys as floating badges
- Use Tauri's `set_decorations(false)` for transparent overlay

**Thought Process**:
User wants debugging capabilities. When a workflow fails mid-step, they need to know WHERE it failed. The miniature graph view shows progress visually. This is similar to how game HUDs show map objectives.

### Phase 8: Visual Node Editor 🟡 Partial

**Goal**: Replace the tree-based workflow editor with a visual node graph (like Unreal Blueprints, n8n, etc.)

#### 8.1-8.4: React Flow Setup ✅ Complete

**Implementation**:
- React Flow installed via `@xyflow/react`
- `WorkflowCanvas.tsx` - Renders the graph
- `useWorkflowGraph.ts` - Converts workflow steps to nodes/edges
- `WorkflowNode.tsx` - Custom node component with styling
- Tree/Graph toggle in workflow editor header

**Design Decisions**:
- **Dark theme styling** - All nodes use dark backgrounds with colored accents per step type
- **Hierarchical labels**: User name (bold) → System type (colored) → Technical details (dim)
- **Hover tooltips** for complex steps showing keymap or loop iterations
- **CSS overrides** for React Flow defaults (global.css)

**Why Tree View Still Exists**:
User preference - "optimize Tree View for editing, Graph View for visualization". The tree is faster for adding/reordering steps. The graph shows relationships visually.

#### 8.5: Reference Nodes ⬜ Not Started

**Vision**:
Special "dictionary" nodes that appear in every workflow and act as references for:
- Available sub-workflows
- Common await_input keymaps
- Shared system prompts

**Why**:
When editing a workflow, you need to know what other workflows exist to reference them. Reference nodes would show these connections visually.

**Thought Process**:
Like documentation nodes in Unreal Blueprints. They don't execute but provide context. Could also show validation warnings (e.g., "Referenced workflow 'XYZ' was deleted").

#### 8.6: Collapsible Groups ⬜ Not Started

**Vision**:
Loops should visually contain their child steps. When collapsed, show as a single node. When expanded, show nested subgraph.

**Why**:
Current loop visualization is flat - you don't see which steps are inside the loop. Collapsible groups make this explicit.

**Technical Approach** (planned):
React Flow supports nested nodes via parent-child relationships. Use `parentNode` property to create visual groups.

#### 8.7: Drag to Reorder ⬜ Not Started

**What**: Drag edges to reorder step execution order
**Why**: Visual editing should be intuitive - drag step A between B and C to insert it

---

## Part 3: LLM Intelligence ✅ Complete

### Phase 9A-E: Provider Persistence

**Problem Solved**:
Chat conversations were losing their AI provider context. If you started a chat with Claude then reopened it later, it would use the global default (often a different model) and hit rate limits.

**Solution**:
- Store `providerId` and `model` in each conversation record
- Hybrid lookup: conversation-specific provider → global fallback
- Database migration to add provider columns

**Key Files**:
- `src/lib/database/chat-history.action.ts` - saveConversation stores provider
- `src/hooks/useChatCompletion.ts` - Loads conversation provider
- `src-tauri/src/db/migrations/add-provider-columns.sql` - Schema change

**Model Dropdown with Auto-fetch**:
When configuring a provider, if it has a `/v1/models` endpoint, we fetch available models dynamically. This works with OpenAI, LM Studio, and compatible APIs.

---

## Part 4: Model Switching & Context 🆕 HIGH PRIORITY

**User Goal**: 
Switch between AI models mid-conversation without losing context. Start brainstorming with a cheap model, switch to Claude for the hard part, switch to a local model for privacy.

### The Core Problem

When you switch models in ChatGPT, they just resend the entire conversation to the new model. Problems:
1. **Token waste** - Resend everything on every message
2. **Capability mismatch** - Sending images to a text-only model crashes
3. **Context limits** - Small models can't fit large histories

### Our Design

#### Strategy A: Full Transfer (Default)
- **When**: Target model supports same features + large context
- **Action**: Send entire message history as-is

#### Strategy B: Vision-to-Text Fallback
- **When**: Target model is text-only, history has images
- **Action**: Replace images with placeholder text: "[Image removed: screenshot of React node editor]"

#### Strategy C: Smart Window
- **When**: Target model has small context window
- **Action**: 
  - Keep system prompt
  - Keep last N messages
  - Keep most recent 1-2 images
  - Summarize/drop the middle

### Context Checkpoints (Key Innovation)

**Problem**: Every message resends the ENTIRE history. Wasteful.

**Solution**: When switching models, create a "checkpoint" that summarizes everything before that point. Future messages only send: [checkpoint summary] + [messages after checkpoint].

```typescript
interface ContextCheckpoint {
  id: string;
  createdAt: number;
  fromModel: string;
  toModel: string;
  strategy: 'full' | 'sanitized' | 'distilled';
  summary?: string;  // If distilled
  messageIndex: number;  // Reference point
}
```

### Model Capabilities Lookup

**No Universal API** exists for model capabilities. Our approach:

1. **Hardcoded lookup** for known models:
```typescript
const MODEL_CAPABILITIES = {
  'gpt-4o': { vision: true, contextWindow: 128000 },
  'claude-3-opus': { vision: true, contextWindow: 200000 },
  'llama-3': { vision: false, contextWindow: 8192 },
};
```

2. **User-configured** for custom providers:
- Checkbox: "Supports Vision"
- Input: "Context Window" (tokens)

3. **Heuristic** for unknown: Assume text-only, small context

### Visual Divider on Switch

When model switches, insert a special message in the chat:
```
┌─────────────────────────────────────────┐
│     ─── Model switched ───              │
│     GPT-4 → Claude 3                    │
│     Context: Full transfer              │
└─────────────────────────────────────────┘
```

This is stored as a message with `type: 'model_switch'` metadata.

### Implementation Phases

| Phase | Feature | Status | Notes |
|-------|---------|--------|-------|
| **10A** | In-Chat Model Switcher | ✅ Complete | `ModelSwitcher.tsx` with provider/model dropdown |
| **10A.1** | Visual Divider | ⬜ Not Started | Special message type |
| **10A.2** | Model Capabilities | ✅ Complete | `useModelTester` + model profiles |
| **10B** | Context Sanitization | ⬜ Not Started | Strip images for text models |
| **10C** | Context Checkpoints | ⬜ Not Started | Avoid resending full history |
| **10D** | Handoff Profiles | ⬜ Not Started | "Quick"/"Full"/"Vision" presets |

---

## Part 5: Polish & Branding

### 11A: Strip Pluely Branding ⬜
Remove original author links, GitHub references, etc.

### 11B: Rename to Your Brand ⬜
Change app name, window titles, icons to user's brand.

---

## Key Files Reference

### Frontend (src/)
| File | Purpose |
|------|---------|
| `hooks/useWorkflowRunner.ts` | Executes workflows, handles all step types |
| `hooks/useGlobalShortcuts.ts` | Event listeners for shortcuts |
| `hooks/useChatCompletion.ts` | AI chat logic |
| `hooks/useModelTester.ts` | Automated vision + context window testing |
| `contexts/app.context.tsx` | Global state, workflow sync to shortcuts |
| `pages/workflows/index.tsx` | Workflow editor UI |
| `pages/workflows/components/WorkflowCanvas.tsx` | React Flow graph |
| `pages/workflows/components/WorkflowNode.tsx` | Custom node component |
| `pages/workflows/hooks/useWorkflowGraph.ts` | Steps → nodes/edges |
| `pages/chats/components/ModelSwitcher.tsx` | In-chat provider/model dropdown |
| `pages/context/index.tsx` | Context management dashboard |
| `lib/database/chat-history.action.ts` | Conversation CRUD |
| `lib/storage/model-profiles.storage.ts` | Profile persistence + model mapping |
| `config/model-profiles.constants.ts` | Built-in profiles + pattern matching |
| `types/workflow.ts` | Workflow, Step, Config types |

### Backend (src-tauri/src/)
| File | Purpose |
|------|---------|
| `lib.rs` | Main entry, registers all commands |
| `shortcuts.rs` | Shortcut registration/handling |
| `capture.rs` | Screenshot capture, stitching |
| `input.rs` | Keyboard/mouse injection |
| `db/main.rs` | Database migrations |

---

## Recent Bug Fixes Log

### Dec 17, 2024: Incremental Shortcut Registration

**Symptom**: Pressing trigger key (F1) caused all shortcuts to unregister and re-register visibly.

**Root Cause**: `await_input` step called `update_shortcuts` which does a full rebuild.

**Fix**: Added `register_shortcut` and `unregister_shortcut` Rust commands. Await_input now adds its keys individually.

**Files Changed**:
- `src-tauri/src/shortcuts.rs`
- `src-tauri/src/lib.rs`
- `src/hooks/useWorkflowRunner.ts`

### Dec 15, 2024: Provider Persistence

**Symptom**: Conversations reverted to default provider on reload.

**Root Cause**: Database didn't store per-conversation provider.

**Fix**: Added `providerId` and `model` columns, hybrid lookup logic.

---

## Current Status (As of Jan 9, 2026)

### ✅ Completed
- Engine foundation (Phases 1-5)
- await_input step with sub-workflows
- Incremental shortcut registration
- Visual node editor (basic)
- Provider persistence
- **Phase 10A**: In-Chat Model Switcher (`ModelSwitcher.tsx`)
- **Phase 10A.2**: Model Capabilities with `useModelTester` hook + profiles
- Context Management page for profile CRUD

### 🔜 Next Up
- **Phase 10A.1**: Visual Divider on model switch
- **Phase 10B**: Context Sanitization

### 📋 Backlog
- Phase 7: HUD Overlay
- Phase 8.5-8.7: Node Editor polish
- Phase 10C-D: Context checkpoints + handoff profiles
- Phase 11: Branding

---

## Notes for Next AI

1. **Model Capabilities**: `useModelTester` hook handles automated detection. Vision test uses 1x1 red pixel PNG; context test uses smart breakpoints (4K→8K→32K→128K→200K→1M).
2. **Model Profiles**: Stored in localStorage via `model-profiles.storage.ts`. Pattern matching in `model-profiles.constants.ts` auto-suggests profiles.
3. **Shortcut Registration**: Always prefer incremental (`register_shortcut`/`unregister_shortcut`) over full rebuild (`update_shortcuts`).
4. **Context Switching**: The user prefers "Modify with visual divider" over "Fork to new conversation". Visual divider (Phase 10A.1) is next.
5. **Tree vs Graph**: Tree view for editing, Graph view for visualization.
6. **Styling**: Dark theme with accent colors per step type. See `global.css` for React Flow overrides.
