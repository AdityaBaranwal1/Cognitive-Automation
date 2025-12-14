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
    captures: CapturedImage[];
    lastCapture: CapturedImage | null;
    shouldStop: boolean;
    stepOutputs: string[];
    variables: Record<string, any>;
}

const createExecutionContext = (): ExecutionContext => ({
    captures: [],
    lastCapture: null,
    shouldStop: false,
    stepOutputs: [],
    variables: {}
});

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

const interpolateVariables = (text: string, history: string[]): string => {
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
        const currentWindow = await import("@tauri-apps/api/window").then(m => m.getCurrentWindow());
        if (currentWindow.label !== "main") {
            return;
        }

        console.log(`[${currentWindow.label}] 🚀 Starting workflow: ${workflow.name}`);

        let lastResult: any = null;
        let userPromptContext: string = "";
        const context: ExecutionContext = createExecutionContext();

        try {
            for (const step of workflow.steps) {
                console.log(`Running step: ${step.type}`);

                if (step.type === "capture_region" || step.type === "capture_screen") {
                    const captureConfig = step.config as any;
                    const { x, y, width, height, monitorIndex, mode } = captureConfig;

                    let base64 = "";
                    if (mode === "fullscreen") {
                        base64 = await invoke<string>("capture_screen_silent", {
                            monitorIndex: monitorIndex ?? 0
                        });
                    } else {
                        base64 = await invoke<string>("capture_area_silent", {
                            coords: { x, y, width, height },
                            monitorIndex: monitorIndex ?? 0
                        });
                    }

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
                        console.warn("No images captured for AI process.");
                    }

                    const aiConfig = step.config as AIStepConfig;
                    const providerId = aiConfig.providerId || "lm-studio";

                    let providerConfig = allAiProviders.find(p => p.id === providerId);
                    if (!providerConfig && providerId === "lm-studio") {
                        providerConfig = FALLBACK_LM_STUDIO_PROVIDER;
                    }
                    if (!providerConfig) {
                        throw new Error(`Provider ${providerId} not found.`);
                    }

                    // Get System Prompt
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

                    // --- FIX: User Prompt Logic (Correct Priority) ---
                    // Priority: 1) System Prompt wins -> use space
                    //           2) Chain from prior AI output (NOT capture placeholders)  
                    //           3) Default analysis
                    let rawPrompt = aiConfig.prompt;
                    if (!rawPrompt || rawPrompt.trim() === "") {
                        if (aiConfig.systemPromptId) {
                            // PRIORITY 1: System prompt handles everything - minimal user text
                            rawPrompt = " ";
                            console.log("Using system prompt only (no user prompt)");
                        } else {
                            // Find last non-placeholder output
                            const lastRealOutput = context.stepOutputs
                                .slice()
                                .reverse()
                                .find(o => !o.startsWith("[Image") && !o.startsWith("[Keypress"));

                            if (lastRealOutput) {
                                // PRIORITY 2: Chain from prior AI output
                                rawPrompt = lastRealOutput;
                            } else {
                                // PRIORITY 3: Default
                                rawPrompt = "Analyze this image.";
                            }
                        }
                    }

                    userPromptContext = interpolateVariables(rawPrompt, context.stepOutputs);
                    console.log("User prompt context:", userPromptContext.substring(0, 100) + "...");

                    // Prepare images (stitch if enabled)
                    let imagesForAI: string[] = context.captures.map(c => c.base64);
                    let wasStitched = false;

                    if (aiConfig.stitchImages && context.captures.length > 1) {
                        try {
                            console.log(`🖼️ Stitching ${context.captures.length} images...`);
                            const stitched: string = await invoke("stitch_images_vertical", {
                                imagesBase64: imagesForAI,
                                maxCount: aiConfig.stitchMaxCount ?? 5,
                                scaleFactor: aiConfig.stitchScaleFactor ?? 1.0
                            });
                            imagesForAI = [stitched];
                            wasStitched = true;
                            console.log("✅ Images stitched into 1");
                        } catch (e) {
                            console.error("❌ Stitch failed:", e);
                        }
                    }

                    // Execute AI
                    let fullResponse = "";
                    const generator = fetchAIResponse({
                        provider: providerConfig,
                        selectedProvider: {
                            provider: providerId,
                            variables: {
                                model: aiConfig.model || "qwen/qwen3-vl-8b",
                                api_key: providerConfig.variables?.["api_key"] || providerConfig.variables?.["API_KEY"] || "",
                                ...(providerConfig.variables || {})
                            }
                        },
                        systemPrompt: systemPromptContent,
                        userMessage: userPromptContext,
                        imagesBase64: imagesForAI,
                        history: [],
                        skipResponseSettings: true
                    });

                    for await (const chunk of generator) {
                        fullResponse += chunk;
                    }

                    const imageStatus = wasStitched
                        ? `✅ Sent 1 STITCHED image (from ${context.captures.length} captures)`
                        : `Sent ${imagesForAI.length} image(s)`;
                    console.log("AI Response:", fullResponse.substring(0, 200) + "...");
                    console.log(imageStatus);

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
                else if (step.type === "keypress") {
                    const keypressConfig = step.config as { key: string; modifiers?: string[] };
                    const { key, modifiers = [] } = keypressConfig;

                    console.log(`Sending keypress: ${key}`);

                    try {
                        await invoke("send_keypress", {
                            key,
                            modifiers: modifiers.length > 0 ? modifiers : null
                        });
                        context.stepOutputs.push(`[Keypress: ${key}]`);
                    } catch (e) {
                        console.error("Keypress failed:", e);
                        context.stepOutputs.push(`[Keypress Failed]`);
                    }
                }
            }
        } catch (error) {
            console.error("Workflow execution failed:", error);
        }
    };

    return { executeWorkflow };
};