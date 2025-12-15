export type WorkflowTriggerType = "hotkey" | "keyword" | "manual";

export interface WorkflowTrigger {
    type: WorkflowTriggerType;
    key?: string;           // Trigger hotkey
    emergencyStopKey?: string;  // Emergency stop hotkey for interrupting workflows
    keyword?: string;  // For keyword
    enabled: boolean;
}

export type StepType = "capture_screen" | "ai_process" | "system_action" | "delay" | "capture_region" | "action_notification" | "keypress" | "wait" | "loop" | "await_input";

export interface BaseStepConfig {
    [key: string]: any;
}

export interface CaptureStepConfig extends BaseStepConfig {
    mode: "fullscreen" | "window" | "area";
}

export type AIProviderType = "lm-studio" | "openai" | "anthropic" | "custom";

export interface AIStepConfig extends BaseStepConfig {
    providerId: string; // Reference to the provider in Dev Space
    model: string;      // Specific model to use (fetched dynamically)
    prompt: string;     // The user prompt
    systemPromptId?: string; // Reference to system prompt
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
export interface LoopStepConfig extends BaseStepConfig {
    iterations: number;    // Number of times to repeat (1-100)
    children: WorkflowStep[];  // Nested steps to execute in each iteration
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

export interface WorkflowStep {
    id: string;
    type: StepType;
    name: string;
    config: CaptureStepConfig | AIStepConfig | SystemActionConfig | DelayStepConfig | KeypressStepConfig | WaitStepConfig | LoopStepConfig | AwaitInputStepConfig;
}

export interface Workflow {
    id: string;
    name: string;
    description?: string;
    trigger: WorkflowTrigger;
    steps: WorkflowStep[];
    createdAt: number;
    updatedAt: number;
}
