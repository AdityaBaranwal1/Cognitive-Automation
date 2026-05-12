export type WorkflowTriggerType = "hotkey" | "keyword" | "manual";

export interface WorkflowTrigger {
    type: WorkflowTriggerType;
    key?: string;           // Trigger hotkey
    emergencyStopKey?: string;  // Emergency stop hotkey for interrupting workflows
    keyword?: string;  // For keyword
    enabled: boolean;
}

export type StepType =
    | "capture_screen"
    | "ai_process"
    | "system_action"
    | "delay"
    | "capture_region"
    | "action_notification"
    | "keypress"
    | "wait"
    | "loop"
    | "await_input"
    // AST control-flow types declared in Phase 1 (executors land in Phases 2b/5/7).
    | "if"
    | "foreach"
    | "try_catch"
    | "sub_workflow";

/**
 * Reliability policy attached to any step.
 * Lands in Phase 5 (RunController). Declared here so the StepBase envelope
 * does not need to change again.
 */
export interface StepPolicy {
    timeoutMs?: number;
    retry?: { max: number; backoffMs: number; on?: ("network" | "timeout" | "validation" | "*")[] };
    continueOnError?: boolean;
    onError?: WorkflowStep[];
}

export interface BaseStepConfig {
    [key: string]: any;
}

export interface CaptureStepConfig extends BaseStepConfig {
    mode: "fullscreen" | "window" | "area" | "fixed";
}

export type AIProviderType = "lm-studio" | "openai" | "anthropic" | "custom";

export interface AIStepConfig extends BaseStepConfig {
    providerId: string; // Reference to the provider in Dev Space
    model: string;      // Specific model to use (fetched dynamically)
    prompt: string;     // The user prompt
    systemPromptId?: string; // Reference to system prompt
    profileId?: string; // Reference to model profile (context/vision settings)
    outputRules?: string; // Per-step output constraints (e.g., "Answer only. No explanation.")
    temperature?: number;
    maxTokens?: number;
    // Phase 3: Image stitching settings
    stitchImages?: boolean;      // If true, stitch all captures into one image (default: false)
    stitchMaxCount?: number;     // Max images to stitch (default: 5)
    stitchScaleFactor?: number;  // Scale factor 0.0-1.0 (default: 1.0 = 100%)
}

export interface SystemActionConfig extends BaseStepConfig {
    action: "copy_to_clipboard" | "save_to_file" | "open_url" | "run_command" | "notification";
    value: string; // The content to copy, path to save, URL to open, etc.
}

export interface DelayStepConfig extends BaseStepConfig {
    durationMs: number;
}

// NEW: Keypress step configuration
export interface KeypressStepConfig extends BaseStepConfig {
    key: string;           // Named key: "PageDown", "Enter", "a", "F5", etc.
    modifiers?: string[];  // Optional modifiers: ["ctrl"], ["ctrl", "shift"], etc.
}

// Phase 4: Wait step configuration
export interface WaitStepConfig extends BaseStepConfig {
    durationMs: number;    // Milliseconds to wait (100-10000)
}

// Phase 4: Loop step configuration
// v1 used `children`; v2 uses `body`. Migrator copies children -> body and the
// runner reads `body ?? children` for back-compat. Mark `children` deprecated;
// remove once all live workflows have re-saved.
export interface LoopStepConfig extends BaseStepConfig {
    iterations: number;       // Number of times to repeat (1-100)
    body?: WorkflowStep[];    // Phase 1 (v2): nested steps to execute in each iteration
    /** @deprecated v1 field — migrator renames to `body`. */
    children?: WorkflowStep[];
}

// AST control-flow configs declared in Phase 1.
// Executors will land later (if/foreach in Phase 7c, try_catch/sub_workflow per plan).

export interface IfStepConfig extends BaseStepConfig {
    /** JEXL expression evaluated against artifact bindings — no moustaches. */
    condition: string;
    then: WorkflowStep[];
    else?: WorkflowStep[];
}

export interface ForeachStepConfig extends BaseStepConfig {
    /** Token reference (e.g. "steps.extract.rows" or "vars.csv") resolved at runtime. */
    source: string;
    body: WorkflowStep[];
}

export interface TryCatchStepConfig extends BaseStepConfig {
    body: WorkflowStep[];
    catch: WorkflowStep[];
    finally?: WorkflowStep[];
}

export interface SubWorkflowStepConfig extends BaseStepConfig {
    workflowId: string;
    /** Optional input bindings (variable name -> token reference). */
    inputs?: Record<string, string>;
}

// Phase 6B: Await Input key action mapping
export interface AwaitInputKeyAction {
    key: string;           // Hotkey like "F4", "F5", "F6"
    action: "run_workflow" | "keypress" | "continue" | "break";
    workflowId?: string;   // If action = "run_workflow", the sub-workflow to run
    keypressConfig?: { key: string; modifiers?: string[] };  // If action = "keypress"
    label?: string;        // User-friendly label like "Capture Tab", "Next Tab"
}

// Phase 6B: Await Input step configuration (Dispatch Node)
export interface AwaitInputStepConfig extends BaseStepConfig {
    timeout?: number;      // Optional timeout in ms (0 = no timeout)
    keymap: AwaitInputKeyAction[];  // Array of key->action mappings
}

// Action notification step configuration
export interface ActionNotificationConfig extends BaseStepConfig {
    title: string;
    message?: string;
}

/**
 * Common envelope for every step. Discriminated union below pairs `type` to
 * its `config` type. `key` is an optional user-facing alias used by the
 * expression bindings; if absent, `id` (UUID) is used.
 */
export interface StepBase {
    id: string;
    /**
     * Optional user-friendly alias for expressions: `^[a-zA-Z_][a-zA-Z0-9_]*$`.
     * When present, `steps.<key>.<jsonpath>` resolves against this binding;
     * otherwise the UUID is used.
     */
    key?: string;
    name?: string;
    policy?: StepPolicy;
}

export type WorkflowStep =
    | (StepBase & { type: "capture_region"; config: CaptureStepConfig })
    | (StepBase & { type: "capture_screen"; config: CaptureStepConfig })
    | (StepBase & { type: "ai_process"; config: AIStepConfig })
    | (StepBase & { type: "system_action"; config: SystemActionConfig })
    | (StepBase & { type: "delay"; config: DelayStepConfig })
    | (StepBase & { type: "action_notification"; config: ActionNotificationConfig })
    | (StepBase & { type: "keypress"; config: KeypressStepConfig })
    | (StepBase & { type: "wait"; config: WaitStepConfig })
    | (StepBase & { type: "loop"; config: LoopStepConfig })
    | (StepBase & { type: "await_input"; config: AwaitInputStepConfig })
    | (StepBase & { type: "if"; config: IfStepConfig })
    | (StepBase & { type: "foreach"; config: ForeachStepConfig })
    | (StepBase & { type: "try_catch"; config: TryCatchStepConfig })
    | (StepBase & { type: "sub_workflow"; config: SubWorkflowStepConfig });

export const WORKFLOW_SCHEMA_VERSION = 2 as const;

export interface Workflow {
    id: string;
    schemaVersion?: typeof WORKFLOW_SCHEMA_VERSION;
    name: string;
    description?: string;
    trigger: WorkflowTrigger;
    /**
     * Phase 7c-bis: domains that http_request steps in this workflow may reach.
     * Enforced server-side (Rust) by `workflow_http_request`. An empty or
     * undefined list means no http_request is permitted.
     */
    allowedHosts?: string[];
    steps: WorkflowStep[];
    createdAt: number;
    updatedAt: number;
}

// Workflow execution tracking (for progress indicators)
export type WorkflowExecutionStatus = "idle" | "running" | "ai_thinking" | "capturing" | "waiting" | "completed" | "error";

export interface WorkflowExecution {
    workflowId: string;
    workflowName: string;
    activeStepId: string | null;
    activeStepType: StepType | null;
    activeStepIndex: number;
    totalSteps: number;
    status: WorkflowExecutionStatus;
    error?: string;
}
