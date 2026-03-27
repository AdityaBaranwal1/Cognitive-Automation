# Auto-Vision: Strategic Execution Plan
## AI-Assisted Desktop Data-Entry Automation

**Date:** 2026-03-26 | **Version:** 0.1.8 | **Status:** Pre-market analysis

---

## 1. Executive Summary

Auto-Vision is a Tauri v2 desktop application (Rust + React/TypeScript) that combines screen capture, AI vision, keystroke injection, voice transcription, and a visual workflow editor to automate repetitive desktop tasks. The codebase has real desktop primitives that most "AI workflow" tools lack, and occupies a genuinely uncontested market position: **AI-augmented desktop RPA for non-programmers**.

**Verdict: BUILD, with conditions.** Confidence: **72/100**.

The product has legitimate differentiation and a working prototype. However, it cannot ship to paying users until 3 critical security vulnerabilities are fixed, the workflow capability gap between types and runtime is closed, and a minimum test suite exists. The 90-day plan below addresses all blockers in priority order, plus 5 workflow expansions (variables, branching, data sources, sub-workflows, parallel execution) that transform it from a linear step runner into a composable automation engine.

**Target customers:** Solo power users and data-entry teams doing repetitive browser-based form filling.

**Wedge:** "See your screen. Understand your workflow. Automate your desktop." -- visual, AI-assisted desktop RPA with human-in-the-loop checkpoints, targeting browser data-entry as the first killer use case.

---

## 2. Product Thesis (1 Page)

### Who this is for
Operators who spend 2-8 hours/day on repetitive browser-based data entry: copying data from one system to another, filling forms from reference documents, processing queues of records. These are solo power users (bookkeepers, recruiters, researchers) and data-entry teams (BPO, back-office ops, claims processing).

### What painful workflow it solves
Today these users either:
1. **Do it manually** -- tab between windows, read, type, repeat (error-prone, soul-crushing)
2. **Use AutoHotkey/macros** -- requires scripting knowledge, brittle coordinate-based logic, no AI understanding
3. **Use enterprise RPA (UiPath/Blue Prism)** -- $10K+/year, complex setup, requires dedicated RPA developers
4. **Use n8n/Zapier** -- only works with APIs, can't touch desktop or legacy apps without browser extensions

Auto-Vision fills the gap: **visual, AI-powered desktop automation that requires no coding and costs a fraction of enterprise RPA.** The user captures their screen, AI reads and understands the content, then keystrokes/clipboard actions fill the target form. The workflow editor lets them compose these primitives into repeatable sequences with loop/wait/branch logic.

### Why now
1. **Vision LLMs crossed the capability threshold** -- GPT-4o, Claude Sonnet, Gemini Pro can reliably read screenshots, forms, tables, and handwriting. This was not possible 18 months ago.
2. **Enterprise RPA is losing share to AI-native tools** -- Gartner's 2025 RPA MQ shows UiPath/AA declining as "agentic automation" rises. The market is opening for lightweight, AI-first alternatives.
3. **Tauri v2 enables native desktop access from web tech** -- screen capture, input injection, global shortcuts, system audio -- all from a 10MB binary. This was previously only possible in Electron (bloated) or native C++ (slow to develop).
4. **Local-first AI is the trust moat** -- data-entry teams handle sensitive data (PII, financial records, medical). A local-first tool that sends screenshots to the user's own LLM provider (or runs local models via LM Studio) has a compliance advantage over cloud-only RPA.

### Defensibility
- **Integrated capture+AI+injection loop**: No competitor has this end-to-end in a native desktop app with a visual editor
- **Cross-platform native primitives**: Rust backend provides Windows (SendInput), macOS (CoreAudio), Linux (PulseAudio) support
- **Provider-agnostic AI**: Works with any OpenAI-compatible API, not locked to one vendor
- **Local-first architecture**: Workflows never leave the machine unless the user chooses a cloud LLM

---

## 3. Technical Debt Heatmap

### CRITICAL (Must fix before any release)

| File | Risk | Business Impact | Fix |
|------|------|-----------------|-----|
| `tauri.conf.json:34` | **CRITICAL** | CSP is `null` -- any XSS can call Tauri commands (keystroke injection, capture). Remote code execution vector. | Set `"csp": "default-src 'self'; connect-src 'self' https:; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"` |
| `tauri.conf.json:66` | **CRITICAL** | Updater pubkey is `""` -- any MITM can push malicious updates to all users. | Generate signing keypair: `tauri signer generate`, set pubkey. |
| `lib.rs:25` (AudioState.cancel_token) | **CRITICAL** | CancellationToken is one-shot -- once cancelled (line 116 or 222), audio capture is permanently broken until full app restart. Users will think the app is bugged. | Change to `Arc<Mutex<CancellationToken>>`, create fresh token after each cancellation. Or use `child_token()` pattern. |
| `config.context.tsx:567` | **CRITICAL** | `toggleAutostart` calls `invoke("set_always_on_top")` instead of autostart plugin's `enable()`/`disable()`. Autostart toggle actually toggles always-on-top. | Replace with `isEnabled ? await disable() : await enable()` matching the import at line 342-345. |

### HIGH (Fix within 30 days)

| File | Risk | Business Impact | Fix |
|------|------|-----------------|-----|
| `capabilities/default.json:35-39` + `cross-platform.json:35-39` | **HIGH** | HTTP permissions allow ALL URLs (`http://**`, `https://**`). Combined with null CSP, any XSS can exfiltrate data to any server. | Restrict to known API endpoint patterns. |
| `speaker/commands.rs:494-508` | **HIGH** | Audio stop uses `task.abort()` + hardcoded sleep(300ms+200ms). Race between abort and WAV encoding can drop speech events. | Await the JoinHandle. Use oneshot channel for completion signaling. |
| `input.rs:364-389` (send_keypress, send_text) | **HIGH** | Zero rate limiting or authorization on keystroke/text injection Tauri commands. XSS + null CSP = remote keylogging/command execution. | Add rate limiter, require user confirmation for dangerous key combos (Win+R, Ctrl+Alt+Del). |
| `keychain.service.ts:41-53` | **HIGH** | API keys fall back to plaintext localStorage when OS keychain unavailable. | Encrypt fallback or refuse to store. |
| `useCompletion.ts` (1011 lines) | **HIGH** | Single file with 3 duplicate provider resolution paths. Any provider bug must be fixed in 3 places. | Extract `useProviderResolution` hook. Split into state/submit/screenshot modules. |
| `useSystemAudio.ts:214` | **HIGH** | `speech-detected` listener has stale closure on `capturing` state. Events can be silently dropped between state transitions. | Use `useRef` for `capturing` inside the listener callback. |
| `publish.yml:5` | **HIGH** | CI triggers on `master` but default branch is `main`. Pipeline may never fire. Also: zero tests before release build. | Fix branch to `main`. Add `cargo check`, `npx tsc --noEmit`, test steps before build. |

### MEDIUM (Fix within 60 days)

| File | Risk | Business Impact | Fix |
|------|------|-----------------|-----|
| `speaker/windows.rs:133,169` | **MEDIUM** | `lock().unwrap()` panics on poisoned mutex in audio capture thread. Orphans WASAPI handle. | Use `poisoned.into_inner()` pattern per `shortcuts.rs:165`. |
| `useGlobalShortcuts.ts:7-20` | **MEDIUM** | Module-level mutable globals desync on hot-reload/StrictMode. | Move to singleton with explicit init/teardown. |
| `persistent.rs:38-72` | **MEDIUM** | Synchronous `fs::read_to_string`/`fs::write` in async fn blocks tokio thread. | Use `tokio::fs` equivalents. |
| `common.function.ts:172-194` | **MEDIUM** | `deepVariableReplacer` substitutes user values into curl strings with no escaping. Injection risk. | Escape values before substitution, validate JSON structure after. |
| `config.context.tsx` (615 lines) | **MEDIUM** | God object managing 12+ state variables. | Split into ProviderContext, AppSettingsContext, ScreenshotConfigContext. |

### LOW (Fix within 90 days)

| File | Risk | Business Impact | Fix |
|------|------|-----------------|-----|
| `workflow.ts:14` | **LOW** | `[key: string]: any` on BaseStepConfig defeats TypeScript safety for all step configs. | Remove index signature; use discriminated union. |
| `capture.rs` (744 lines) | **LOW** | Over 250-line limit but well-hardened. | Extract stitch logic into separate module. |
| `shortcuts.rs` (716 lines) | **LOW** | Over 250-line limit. | Split into commands/handlers/state modules. |
| `audio.context.tsx` | **LOW** | Uses localStorage only (no persistent.rs push). Other window won't see audio device changes. | Add `save_persistent_data` call + `data-updated` listener. |

---

## 4. Capability Audit: Data-Entry Automation

### Fully Implemented (works end-to-end)

| Capability | Type | Runtime | UI | Backend | Files |
|-----------|------|---------|----|---------|----|
| Region capture | `capture_region` | `useCaptureStep.ts:23-49` | Add button + editor | `capture.rs:560-605` | All layers complete |
| AI vision processing | `ai_process` | `useAIStep.ts:22-169` | Full config editor | HTTP via provider curl | All layers complete |
| Keyboard injection | `keypress` | `useCaptureStep.ts:51-60` | Key picker + modifiers | `input.rs:274-373` | Windows only; macOS/Linux stubs return error |
| Fixed-duration wait | `wait` | `useCaptureStep.ts:62-65` | Duration dropdown | N/A (JS setTimeout) | All layers complete |
| Loop with children | `loop` | `useCaptureStep.ts:67-77` | Iterations + child mgmt | N/A (JS recursion) | All layers complete |
| Await input dispatch | `await_input` | `useCaptureStep.ts:78-182` | Keymap editor | `shortcuts.rs` register/unregister | All layers complete |
| Action notification | `action_notification` | `useWorkflowRunner.ts:94-118` | Output dropdown | clipboard + dashboard | 2 of 5 actions work |
| Image stitching | N/A (AI step option) | `useAIStep.ts:98-112` | Stitch toggle + config | `capture.rs:648-743` | All layers complete |

### Partially Implemented

| Capability | What exists | What's missing | Impact |
|-----------|------------|----------------|--------|
| Fullscreen capture | Backend (`capture.rs:607-633`) + runtime (`useCaptureStep.ts:28-31`) | **No add button in workflow editor UI** (`index.tsx:890-896` lists addable types, `capture_screen` absent) | Users cannot create fullscreen capture steps from the editor. One-line fix. |
| AI temperature/maxTokens | Type fields exist (`workflow.ts:31-32`) | No UI editor for these fields. `useAIStep.ts` never passes them to `fetchAIResponse`. | Users cannot tune AI output quality per step. |
| System action (clipboard) | Runtime handles `copy_to_clipboard` via action_notification path (`useWorkflowRunner.ts:104-109`) | Routed through wrong step type. No dedicated UI. 4 other actions (`save_to_file`, `open_url`, `run_command`, `notification`) are type-only dead code. | Confusing architecture. |

### Type-Only (declared but not implemented)

| Capability | Declared at | Status |
|-----------|------------|--------|
| `system_action` step | `workflow.ts:38-41` | Type exists, runner has vestigial catch-all, no UI, no dedicated runtime |
| `delay` step | `workflow.ts:43-45` | Type exists, zero runtime code. Superseded by `wait`. Dead type. |
| `save_to_file` action | `workflow.ts:39` | Zero implementation anywhere |
| `open_url` action | `workflow.ts:39` | Zero implementation anywhere |
| `run_command` action | `workflow.ts:39` | Zero implementation anywhere |
| `notification` action | `workflow.ts:39` | Zero implementation anywhere |

### Backend Capabilities NOT Exposed to Workflows

| Command | File:Line | What it does | Priority to expose |
|---------|-----------|-------------|-------------------|
| **`send_text`** | `input.rs:380-389` | Types ASCII text character-by-character via SendInput | **P0** -- critical for data entry |
| **`get_modifier_state`** | `input.rs:396-419` | Returns currently pressed modifiers | **P1** -- useful for conditional logic |
| `set_content_protection` | `window.rs:167-175` | Enables screen recording protection | **P2** -- privacy feature |
| All speaker commands | `speaker/commands.rs` | System audio capture + VAD | **P3** -- could enable voice-to-form-fill |

### MISSING for Browser Data-Entry (must build)

| Capability | Priority | Difficulty | Why |
|-----------|----------|------------|-----|
| `send_text` workflow step | **P0** | Easy (backend exists) | Can't fill form fields without typing text |
| Clipboard-paste step | **P0** | Easy (primitives exist) | Faster than character-by-character for non-ASCII |
| Mouse click/move commands | **P1** | Medium (new Rust code for SendInput mouse events) | Can't click form fields, buttons, dropdowns |
| Conditional wait (screen-change detection) | **P1** | Medium (capture + pixel hash comparison) | Fixed waits are unreliable for varying page load times |
| macOS input injection (CGEventPost) | **P1** | Medium (platform-specific Rust) | Cross-platform promise requires macOS keystrokes |
| Linux input injection (xdotool/libxdo) | **P1** | Medium (platform-specific Rust) | Cross-platform promise requires Linux keystrokes |
| Local OCR (Windows OCR API / Tesseract) | **P2** | Medium (new dependency + Rust FFI) | Faster screen reading without API call latency |
| CDP/Playwright browser hooks | **P2** | High (significant new subsystem) | Reliable browser element targeting vs coordinate-based |
| Accessibility tree (UIA/MSAA) | **P3** | High (complex Win32 integration) | Structured form field discovery without vision AI |

---

## 5. Competitor Delta Table

| Dimension | Auto-Vision | OpenClaw | n8n | AutoHotkey |
|-----------|------------|----------|-----|------------|
| **Core purpose** | Desktop AI-assisted data-entry automation | Multi-channel personal AI assistant | Backend workflow automation platform | Windows macro/hotkey scripting |
| **Architecture** | Tauri v2 (Rust + React) native desktop | Node.js WebSocket gateway + extensions | Node.js + Express + Vue 3 server | Native C++ Win32 runtime |
| **AI integration** | Direct multi-provider LLM vision calls | Deep LLM routing (Anthropic/OpenAI OAuth) | LangChain agents, vector stores | None |
| **Screen capture** | Native (region selection, stitching) | Browser CDP snapshots only | None | PixelGetColor only |
| **Voice/audio** | System audio + VAD + STT pipeline | Voice Wake + Talk Mode (ElevenLabs) | None | None |
| **Desktop input injection** | Windows SendInput (keys only, no mouse yet) | macOS system.run only | None | **Deep** -- 4,546-line keyboard_mouse.cpp, 32K hotkeys |
| **Workflow editor** | Visual with capture/AI/keypress/loop/wait | AI-driven /mesh planner | Full DAG with 304+ nodes | Sequential script |
| **Browser automation** | **None** | CDP (Chrome DevTools Protocol) | HTTP/API only | COM-based (IE legacy) |
| **Integration ecosystem** | Provider presets only | 52 skills + 39 extensions | **304 integration nodes** | Community script library |
| **Target user** | Non-technical operators doing data entry | Tech-savvy assistant users | DevOps/marketing ops teams | Windows power scripters |
| **License** | Proprietary | MIT | Sustainable Use + Enterprise | GPL v2 |
| **Maturity** | Early alpha (v0.1.8, significant tech debt) | Production (v2026.2.16) | Production (v2.0.0, funded) | Decades (v2 alpha, v1 stable) |
| **Desktop overlay** | Yes (transparent, content-protected, always-on-top) | macOS menu bar | No (web UI) | No (systray scripts) |
| **Cross-platform** | Win (full), macOS (partial), Linux (partial) | macOS/Linux/Win | Server-agnostic | Windows only |
| **Local-first** | Yes | Yes | Self-hosted or cloud | Yes |

### Overlap Analysis
- **vs OpenClaw**: Minimal overlap. OpenClaw is messaging-first. Would need full rebuild to match desktop capture+injection. **Risk: Low.**
- **vs n8n**: Zero desktop overlap. n8n is server-side. Potential **partner** (Auto-Vision as desktop execution node for n8n workflows). **Risk: None. Opportunity: High.**
- **vs AutoHotkey**: Highest overlap in hotkeys + input injection. AHK has deeper Win32 primitives but zero AI. **Risk: Medium** (power users could script AHK + LLM API calls). **Moat: Integrated vision+capture+AI loop, no-code editor.**

### Positioning
Auto-Vision should position as: **"The AI-powered AutoHotkey for non-programmers"** -- same desktop automation power, but with vision AI making decisions instead of hand-written scripts, and a visual editor instead of a scripting language.

---

## 6. Critical Path Roadmap

### Phase 1: Ship-Safe Foundation (Days 0-30)

**Theme: "Make it safe to use and reliable to demo."**

| # | Task | Acceptance Criteria | Key Files |
|---|------|-------------------|-----------|
| 1 | Fix CSP (null -> restrictive) | `tauri.conf.json:34` has a real CSP. XSS cannot call Tauri commands. Manual XSS test fails. | `tauri.conf.json` |
| 2 | Fix updater pubkey | `tauri.conf.json:66` has a real pubkey. `tauri signer verify` passes on test artifact. | `tauri.conf.json`, CI secrets |
| 3 | Scope HTTP permissions | Capabilities files list specific API domains, not `**`. Test: fetch to arbitrary URL fails. | `capabilities/*.json` |
| 4 | Fix CancellationToken lifecycle | Audio capture works after F5 reload. Automated test: start capture -> reload -> start capture -> audio arrives. | `lib.rs:21-26`, `speaker/commands.rs` |
| 5 | Fix autostart toggle | Toggle autostart ON -> app appears in OS startup list. Toggle OFF -> removed. | `config.context.tsx:567` |
| 6 | Add `send_text` workflow step | New step type in editor. User can: add send_text step, configure text (static or `{{prev}}`), execute workflow, text appears in target field. | `workflow.ts`, `useCaptureStep.ts`, `index.tsx`, workflow editor |
| 7 | Add clipboard-paste step | New step: write to clipboard + send Ctrl+V. User can paste AI output into form fields. | Same as above + new composed step |
| 8 | Fix CI pipeline | `publish.yml` triggers on `main`. Pipeline runs `cargo check`, `npx tsc --noEmit`, and Vitest suite before build. | `publish.yml` |
| 9 | Add Vitest + first test suite | `npm test` runs. Minimum: workflow step dispatch, provider resolution, variable interpolation, input sanitization. | `package.json`, `vitest.config.ts`, `src/**/*.test.ts` |
| 10 | Add `capture_screen` to editor | Add button appears in workflow step picker. Users can create fullscreen capture steps. | `index.tsx:890` (one-line fix) |

**Exit criteria:** All 10 items pass. Demo video: user creates workflow that captures browser form, AI reads it, types response into another field.

### Phase 2: Data-Entry MVP + Workflow Expansion Foundation (Days 31-60)

**Theme: "Make browser data-entry actually work end-to-end, with smart workflows."**

| # | Task | Acceptance Criteria | Key Files |
|---|------|-------------------|-----------|
| 11 | Add mouse click/move commands | New Rust commands: `send_mouse_click(x, y)`, `send_mouse_move(x, y)`. Workflow step: click a coordinate. | `input.rs` (new mouse module) |
| 12 | Conditional wait (screen-change) | New step: capture region, compare pixel hash to reference, continue when different. Timeout fallback. | New step type + `capture.rs` hash comparison |
| 13 | macOS input injection | `send_keypress` and `send_text` work on macOS via CGEventPost. | `input.rs` new `#[cfg(target_os = "macos")]` module |
| 14 | Linux input injection | `send_keypress` and `send_text` work on Linux via xdotool/libxdo. | `input.rs` new `#[cfg(target_os = "linux")]` module |
| 15 | Implement `system_action` step | Full runtime for save_to_file, open_url, run_command (sandboxed), notification. UI editor. | `useWorkflowRunner.ts`, `workflow.ts`, editor |
| 16 | Clean dead types | Remove `delay` (superseded by `wait`). Remove `BaseStepConfig` index signature. | `workflow.ts` |
| 17 | Split oversized hooks | `useCompletion.ts` -> 3 modules. `useSystemAudio.ts` -> 3 modules. Extract shared `useProviderResolution`. | `src/hooks/` |
| 18 | Add rate limiting to input injection | Max 100 keystrokes/sec, user-visible indicator, confirmation for dangerous combos. | `input.rs`, new frontend indicator |
| 19 | Integration test suite | Tests for: workflow execution pipeline (mock AI), cross-window data sync, audio lifecycle. | `src/**/*.integration.test.ts` |
| 20 | Workflow import/export with validation | Import validates step types, warns about keystroke injection, rejects unknown actions. | New validation layer |
| **21** | **Variable system (Expansion 1)** | `set_variable` + `transform` steps work. `{{var.name}}` interpolation works in all text fields. JSON parse, regex extract, field access all functional. | `workflow.ts`, `useWorkflowState.ts`, `useCaptureStep.ts`, `index.tsx` |
| **22** | **Data source steps (Expansion 3)** | CSV, clipboard read, HTTP GET, static list. New Rust `data.rs` module. `for_each` loop mode iterates over data arrays. Native file picker. | New `data.rs`, `workflow.ts`, `useCaptureStep.ts`, `index.tsx` |
| **23** | **Conditional branching -- types + runtime (Expansion 2, part 1)** | `conditional` step evaluates branches top-to-bottom. Operators: contains, equals, regex_match, is_empty, ai_decides. Default/else branch. Children execute correctly. | `workflow.ts`, `useCaptureStep.ts` |

**Exit criteria:** All 23 items pass. E2E demo: user loads CSV of customer records -> loops through rows -> AI reads current form state -> conditional branches on status -> fills appropriate fields -> submits. Variable debug panel shows live values during execution.

### Phase 3: Production Readiness + Advanced Workflows (Days 61-90)

**Theme: "Make it reliable enough to charge money for, with composable workflow power."**

| # | Task | Acceptance Criteria | Key Files |
|---|------|-------------------|-----------|
| 24 | Local OCR (Windows OCR API) | New Rust command: `ocr_region(x, y, w, h) -> String`. Workflow step: read text from screen region without API call. | New `ocr.rs` module |
| 25 | Workflow templates library | 5+ pre-built templates for common data-entry workflows (form fill, copy-paste between tabs, list processing). Templates use variables and conditionals. | New template storage + UI |
| 26 | Error recovery in workflows | Steps can define retry count, fallback action, and error handling. Workflow doesn't silently fail. | `useWorkflowRunner.ts`, `workflow.ts` |
| 27 | Encrypt localStorage fallback | API keys in localStorage are encrypted with a derived key, not plaintext. | `keychain.service.ts` |
| 28 | E2E desktop flow tests | Playwright/WebDriver tests for: workflow creation, execution (including variable/branch/data source flows), multi-window sync. | `.github/workflows/test.yml` |
| 29 | Canary release channel | Two-track releases: canary (auto-publish) and stable (manual promote). Users can opt into canary. | `publish.yml`, new update channel logic |
| 30 | Usage analytics + error reporting | PostHog events for workflow execution success/failure/duration. Opt-in crash reporting. | New analytics module |
| 31 | Onboarding wizard | First-run experience: configure provider, test connection, run sample workflow using variables + data source. | New onboarding page |
| 32 | Documentation site | Getting started, workflow builder guide, variable/branching reference, provider setup. | Separate repo or `/docs` |
| 33 | Security audit (external) | Penetration test of Tauri IPC, input injection, data source file access, and update system. | External engagement |
| **34** | **Conditional branching -- graph UI (Expansion 2, part 2)** | Diamond nodes in graph view. Branch edges fan out with labels. Branch-local child management in editor sidebar. | `useWorkflowGraph.ts`, `index.tsx`, `StepEditorSidebar.tsx` |
| **35** | **Call Workflow step (Expansion 4)** | First-class sub-workflow calls with parameter passing, return values, context isolation. Cycle detection at save-time and run-time. | `workflow.ts`, `useCaptureStep.ts`, `useWorkflowState.ts`, `workflow.context.tsx` |
| **36** | **Parallel execution (Expansion 5)** | Promise.all on branch groups. Context isolation per branch. Input injection blocked in parallel branches. fail_fast and wait_all modes. Fork/join graph visualization. | `workflow.ts`, `useCaptureStep.ts`, `useWorkflowState.ts`, `useWorkflowGraph.ts` |

**Exit criteria:** All 36 items pass. E2E demo: user loads CSV -> for_each row -> conditional routing based on AI analysis -> parallel branches (capture + lookup) -> sub-workflow "Fill Form" called with parameters -> submit. Product listed with pricing. First 10 beta users onboarded.

---

## 6B. Workflow Expansion: Advanced Capabilities

The 5 expansions below build on the existing execution model. The current architecture has a critical
design feature that enables these: **`context.variables: Record<string, any>` already exists in
`ExecutionContext` (useWorkflowState.ts:19) but is completely unused.** This becomes the foundation
for variables, branching, data sources, and sub-workflow parameters.

### Dependency Order
Variables (foundation) -> Branching + Data Sources (use variables) -> Sub-Workflows (use variables + branching) -> Parallel Execution (requires context isolation from sub-workflows)

---

### Expansion 1: Variable Management & Data Transformation
**Phase: 2 (Days 31-60) | Priority: P0 -- everything else depends on this**

**Why this is first:** The current `{{prev}}`/`{{step[N]}}` system is fragile -- inserting a step
shifts all indices. Named variables make workflows maintainable. And branching, data sources, and
sub-workflows all need somewhere to read/write structured data.

**Current state:**
- `context.variables: Record<string, any>` exists at `useWorkflowState.ts:19` but is never written or read
- `interpolateVariables()` at `useWorkflowState.ts:54-68` only handles `{{prev}}` and `{{step[N]}}`
- All step outputs are strings in `stepOutputs[]`

**New types (add to `workflow.ts`):**

```typescript
// New StepType additions: "set_variable" | "transform"
export type StepType = "capture_screen" | "ai_process" | "system_action" |
  "capture_region" | "action_notification" | "keypress" | "wait" | "loop" |
  "await_input" | "set_variable" | "transform";

export interface SetVariableStepConfig extends BaseStepConfig {
  variableName: string;           // e.g. "customer_name"
  source: "static" | "prev" | "step_index" | "expression";
  value?: string;                 // static value or template string with {{}} refs
  stepIndex?: number;             // if source is "step_index"
}

export interface TransformStepConfig extends BaseStepConfig {
  input: string;                  // template string, e.g. "{{var.raw_data}}"
  operation: "json_parse" | "json_field" | "regex_extract" | "split_lines" |
             "trim" | "replace" | "to_upper" | "to_lower" | "template";
  fieldPath?: string;             // for json_field: "data.rows[0].name"
  pattern?: string;               // for regex_extract/replace
  replacement?: string;           // for replace
  template?: string;              // for template: "Hello {{var.name}}"
  outputVariable: string;         // variable name to store result
}
```

**Runtime changes (useCaptureStep.ts):**

```
set_variable handler:
  1. Resolve source value (static, prev, step_index, or interpolate expression)
  2. Write to context.variables[config.variableName]
  3. Push "[Variable set: customer_name]" to stepOutputs

transform handler:
  1. Resolve input via extended interpolateVariables (supports {{var.name}})
  2. Apply operation (JSON.parse, regex match, split, etc.)
  3. Write result to context.variables[config.outputVariable]
  4. Push "[Transform: json_field -> order_id]" to stepOutputs
```

**Extend `interpolateVariables` (useWorkflowState.ts:54-68):**

```
Add {{var.name}} pattern:
  /\{\{var\.([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g -> context.variables[name]

Add {{var.name.nested.path}} support:
  Dot-path resolution into nested objects (for JSON-parsed data)
```

**UI changes (workflow editor):**
- New "Set Variable" button in step picker
- New "Transform" button in step picker
- Set Variable editor: name input + source dropdown + value input with template helper
- Transform editor: input field + operation dropdown + operation-specific fields + output variable name
- Variable name autocomplete across all step editors (scan workflow for existing `set_variable` steps)

**Files to modify:**
| File | Change |
|------|--------|
| `src/types/workflow.ts` | Add `set_variable`, `transform` to StepType union. Add config interfaces. |
| `src/hooks/workflow/useWorkflowState.ts:54-68` | Extend `interpolateVariables` with `{{var.name}}` support |
| `src/hooks/workflow/useCaptureStep.ts` | Add `set_variable` and `transform` handlers |
| `src/pages/workflows/index.tsx` | Add buttons + editor panels |
| `src/pages/workflows/components/StepEditorSidebar.tsx` | Add sidebar editors |
| `src/pages/workflows/hooks/useWorkflowGraph.ts` | Add node icons/colors for new types |

**Acceptance criteria:**
- User can set a variable from AI output: capture screen -> AI reads it -> set_variable "name" from prev
- User can parse JSON: AI returns JSON -> transform json_parse -> transform json_field "data.email" -> use {{var.email}} in send_text step
- User can regex-extract: AI response -> transform regex_extract with pattern -> use in next step
- `{{var.name}}` works in ALL text fields: AI prompts, send_text value, set_variable expressions
- Variables persist across loop iterations (same context)
- Variables display in a debug panel during execution

---

### Expansion 2: Branching / Conditional Logic
**Phase: 2-3 (Days 45-75) | Priority: P1 -- requires variables (Expansion 1)**

**Why:** Data-entry workflows need decisions: "if the form says 'approved', fill the next field; if 'rejected', click the reject button." The current flat array model can't express this.

**Design decision:** Follow the `loop` pattern -- a `"conditional"` step type with children arrays, NOT a DAG rewrite. This keeps the execution model as a recursive tree traversal (which already works for `loop` and `await_input`), avoids rewriting the graph visualization, and keeps the JSON serialization simple.

**Current state:**
- Execution is a flat `for` loop over `steps[]` (`useWorkflowRunner.ts:71`)
- `loop` already demonstrates the children pattern (`workflow.ts:59-62`, `useCaptureStep.ts:67-77`)
- Graph visualization (`useWorkflowGraph.ts:37`) assumes linear chain

**New types (add to `workflow.ts`):**

```typescript
// Add "conditional" to StepType union
export type ConditionOperator = "contains" | "not_contains" | "equals" |
  "not_equals" | "regex_match" | "starts_with" | "ends_with" |
  "is_empty" | "is_not_empty" | "greater_than" | "less_than" | "ai_decides";

export interface ConditionalBranch {
  id: string;
  label: string;                    // "If approved", "If rejected", "Otherwise"
  condition: {
    operator: ConditionOperator;
    operand: string;                // Template string: "{{prev}}", "{{var.status}}"
    value?: string;                 // Comparison value (not needed for is_empty, ai_decides)
    aiPrompt?: string;              // If operator is "ai_decides": prompt for yes/no decision
  };
  children: WorkflowStep[];        // Steps to execute if condition matches
}

export interface ConditionalStepConfig extends BaseStepConfig {
  branches: ConditionalBranch[];   // Evaluated top-to-bottom, first match wins
  defaultBranch?: {                // "else" -- runs if no branch matches
    children: WorkflowStep[];
  };
}
```

**Runtime (add to useCaptureStep.ts):**

```
conditional handler:
  1. For each branch in config.branches (top to bottom):
     a. Resolve operand via interpolateVariables (supports {{prev}}, {{var.name}})
     b. Evaluate condition:
        - contains: operand.includes(value)
        - regex_match: new RegExp(value).test(operand)
        - ai_decides: send aiPrompt to current provider, parse yes/no
        - (etc. for each operator)
     c. If match: execute branch.children sequentially via executeStepFn, then break
  2. If no branch matched and defaultBranch exists: execute defaultBranch.children
  3. Push "[Conditional: ran branch 'If approved']" or "[Conditional: ran default]" to stepOutputs
```

**UI changes:**
- New "Conditional" button in step picker (with branch icon)
- Conditional editor panel:
  - List of branches with drag-to-reorder
  - Each branch: label input, condition builder (operand field + operator dropdown + value field)
  - "Add Branch" button
  - "Default (else)" toggle at bottom
  - Each branch has its own child step list (same as loop children UI)
- Graph visualization: conditional node renders as diamond with branch edges fanning out

**Graph visualization changes (useWorkflowGraph.ts):**
- `stepsToEdges()` must handle conditional: create edges from conditional node to first child of each branch, and from last child of each branch back to the next step after the conditional
- Node shape: diamond (conditional), rectangle (normal), loop icon (loop)

**Files to modify:**
| File | Change |
|------|--------|
| `src/types/workflow.ts` | Add `conditional` to StepType. Add ConditionalBranch, ConditionalStepConfig interfaces. |
| `src/hooks/workflow/useCaptureStep.ts` | Add conditional handler with branch evaluation |
| `src/pages/workflows/index.tsx` | Add button + branch editor UI |
| `src/pages/workflows/components/StepEditorSidebar.tsx` | Add conditional sidebar |
| `src/pages/workflows/hooks/useWorkflowGraph.ts` | Handle diamond node + branch edges |

**Acceptance criteria:**
- User creates: capture -> AI reads status -> conditional (if "approved" -> fill form A; if "rejected" -> click reject button; else -> flag for review)
- `ai_decides` operator works: sends screenshot + prompt to LLM, gets yes/no, routes accordingly
- Branches can contain any step type including nested conditionals and loops
- Graph view shows diamond node with branch labels
- Step indices work correctly: `{{step[N]}}` refers to global execution order, not branch-local

---

### Expansion 3: Data Source Steps
**Phase: 2-3 (Days 50-80) | Priority: P1 -- requires variables (Expansion 1)**

**Why:** Data-entry users need to fill forms FROM data -- CSV exports, spreadsheets, JSON APIs. Without data source steps, users must manually copy data then have AI read their screen. With data sources, the workflow can iterate over rows directly.

**Current state:**
- No file I/O in the workflow system
- Rust backend has no file-read commands exposed to workflows
- `navigator.clipboard.readText()` exists in browser APIs but isn't used in workflows
- `loop` step has fixed iteration count (`LoopStepConfig.iterations: number`)

**New Rust commands (add to a new `data.rs` module in src-tauri/src/):**

```rust
#[tauri::command]
async fn read_file_text(path: String) -> Result<String, String>
// Reads entire file as UTF-8 text. Path validated against app data dir.

#[tauri::command]
async fn read_csv_rows(path: String) -> Result<Vec<Vec<String>>, String>
// Parses CSV with headers. Returns array of rows (each row is array of strings).
// First row treated as headers.

#[tauri::command]
async fn pick_file(filters: Vec<FileFilter>) -> Result<String, String>
// Opens native file picker dialog. Returns selected path.
```

**New types (add to `workflow.ts`):**

```typescript
// Add "data_source" to StepType union
export type DataSourceType = "csv_file" | "json_file" | "clipboard_read" |
  "static_list" | "http_get";

export interface DataSourceStepConfig extends BaseStepConfig {
  sourceType: DataSourceType;
  filePath?: string;              // For csv_file, json_file (can use {{var.path}})
  url?: string;                   // For http_get
  staticData?: string;            // For static_list (one item per line)
  outputVariable: string;         // Variable name to store the data
  outputFormat: "raw" | "rows";   // "raw" = single string, "rows" = array for iteration
}
```

**Extend loop step for data iteration:**

```typescript
// Extend LoopStepConfig
export interface LoopStepConfig extends BaseStepConfig {
  mode: "count" | "for_each";     // NEW: "count" = current behavior, "for_each" = iterate data
  iterations?: number;            // For mode: "count"
  dataVariable?: string;          // For mode: "for_each" -- variable name containing array
  itemVariable?: string;          // For mode: "for_each" -- variable name for current item
  indexVariable?: string;         // For mode: "for_each" -- variable name for current index
  children: WorkflowStep[];
}
```

**Runtime changes:**

```
data_source handler (useCaptureStep.ts):
  csv_file:
    1. Invoke Rust `read_csv_rows(path)` -> get rows array
    2. Store as context.variables[outputVariable] = { headers: [...], rows: [[...], ...] }
    3. Push "[Data: loaded 150 rows from customers.csv]" to stepOutputs

  clipboard_read:
    1. navigator.clipboard.readText()
    2. Store in context.variables[outputVariable]
    3. Push "[Data: read clipboard (234 chars)]"

  http_get:
    1. fetch(url) with timeout
    2. Store response text in context.variables[outputVariable]
    3. Push "[Data: fetched from URL (1.2KB)]"

  static_list:
    1. Split staticData by newlines
    2. Store as array in context.variables[outputVariable]

Loop handler extension (useCaptureStep.ts:67-77):
  if mode === "for_each":
    1. Resolve context.variables[dataVariable] (must be array)
    2. For each item in array:
       a. Set context.variables[itemVariable] = current item
       b. Set context.variables[indexVariable] = current index
       c. Execute children
    (replaces the fixed iterations loop)
```

**UI changes:**
- New "Data Source" button in step picker (with database icon)
- Data source editor: source type dropdown, file path input with "Browse" button (triggers `pick_file`), output variable name
- Loop editor: new "Mode" toggle (Count / For Each). For Each mode shows: data variable selector, item variable name, index variable name
- Variable preview panel: show first 3 rows of loaded data during execution

**Files to modify:**
| File | Change |
|------|--------|
| `src-tauri/src/data.rs` | NEW: `read_file_text`, `read_csv_rows`, `pick_file` commands |
| `src-tauri/src/lib.rs` | Register new data commands |
| `src/types/workflow.ts` | Add `data_source` to StepType. Add DataSourceStepConfig. Extend LoopStepConfig with `mode`/`for_each`. |
| `src/hooks/workflow/useCaptureStep.ts` | Add data_source handler. Extend loop handler for for_each mode. |
| `src/pages/workflows/index.tsx` | Add button + data source editor + loop mode toggle |

**Acceptance criteria:**
- User loads a CSV of customer records -> loops through rows -> for each row, fills a browser form with {{var.row.name}}, {{var.row.email}} -> submits
- User reads clipboard -> parses as JSON -> extracts field -> uses in AI prompt
- User fetches from HTTP endpoint -> transforms response -> iterates over results
- File picker opens native OS dialog and returns path
- Loop "for each" correctly iterates over data array, `{{var.item}}` and `{{var.index}}` accessible in children
- Backward compatible: existing `loop` steps with fixed `iterations` still work (default `mode: "count"`)

---

### Expansion 4: Sub-Workflow Composition
**Phase: 3 (Days 65-85) | Priority: P1 -- requires variables (Expansion 1)**

**Why:** As workflows grow, users need reusable building blocks. "Fill this form" should be a callable sub-workflow used by multiple parent workflows. The current `await_input` -> `run_workflow` path requires a human keypress to trigger and shares context with no isolation.

**Current state:**
- Sub-workflows only triggered via `await_input` key action (`useCaptureStep.ts:145-151`)
- Requires human keypress -- cannot be called programmatically
- Shares the same `ExecutionContext` object (no isolation, index pollution)
- No parameter passing, no return value

**New types (add to `workflow.ts`):**

```typescript
// Add "call_workflow" to StepType union
export interface CallWorkflowStepConfig extends BaseStepConfig {
  workflowId: string;                    // ID of the workflow to call
  parameters?: Record<string, string>;   // Key: param name in sub-workflow, Value: template string
  returnVariable?: string;               // Variable name to store sub-workflow's last output
  isolateContext: boolean;               // If true, sub-workflow gets its own stepOutputs/captures
}
```

**Runtime (add to useCaptureStep.ts):**

```
call_workflow handler:
  1. Find workflow by ID: workflows.find(w => w.id === config.workflowId)
  2. Create sub-context:
     if isolateContext:
       subContext = createExecutionContext()
       subContext.variables = { ...context.variables, ...resolvedParameters }
     else:
       subContext = context  (current behavior, backward compatible)
       Object.assign(subContext.variables, resolvedParameters)

  3. Execute sub-workflow steps sequentially via executeStepFn
  4. After completion:
     if config.returnVariable:
       context.variables[config.returnVariable] = subContext.stepOutputs[subContext.stepOutputs.length - 1]
     Push "[Sub-workflow: 'Fill Customer Form' completed]" to parent stepOutputs

  5. If sub-workflow errors, propagate to parent (or handle per error recovery settings from Phase 3 #23)
```

**UI changes:**
- New "Call Workflow" button in step picker (with link/chain icon)
- Editor panel: workflow selector dropdown (list all other workflows), parameter mapping table (param name -> template value), return variable name, "Isolate context" checkbox
- Visual indicator in graph: sub-workflow node shows a mini-preview of the called workflow's steps

**Cycle detection:**
- Before execution, walk the workflow graph: if workflow A calls B calls C calls A, reject with error
- Implement as depth-first traversal with visited set
- Check at both save-time and run-time

**Files to modify:**
| File | Change |
|------|--------|
| `src/types/workflow.ts` | Add `call_workflow` to StepType. Add CallWorkflowStepConfig. |
| `src/hooks/workflow/useWorkflowState.ts` | Export `createExecutionContext()` for sub-workflow isolation |
| `src/hooks/workflow/useCaptureStep.ts` | Add call_workflow handler with context isolation and parameter passing |
| `src/pages/workflows/index.tsx` | Add button + workflow selector + parameter mapping UI |
| `src/contexts/workflow.context.tsx` | Add cycle detection utility |

**Acceptance criteria:**
- User creates "Fill Form" sub-workflow with parameters (name, email, phone)
- Parent workflow: load CSV -> loop for_each row -> call_workflow "Fill Form" with {{var.row.name}}, {{var.row.email}}, {{var.row.phone}}
- Sub-workflow receives parameters as variables, fills the browser form
- Isolated context: sub-workflow's stepOutputs don't pollute parent's `{{step[N]}}` references
- Return variable: parent can read the sub-workflow's final output
- Cycle detection: creating A -> B -> A shows error in editor and prevents execution

---

### Expansion 5: Parallel Step Execution
**Phase: 3 (Days 75-90) | Priority: P2 -- requires context isolation from Expansion 4**

**Why:** Some data-entry tasks have independent branches: "while filling form A, simultaneously look up the customer in system B." Also useful for performance: "capture 3 different screen regions at the same time."

**Current state:**
- Execution is strictly sequential (`useWorkflowRunner.ts:71`: `for` loop)
- `WorkflowExecution.activeStepId` is singular (one active step at a time)
- `context` is a shared mutable object -- concurrent writes to `stepOutputs` and `captures` would race

**Design constraint:** Parallel execution MUST use isolated contexts per branch (reusing the isolation mechanism from Expansion 4), then merge results after all branches complete. This avoids race conditions on the shared `context`.

**New types (add to `workflow.ts`):**

```typescript
// Add "parallel" to StepType union
export interface ParallelBranch {
  id: string;
  label: string;                    // "Lookup customer", "Fill form section A"
  children: WorkflowStep[];
  outputVariable?: string;          // Variable to store this branch's last output
}

export interface ParallelStepConfig extends BaseStepConfig {
  branches: ParallelBranch[];
  failureMode: "fail_fast" | "wait_all";  // fail_fast: cancel all on first error
                                            // wait_all: collect all results, report errors
}
```

**Runtime (add to useCaptureStep.ts):**

```
parallel handler:
  1. For each branch, create an isolated sub-context:
     branchContext = createExecutionContext()
     branchContext.variables = { ...context.variables }  // snapshot parent variables

  2. Execute all branches concurrently:
     results = await Promise.all(branches.map(async (branch) => {
       for (const step of branch.children) {
         if (context.shouldStop) break;
         await executeStepFn(step, branchContext, ...);
       }
       return branchContext;
     }))

     (with fail_fast: wrap in Promise.allSettled, cancel others on first reject)

  3. Merge results back to parent context:
     For each branch with outputVariable:
       context.variables[branch.outputVariable] = branchContext.stepOutputs.at(-1)
     Concatenate all branch captures to parent context.captures

  4. Push "[Parallel: 3 branches completed (2 succeeded, 1 failed)]" to stepOutputs
```

**Progress tracking extension:**
- `WorkflowExecution` needs to support multiple active steps:
  ```typescript
  // Extend WorkflowExecution
  activeSteps?: { stepId: string; stepType: StepType; branchLabel: string }[];
  ```
- UI progress bar shows parallel indicator (stacked bars or spinner per branch)

**Safety constraints:**
- Input injection steps (`keypress`, `send_text`, `mouse_click`) should NOT run in parallel
  -- OS-level input goes to the focused window, parallel keystrokes would interleave
- Add validation: if any branch contains input injection steps, warn at save-time, block at run-time
  unless user explicitly overrides with `allowParallelInput: true`
- Capture steps CAN run in parallel (different screen regions)
- AI steps CAN run in parallel (independent HTTP calls)

**Files to modify:**
| File | Change |
|------|--------|
| `src/types/workflow.ts` | Add `parallel` to StepType. Add ParallelBranch, ParallelStepConfig. Extend WorkflowExecution. |
| `src/hooks/workflow/useWorkflowState.ts` | Add context snapshot/merge utilities |
| `src/hooks/workflow/useCaptureStep.ts` | Add parallel handler with Promise.all and context isolation |
| `src/pages/workflows/index.tsx` | Add button + parallel branch editor UI |
| `src/pages/workflows/hooks/useWorkflowGraph.ts` | Render parallel tracks (fork/join visualization) |
| Validation layer | Block parallel input injection steps |

**Acceptance criteria:**
- User creates parallel step with 2 branches: (A) capture region + AI read, (B) capture different region + AI read
- Both branches execute simultaneously (visible in progress UI)
- Results from both branches available as variables in subsequent steps
- fail_fast mode: if branch A errors, branch B is cancelled within 1 second
- Safety: workflow with parallel keypress steps shows warning and blocks execution
- Graph view: parallel node shows fork/join visualization with branch labels

---

### Updated Roadmap Integration

These expansions slot into the existing 90-day plan as follows:

| Day | Phase | Expansion Work | Dependencies |
|-----|-------|---------------|--------------|
| 31-40 | Phase 2 | **Expansion 1: Variables** -- extend interpolateVariables, add set_variable + transform steps, wire UI | Phase 1 complete (especially Vitest) |
| 41-50 | Phase 2 | Test + stabilize variables. Begin **Expansion 2: Branching** -- types, conditional handler, basic UI | Expansion 1 complete |
| 50-60 | Phase 2 | **Expansion 3: Data Sources** -- Rust data.rs, csv/clipboard/http handlers, extend loop for_each | Expansion 1 complete |
| 60-70 | Phase 3 | Complete branching UI (graph visualization for diamonds). Begin **Expansion 4: Sub-Workflows** | Expansions 1-2 complete |
| 70-80 | Phase 3 | Complete sub-workflows (parameter passing, isolation, cycle detection) | Expansion 1 complete |
| 80-90 | Phase 3 | **Expansion 5: Parallel Execution** -- context isolation, Promise.all, safety validation | Expansion 4 complete (context isolation) |

### New GitHub Issues to Add (11-15)

**Issue 11: `[FEATURE] Variable system: set_variable + transform steps + {{var.name}} interpolation`**
**Why:** Foundation for branching, data sources, and sub-workflows. Current `{{step[N]}}` system is fragile.
**Files:** `workflow.ts`, `useWorkflowState.ts:54-68`, `useCaptureStep.ts`, `index.tsx`
**DoD:** User can set named variables from AI output, parse JSON, extract fields, use `{{var.name}}` in any text field.

**Issue 12: `[FEATURE] Conditional branching step with if/else logic`**
**Why:** Data-entry workflows need decisions: route based on AI output, form state, or variable values.
**Files:** `workflow.ts`, `useCaptureStep.ts`, `index.tsx`, `useWorkflowGraph.ts`
**DoD:** User creates conditional with 2+ branches, each branch executes its children. `ai_decides` operator works.

**Issue 13: `[FEATURE] Data source steps: CSV, clipboard, HTTP, static list`**
**Why:** Users need to fill forms FROM data. CSV import + for-each loop is the core data-entry batch workflow.
**Files:** New `src-tauri/src/data.rs`, `lib.rs`, `workflow.ts`, `useCaptureStep.ts`, `index.tsx`
**DoD:** User loads CSV -> loops rows -> fills form per row. File picker works on all platforms.

**Issue 14: `[FEATURE] Call Workflow step with parameters and context isolation`**
**Why:** Reusable building blocks. "Fill this form" should be callable from any parent workflow.
**Files:** `workflow.ts`, `useCaptureStep.ts`, `useWorkflowState.ts`, `index.tsx`, `workflow.context.tsx`
**DoD:** Parent passes parameters, sub-workflow uses them as variables, return value flows back. Cycle detection works.

**Issue 15: `[FEATURE] Parallel step execution with context isolation`**
**Why:** Performance (parallel captures/AI calls) and independent branches (lookup + fill simultaneously).
**Files:** `workflow.ts`, `useCaptureStep.ts`, `useWorkflowState.ts`, `index.tsx`, `useWorkflowGraph.ts`
**DoD:** 2+ branches run simultaneously. Input injection blocked in parallel. fail_fast cancels sibling branches.

---

## 7. Build vs Stop Verdict

### Verdict: **BUILD** | Confidence: **72/100**

### Why Build
1. **Genuine market gap**: No tool combines visual AI + desktop input injection + no-code workflow editor in a native desktop app. OpenClaw, n8n, and AutoHotkey each solve adjacent problems but not this one.
2. **Working prototype**: The core capture -> AI -> inject loop works on Windows today. This is not a paper design.
3. **Vision LLMs are good enough**: GPT-4o/Claude can reliably read forms, tables, and handwritten text from screenshots. The AI capability is no longer the bottleneck.
4. **Small team can ship**: Tauri's single-codebase approach (Rust + React) means one developer can iterate on both backend and frontend. The existing architecture is sound at its core.
5. **Local-first is a moat**: Data-entry teams handle sensitive data. "Your data never leaves your machine" is a real selling point against cloud RPA.

### Why Not 100% Confidence
1. **Security posture is ship-blocking**: CSP null, empty updater pubkey, unrestricted HTTP permissions. A security incident before product-market fit would be fatal.
2. **Type-runtime gap erodes trust**: When declared capabilities don't work, early users will assume the whole product is broken. Must close before beta.
3. **Cross-platform is expensive**: Input injection is Windows-only today. macOS/Linux support requires significant platform-specific Rust code. Consider Windows-first despite the stated cross-platform goal.
4. **No test suite**: Shipping an automation tool (which injects keystrokes into other apps) without tests is high-risk. A bad release could type garbage into a user's production system.
5. **Solo developer risk**: The codebase shows signs of single-developer development (no code review, no CI tests, inconsistent patterns). Adding one more engineer would de-risk significantly.

### Top 5 Assumptions Requiring Validation
1. **Solo power users will pay $10-30/month** for AI-assisted data-entry automation (vs free AutoHotkey + manual LLM calls)
2. **Vision LLM accuracy is sufficient** for production data-entry without human review of every field
3. **OS-level input injection (SendInput) is reliable enough** for browser form filling vs CDP/Playwright approach
4. **Users will configure their own LLM provider** (API key setup friction is acceptable)
5. **Local-first architecture can scale** to team use cases without adding cloud orchestration

---

## 8. First 10 GitHub Issues

### Issue 1: `[SECURITY] Set a real Content Security Policy in tauri.conf.json`
**Why:** CSP is `null` (tauri.conf.json:34). Any XSS can call Tauri commands including keystroke injection. This is a remote code execution vulnerability.
**Files:** `src-tauri/tauri.conf.json:34`
**DoD:** CSP is set. Manual test: injecting `<script>invoke('send_keypress', ...)</script>` into the webview fails with CSP violation.

### Issue 2: `[SECURITY] Configure updater signing pubkey`
**Why:** `pubkey: ""` (tauri.conf.json:66) means auto-updater accepts unsigned packages. Any MITM can push malicious binaries to all users.
**Files:** `src-tauri/tauri.conf.json:66`, CI secrets
**DoD:** Pubkey is set. Test: build signed update, verify with `tauri signer verify`. Build unsigned update, verify client rejects it.

### Issue 3: `[BUG] CancellationToken never resets -- audio capture breaks after reload`
**Why:** `cancel_token` in AudioState (lib.rs:25) is one-shot. After F5 reload or window destroy, all future audio capture exits immediately. Users must restart the entire app to recover.
**Files:** `src-tauri/src/lib.rs:21-26`, `src-tauri/src/speaker/commands.rs:102`
**DoD:** Audio capture works after: (a) F5 reload, (b) stop/start cycle, (c) window close/reopen. Automated test covers all three.

### Issue 4: `[BUG] toggleAutostart actually toggles always-on-top`
**Why:** `config.context.tsx:567` calls `invoke("set_always_on_top")` instead of autostart plugin's `enable()`/`disable()`. The autostart toggle in settings is completely broken.
**Files:** `src/contexts/config.context.tsx:563-572`
**DoD:** Toggle autostart ON -> app appears in OS startup programs. Toggle OFF -> removed. Always-on-top is unaffected.

### Issue 5: `[FEATURE] Add send_text workflow step`
**Why:** The `send_text` Rust command exists (input.rs:380-389) and is registered (lib.rs:99) but has zero frontend callers. Users cannot type text into form fields -- the core data-entry use case is blocked.
**Files:** `src/types/workflow.ts` (new type), `src/hooks/workflow/useCaptureStep.ts` (new handler), `src/pages/workflows/index.tsx` (new add button + editor)
**DoD:** User can: add send_text step, configure static text or `{{prev}}` template, run workflow, text appears in focused application field.

### Issue 6: `[FEATURE] Add clipboard-paste workflow step`
**Why:** Character-by-character SendInput is slow and ASCII-only. A clipboard write + Ctrl+V paste step is faster and handles Unicode/special characters.
**Files:** Same as Issue 5 + new composed step type
**DoD:** User can paste AI-generated text (including Unicode) into any form field via a single workflow step.

### Issue 7: `[INFRA] Fix CI pipeline -- add tests, fix branch, update release name`
**Why:** publish.yml triggers on `master` (line 5) but default branch is `main`. Zero tests run before release. releaseName still says "Pluely" (line 73).
**Files:** `.github/workflows/publish.yml`
**DoD:** Pipeline triggers on `main`. Steps: `cargo check` -> `npx tsc --noEmit` -> `npm test` -> build. releaseName says "Auto-Vision".

### Issue 8: `[INFRA] Add Vitest and minimum test suite`
**Why:** Zero test runner is installed. Zero tests exist in CI. The only test file (`src/lib/__tests__/provider-system.test.ts`) uses hand-rolled asserts and isn't run by any script.
**Files:** `package.json` (add vitest), `vitest.config.ts` (new), `src/**/*.test.ts` (new)
**DoD:** `npm test` runs Vitest. Minimum coverage: workflow step dispatch, provider resolution, variable interpolation, key name validation.

### Issue 9: `[SECURITY] Scope HTTP permissions to known API endpoints`
**Why:** Both capability files allow `http://**` and `https://**`. Combined with null CSP, the app can make requests to any URL.
**Files:** `src-tauri/capabilities/default.json:33-39`, `src-tauri/capabilities/cross-platform.json:33-39`
**DoD:** HTTP permissions restricted to: localhost:*, known LLM provider domains (api.openai.com, api.anthropic.com, etc.), and user-configured custom endpoints.

### Issue 10: `[FEATURE] Add capture_screen button to workflow editor`
**Why:** Fullscreen capture works in runtime (`useCaptureStep.ts:28-31`) and backend (`capture.rs:607-633`) but there's no add button in the workflow editor. Users cannot create fullscreen capture steps.
**Files:** `src/pages/workflows/index.tsx:890` (add one button)
**DoD:** "Capture Screen" button appears in step picker. Creating and executing the step captures the full screen.

---

## 9. Testing Strategy

### Unit Tests (Priority: HIGHEST)

| Module | Test Focus | Framework |
|--------|-----------|-----------|
| `input.rs` | `map_key_name_to_vk` coverage, modifier management, KEY_IGNORE pattern | `#[cfg(test)]` in Rust |
| `workflow.ts` types | Step config validation, discriminated union correctness | Vitest |
| `useCaptureStep.ts` | Each step type dispatcher returns expected result | Vitest + React Testing Library |
| `useAIStep.ts` | Provider resolution chain, prompt interpolation with `{{prev}}`/`{{step[n]}}`, error detection | Vitest |
| `common.function.ts` | `deepVariableReplacer` with injection payloads, `extractVariables` edge cases | Vitest |
| `keychain.service.ts` | Fallback logic, key masking, concurrent access | Vitest |
| `provider-resolver.function.ts` | Missing keys, null presets, injection via providerId | Vitest |
| `useWorkflowState.ts` | `interpolateVariables` with nested templates, XSS payloads | Vitest |
| `persistent.rs` | Concurrent writes, malformed JSON recovery, large values | Rust `#[tokio::test]` |

### Integration Tests (Priority: HIGH)

| Scenario | What to test | Approach |
|---------|-------------|----------|
| Workflow execution pipeline | capture -> AI -> keypress with mock AI server | Vitest + MSW (Mock Service Worker) |
| Provider resolution chain | preset lookup -> keychain -> curl generation -> HTTP | Vitest + MSW |
| Cross-window data sync | persistent write -> emit -> listener -> state update | Tauri test harness |
| Audio capture lifecycle | start -> VAD -> emit -> stop, including cancellation | Tauri test harness |
| Shortcut registration | register -> trigger -> action -> unregister | Tauri test harness |

### E2E Desktop Flow Tests (Priority: MEDIUM, Phase 3)

| Scenario | What to test | Framework |
|---------|-------------|-----------|
| Workflow creation | Create 5-step workflow via UI, save, verify in localStorage | Playwright + Tauri WebDriver |
| Workflow execution | Run workflow, verify capture events, AI call, keystroke injection | Playwright + mock LLM server |
| Multi-window sync | Change setting in dashboard, verify reflected in main | Playwright multi-window |
| Update flow | Trigger update check, verify signature validation | Custom test harness |
| Shortcut conflicts | Register conflicting shortcuts, verify error handling | Playwright |

### Release Gates for CI/CD

```yaml
# Required gates before build step:
- cargo check                    # Rust compilation
- cargo clippy -- -D warnings    # Rust linting
- npx tsc --noEmit              # TypeScript type checking
- npm test                       # Vitest unit + integration
- npm audit --audit-level=moderate  # Frontend dep security
- cargo audit                    # Rust dep security

# Required gates before publish:
- All above pass on all 4 platform targets
- E2E smoke test passes (Phase 3)
- Manual QA checklist signed off (until E2E is automated)
```

---

## 10. Security and Safety Plan

### Threat Model for Desktop Automation

| Threat | Vector | Current Exposure | Mitigation |
|--------|--------|-----------------|------------|
| **XSS -> RCE** | Inject script into webview -> call `send_keypress` -> type `Win+R, cmd, Enter, malicious command` | **CRITICAL**: CSP is null, all Tauri commands callable | Set restrictive CSP. Add command allowlist for input injection. |
| **Malicious update** | MITM GitHub download -> push trojanized binary | **CRITICAL**: Updater pubkey is empty | Set pubkey. Pin update endpoint to HTTPS with certificate pinning. |
| **Malicious workflow import** | User imports shared workflow with hidden keypress steps | **MEDIUM**: No workflow validation on import | Validate on import, warn about injection steps, require user approval. |
| **API key theft** | XSS reads localStorage fallback keys | **HIGH**: Keys in plaintext localStorage when keychain unavailable | Encrypt fallback. Or refuse to store without keychain. |
| **Data exfiltration** | XSS sends screenshots/audio to attacker server | **HIGH**: HTTP permissions allow all URLs | Scope to known API domains. |
| **Prompt injection** | AI response manipulates subsequent workflow prompts via `{{prev}}` | **LOW**: Interpolation has no sanitization | Add prompt injection guardrails. Sanitize interpolated values. |
| **Runaway automation** | Workflow loop with keypress step types continuously into wrong app | **MEDIUM**: No safety limits | Add per-workflow keystroke budget, emergency stop (already has `emergencyStopKey`), visual indicator of active injection. |

### Safety Controls to Implement

1. **Emergency stop (already exists):** `WorkflowTrigger.emergencyStopKey` (workflow.ts:6). Verify it works reliably -- test: start loop workflow, press emergency stop, verify all injection stops within 100ms.

2. **Injection indicator:** When any `send_keypress` or `send_text` step executes, show a visible overlay indicator (e.g., pulsing border) so the user knows automation is active. This prevents confusion and builds trust.

3. **Keystroke budget:** Each workflow execution gets a configurable max keystroke count (default: 1000). If exceeded, pause and prompt the user. Prevents runaway loops.

4. **Dangerous key combo blocking:** Block `send_keypress` for: `Ctrl+Alt+Delete`, `Win+R` (unless explicitly allowlisted by user), `Alt+F4` in rapid succession. Log all blocked attempts.

5. **Workflow signing:** Before supporting shared/imported workflows, add a signing mechanism so users can verify the workflow source. Phase 3 priority.

### Compliance Considerations

- **GDPR/data residency:** Local-first architecture is inherently compliant. If screenshots are sent to cloud LLMs, inform the user with a clear consent dialog.
- **Accessibility:** Input injection should not interfere with screen readers. Test with NVDA/JAWS.
- **Content protection:** Already implemented (`window.rs:167-175`). Verify it works: screen recording software should not capture the Auto-Vision overlay.

---

## 11. Questions/Assumptions Needing Founder Input

1. **Pricing model:** Subscription ($10-30/mo) vs one-time purchase vs freemium? This affects feature gating decisions in Phase 3.

2. **LLM provider partnerships:** Should Auto-Vision ship with a default provider (e.g., bundled OpenRouter credits) to reduce setup friction, or require BYOK (bring your own key) always?

3. **Windows-first vs simultaneous cross-platform:** Cross-platform input injection (macOS CGEventPost, Linux xdotool) is 2-3 weeks of work per platform. Consider Windows-first launch to ship faster, then add platforms based on demand.

4. **Browser data-entry approach:** OS-level SendInput works today but is fragile (coordinates, focus management). CDP/Playwright integration would be more reliable for browser specifically. Which to prioritize? Recommendation: ship with SendInput now, add CDP as Phase 3 enhancement.

5. **Competitive response timing:** AutoHotkey v2 is in alpha. If they add AI capabilities, the differentiation narrows. Speed to market matters. Recommend: ship MVP within 60 days to establish position.

6. **Team scaling:** The codebase needs at least one more engineer for sustainable development (bus factor = 1 currently). When to hire?

7. **Analytics scope:** PostHog is already integrated (publish.yml references `POSTHOG_API_KEY`). What events should be tracked? Recommendation: workflow creation, execution success/failure, step type usage, provider distribution, error types.

8. **Update cadence:** With draft releases (publish.yml:75), how often should stable releases ship? Recommendation: weekly canary, biweekly stable during beta.

---

## 12. Project-Level Summary

### What's strong
- Real desktop primitives (capture, shortcuts, input injection) that competitors lack
- Sound Tauri v2 architecture with proper IPC push pattern
- Working AI vision pipeline (multi-provider, streaming, image stitching)
- Cross-window sync via persistent.rs is well-designed
- Emergency stop key is already architected into workflow triggers

### What's blocking
- 3 critical security vulnerabilities (CSP null, pubkey empty, HTTP wildcard)
- CancellationToken lifecycle breaks audio after any reload
- `send_text` backend exists but is not wired to workflows (core data-entry gap)
- Zero test suite for an automation tool that injects keystrokes
- CI builds releases without running any checks

### What to do next (ordered)
1. Fix the 3 security issues (Issues 1, 2, 9) -- **this week**
2. Fix autostart bug and cancellation token (Issues 3, 4) -- **this week**
3. Add `send_text` and clipboard-paste steps (Issues 5, 6) -- **next week**
4. Fix CI and add Vitest (Issues 7, 8) -- **next week**
5. Add `capture_screen` button (Issue 10) -- **same PR as step editor work**
6. Record a demo video of the browser data-entry workflow -- **end of week 2**
7. Share demo with 5 target users and collect feedback -- **week 3**
8. Iterate based on feedback, begin Phase 2 -- **week 4**
