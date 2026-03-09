import { emit } from "@tauri-apps/api/event";
import { WorkflowExecution, Workflow } from "@/types";
import { TYPE_PROVIDER } from "@/types/provider.type";

// --- Execution Context for Multi-Capture Workflows ---
export interface CapturedImage {
    id: string;
    base64: string;
    timestamp: number;
    source: "region" | "fullscreen";
    metadata?: { x: number; y: number; width: number; height: number };
}

export interface ExecutionContext {
    captures: CapturedImage[];
    lastCapture: CapturedImage | null;
    shouldStop: boolean;
    stepOutputs: string[];
    variables: Record<string, any>;
}

export const createExecutionContext = (): ExecutionContext => ({
    captures: [],
    lastCapture: null,
    shouldStop: false,
    stepOutputs: [],
    variables: {}
});

export const FALLBACK_LM_STUDIO_PROVIDER: TYPE_PROVIDER = {
    id: "lm-studio",
    name: "LM Studio (Local)",
    curl: `curl http://localhost:1234/v1/chat/completions \\
-H "Content-Type: application/json" \\
-d '{
  "model": "{{MODEL}}",
  "messages": [
    { "role": "system", "content": "{{SYSTEM_PROMPT}}" },
    { "role": "user", "content": [
        { "type": "text", "text": "{{TEXT}}" },
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,{{IMAGE}}" } }
      ]
    }
  ],
  "temperature": 0.7,
  "max_tokens": -1,
  "stream": false
}'`,
    responseContentPath: "choices[0].message.content",
    streaming: false,
    isCustom: true
};

export const interpolateVariables = (text: string, history: string[]): string => {
    if (!text) return "";
    if (!history.length) return text;

    let newText = text;
    const lastOutput = history[history.length - 1] || "";
    newText = newText.replace(/\{\{prev\}\}/g, lastOutput);

    newText = newText.replace(/\{\{step\[(\d+)\]\}\}/g, (match, index) => {
        const i = parseInt(index, 10);
        return history[i] !== undefined ? history[i] : match;
    });

    return newText;
};

export type EmitProgressFn = (update: Partial<WorkflowExecution>) => void;

export const createEmitProgress = (
    workflow: Workflow,
    setWorkflowExecution: (fn: ((prev: WorkflowExecution | null) => WorkflowExecution | null) | null) => void,
): EmitProgressFn => {
    return (update: Partial<WorkflowExecution>) => {
        setWorkflowExecution(prev => {
            const next: WorkflowExecution = {
                workflowId: workflow.id,
                workflowName: workflow.name,
                activeStepId: null,
                activeStepType: null,
                activeStepIndex: 0,
                totalSteps: workflow.steps.length,
                status: "running",
                ...prev,
                ...update,
            };
            emit("workflow-execution-update", next).catch(() => { });
            return next;
        });
    };
};
