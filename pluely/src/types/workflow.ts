export type WorkflowStepType = "capture_region" | "ai_process" | "action_notification" | "action_type";

export interface WorkflowStep {
    id: string;
    type: WorkflowStepType;
    config: any;
}

export interface CaptureStepConfig {
    x: number;
    y: number;
    width: number;
    height: number;
    monitorIndex?: number;
    mode: "fixed" | "interactive";
}

export interface AIStepConfig {
    prompt: string;
    model: string;
    systemPromptId?: string; // ID of a dragged-and-dropped system prompt
}

export interface ActionNotificationConfig {
    title: string;
    message?: string; // Optional custom message, defaults to AI output
}

export interface ActionTypeConfig {
    text?: string; // If empty, types the AI output
}

export interface Workflow {
    id: string;
    name: string;
    trigger: {
        type: "hotkey";
        key: string;
        enabled: boolean;
    };
    steps: WorkflowStep[];
    createdAt: number;
    updatedAt: number;
}
