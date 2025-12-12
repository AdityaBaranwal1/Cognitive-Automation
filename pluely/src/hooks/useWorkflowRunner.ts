import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { Workflow, AIStepConfig } from "@/types";
import { saveConversation, generateMessageId, generateConversationTitle, getAllSystemPrompts, fetchAIResponse } from "@/lib";
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
    captures: CapturedImage[];        // Array of captured images (execution-scoped)
    lastCapture: CapturedImage | null; // Most recent capture for convenience
    shouldStop: boolean;               // Stop signal from stop hotkey
    stepOutputs: string[];             // Output from each step for interpolation
    variables: Record<string, any>;    // User-defined variables
}

const createExecutionContext = (): ExecutionContext => ({
    captures: [],
    lastCapture: null,
    shouldStop: false,
    stepOutputs: [],
    variables: {}
});

// Safety Fallback: Use this if the user hasn't configured LM Studio in Settings yet
const FALLBACK_LM_STUDIO_PROVIDER: TYPE_PROVIDER = {
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

// --- Utility: Context Interpolation Engine ---
const interpolateVariables = (text: string, history: string[]): string => {
    if (!text) return "";
    if (!history.length) return text;

    let newText = text;
    // Replace {{prev}} with the output of the immediately preceding step
    const lastOutput = history[history.length - 1] || "";
    newText = newText.replace(/\{\{prev\}\}/g, lastOutput);

    // Replace {{step[n]}} with specific step output (0-indexed)
    newText = newText.replace(/\{\{step\[(\d+)\]\}\}/g, (match, index) => {
        const i = parseInt(index, 10);
        return history[i] !== undefined ? history[i] : match;
    });

    return newText;
};

export const useWorkflowRunner = () => {
    const { workflows, systemPrompt: defaultSystemPrompt, allAiProviders } = useApp();
    const { registerCustomShortcutCallback } = useGlobalShortcuts();

    useEffect(() => {
        workflows.forEach(workflow => {
            if (workflow.trigger.type === "hotkey" && workflow.trigger.enabled) {
                registerCustomShortcutCallback(workflow.id, () => executeWorkflow(workflow));
            }
        });
    }, [workflows, registerCustomShortcutCallback]);

    const executeWorkflow = async (workflow: Workflow) => {
        // FIX: Prevent duplicate execution by restricting to "main" window
        const currentWindow = await import("@tauri-apps/api/window").then(m => m.getCurrentWindow());
        if (currentWindow.label !== "main") {
            return;
        }

        console.log(`[${currentWindow.label}] 🚀 Starting workflow: ${workflow.name}`);
        console.log(`[${currentWindow.label}] Available Providers:`, allAiProviders.map(p => p.id));

        let lastResult: any = null;
        let userPromptContext: string = "";

        // Initialize execution context (resets captures array for each workflow run)
        const context: ExecutionContext = createExecutionContext();

        try {
            for (const step of workflow.steps) {
                console.log(`Running step: ${step.type}`);

                // CRITICAL FIX: Listen for BOTH legacy 'capture_region' and new 'capture_screen'
                if (step.type === "capture_region" || step.type === "capture_screen") {
                    const captureConfig = step.config as any;
                    const { x, y, width, height, monitorIndex, mode } = captureConfig;

                    let base64 = "";
                    // Support Fullscreen if explicitly requested, otherwise DEFAULT to Region Capture
                    if (mode === "fullscreen") {
                        base64 = await invoke<string>("capture_screen_silent", {
                            monitorIndex: monitorIndex ?? 0
                        });
                    } else {
                        // Standard Region Capture (The core feature)
                        base64 = await invoke<string>("capture_area_silent", {
                            coords: { x, y, width, height },
                            monitorIndex: monitorIndex ?? 0
                        });
                    }

                    // Add to captures array (multi-image accumulation)
                    const capturedImage: CapturedImage = {
                        id: crypto.randomUUID(),
                        base64: base64,
                        timestamp: Date.now(),
                        source: mode === "fullscreen" ? "fullscreen" : "region",
                        metadata: mode !== "fullscreen" ? { x, y, width, height } : undefined
                    };
                    context.captures.push(capturedImage);
                    context.lastCapture = capturedImage;

                    lastResult = base64;
                    context.stepOutputs.push(`[Image Captured: ${context.captures.length}]`);
                }
                else if (step.type === "ai_process") {
                    if (context.captures.length === 0) {
                        console.warn("No images captured for AI process. Proceeding with text only.");
                    }

                    const aiConfig = step.config as AIStepConfig;
                    const providerId = aiConfig.providerId || "lm-studio";

                    // 1. Resolve Provider (With Fallback)
                    let providerConfig = allAiProviders.find(p => p.id === providerId);

                    // Fallback for LM Studio if registry is empty
                    if (!providerConfig && providerId === "lm-studio") {
                        console.log("Using Fallback LM Studio Config");
                        providerConfig = FALLBACK_LM_STUDIO_PROVIDER;
                    }

                    if (!providerConfig) {
                        throw new Error(`Provider ${providerId} not found. Please configure it in settings.`);
                    }

                    // 2. Get System Prompt (workflow system prompt, NOT enhanced with response settings)
                    let systemPromptContent = defaultSystemPrompt;
                    if (aiConfig.systemPromptId) {
                        try {
                            const allPrompts = await getAllSystemPrompts();
                            const found = allPrompts.find(p => String(p.id) === String(aiConfig.systemPromptId));
                            if (found) systemPromptContent = found.prompt;
                        } catch (e) {
                            console.error("Failed to fetch system prompt", e);
                        }
                    }

                    // --- User Prompt Logic (Smart Defaults) ---
                    let rawPrompt = aiConfig.prompt;

                    if (!rawPrompt || rawPrompt.trim() === "") {
                        if (context.stepOutputs.length > 0) {
                            // Rule 1: If chained, use previous output
                            rawPrompt = "{{prev}}";
                        } else if (aiConfig.systemPromptId) {
                            // Rule 2: If System Prompt exists, use neutral text (don't override it)
                            // We use a single space because some APIs reject purely empty strings
                            rawPrompt = " ";
                        } else {
                            // Rule 3: No inputs at all? Default to generic analysis
                            rawPrompt = "Analyze this image.";
                        }
                    }

                    userPromptContext = interpolateVariables(rawPrompt, context.stepOutputs);

                    // 3. Execute using ROBUST fetchAIResponse (Logic Reuse)
                    let fullResponse = "";

                    const generator = fetchAIResponse({
                        provider: providerConfig,
                        selectedProvider: {
                            provider: providerId,
                            variables: {
                                // FIX: Keys must be lowercase to pass validation check
                                model: aiConfig.model || "qwen/qwen3-vl-8b",
                                api_key: providerConfig.variables?.["api_key"] || providerConfig.variables?.["API_KEY"] || "",
                                ...(providerConfig.variables || {})
                            }
                        },
                        systemPrompt: systemPromptContent,
                        userMessage: userPromptContext,
                        // Pass all captured images (multi-image support)
                        imagesBase64: context.captures.map(c => c.base64),
                        history: [],
                        // FIX: Skip response settings (length/language) for workflows
                        // Workflows should use the custom system prompt as-is
                        skipResponseSettings: true
                    });

                    for await (const chunk of generator) {
                        fullResponse += chunk;
                    }

                    console.log("AI Response:", fullResponse);
                    console.log(`Processed ${context.captures.length} image(s)`);
                    lastResult = fullResponse;
                    context.stepOutputs.push(fullResponse);
                }
                else if (step.type === "action_notification" || step.type === "system_action") {
                    const outputText = typeof lastResult === "string" ? lastResult : JSON.stringify(lastResult);
                    const actionConfig = step.config as any;
                    const isCopy = actionConfig.title === "Copy to Clipboard" || actionConfig.action === "copy_to_clipboard";

                    if (isCopy) {
                        await navigator.clipboard.writeText(outputText);
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification("Copied to Clipboard", { body: "AI response copied" });
                        }
                    } else {
                        // Default: Chat Overlay
                        const timestamp = Date.now();
                        const conversationId = crypto.randomUUID();

                        await saveConversation({
                            id: conversationId,
                            title: generateConversationTitle(userPromptContext) || "Workflow Result",
                            messages: [
                                {
                                    id: generateMessageId("user", timestamp),
                                    role: "user",
                                    content: `[Workflow] ${userPromptContext}`,
                                    timestamp: timestamp,
                                    // Attach all captured images to conversation
                                    attachedFiles: context.captures.map((capture, idx) => ({
                                        id: capture.id,
                                        name: `workflow_capture_${idx + 1}.png`,
                                        type: "image/png",
                                        base64: capture.base64,
                                        size: capture.base64.length
                                    }))
                                },
                                {
                                    id: generateMessageId("assistant", timestamp + 1),
                                    role: "assistant",
                                    content: outputText,
                                    timestamp: timestamp + 1
                                }
                            ],
                            createdAt: timestamp,
                            updatedAt: timestamp
                        });

                        await invoke("open_dashboard");
                    }
                    context.stepOutputs.push("Action Executed");
                }
                // Keypress step execution - calls Rust input injection
                else if (step.type === "keypress") {
                    const keypressConfig = step.config as { key: string; modifiers?: string[] };
                    const { key, modifiers = [] } = keypressConfig;

                    console.log(`Sending keypress: ${key} with modifiers: ${modifiers.join(", ") || "none"}`);

                    try {
                        await invoke("send_keypress", {
                            key,
                            modifiers: modifiers.length > 0 ? modifiers : null
                        });
                        context.stepOutputs.push(`[Keypress: ${modifiers.length > 0 ? modifiers.join("+") + "+" : ""}${key}]`);
                    } catch (e) {
                        console.error("Keypress failed:", e);
                        context.stepOutputs.push(`[Keypress Failed: ${e}]`);
                    }
                }
            }
        } catch (error) {
            console.error("Workflow execution failed:", error);
        }
    };

    return { executeWorkflow };
};