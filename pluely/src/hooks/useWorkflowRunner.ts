import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { Workflow, AIStepConfig, WaitStepConfig, LoopStepConfig, WorkflowStep, AwaitInputStepConfig } from "@/types";
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
    const { registerCustomShortcutCallback, unregisterCustomShortcutCallback } = useGlobalShortcuts();

    // Ref to signal stop from hotkey callback
    const shouldStopRef = useRef(false);

    useEffect(() => {
        workflows.forEach(workflow => {
            if (workflow.trigger.type === "hotkey" && workflow.trigger.enabled) {
                registerCustomShortcutCallback(workflow.id, () => executeWorkflow(workflow));
            }
        });
    }, [workflows, registerCustomShortcutCallback]);

    // Helper function to execute a single step (used for main steps and loop children)
    const executeStep = async (step: WorkflowStep, context: ExecutionContext, allAiProviders: TYPE_PROVIDER[], defaultSystemPrompt: string): Promise<any> => {
        console.log(`Running step: ${step.type}`);
        let lastResult: any = null;

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
        else if (step.type === "keypress") {
            const keypressConfig = step.config as { key: string; modifiers?: string[] };
            const { key, modifiers = [] } = keypressConfig;

            console.log(`⌨️ Sending keypress: ${key}`);
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
        // Wait step - delay execution
        else if (step.type === "wait") {
            const waitConfig = step.config as WaitStepConfig;
            console.log(`⏳ Waiting ${waitConfig.durationMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitConfig.durationMs));
            context.stepOutputs.push(`[Wait: ${waitConfig.durationMs}ms]`);
        }
        // Loop step - repeat children N times
        else if (step.type === "loop") {
            const loopConfig = step.config as LoopStepConfig;
            console.log(`🔄 Starting loop (${loopConfig.iterations} iterations)`);

            for (let i = 0; i < loopConfig.iterations; i++) {
                if (context.shouldStop) {
                    console.log("🛑 Loop stopped by user");
                    break;
                }

                console.log(`  Loop ${i + 1}/${loopConfig.iterations}`);

                for (const childStep of loopConfig.children || []) {
                    if (context.shouldStop) break;
                    await executeStep(childStep, context, allAiProviders, defaultSystemPrompt);
                }
            }

            context.stepOutputs.push(`[Loop: ${loopConfig.iterations}x completed]`);
        }
        // Phase 6B: Await Input step - dispatch center for human-in-the-loop
        else if (step.type === "await_input") {
            const awaitConfig = step.config as AwaitInputStepConfig;
            console.log(`⏸️ Await Input: Listening for keys...`);

            // Track which key was pressed
            let awaitKeyPressed: string | null = null;

            // STEP 1: Dynamically register the await keys as system hotkeys (INCREMENTAL)
            const registeredAwaitKeys: string[] = [];
            for (const keyAction of awaitConfig.keymap) {
                const actionId = `await_${step.id}_${keyAction.key}`;
                try {
                    await invoke("register_shortcut", { actionId, key: keyAction.key });
                    registeredAwaitKeys.push(actionId);
                    console.log(`🔑 Registered await key: ${keyAction.key}`);
                } catch (e) {
                    console.error(`Failed to register await key ${keyAction.key}:`, e);
                }
            }
            console.log(`🔑 Registered ${registeredAwaitKeys.length} await keys with OS (incremental)`);

            // Register temporary callbacks for each key in the keymap
            const cleanupFns: (() => void)[] = [];
            for (const keyAction of awaitConfig.keymap) {
                const callbackId = `await_${step.id}_${keyAction.key}`;
                registerCustomShortcutCallback(callbackId, () => {
                    console.log(`🎯 Await: Key ${keyAction.key} pressed → ${keyAction.action}`);
                    awaitKeyPressed = keyAction.key;
                });
                cleanupFns.push(() => unregisterCustomShortcutCallback(callbackId));
            }

            // Main await loop - stays in "listening mode" until continue/break
            let continueListening = true;
            while (continueListening && !context.shouldStop) {
                // Wait for a keypress
                awaitKeyPressed = null;
                const startTime = Date.now();
                const timeout = awaitConfig.timeout || 0;

                while (!awaitKeyPressed && !context.shouldStop) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    if (timeout > 0 && Date.now() - startTime > timeout) {
                        console.log("⏰ Await Input timed out");
                        continueListening = false;
                        break;
                    }
                }

                if (!awaitKeyPressed || context.shouldStop) break;

                // Find the action for this key
                const pressedAction = awaitConfig.keymap.find(a => a.key === awaitKeyPressed);
                if (!pressedAction) continue;

                // Handle the action
                if (pressedAction.action === "run_workflow") {
                    // Run sub-workflow inline, sharing context
                    const subWorkflow = workflows.find(w => w.id === pressedAction.workflowId);
                    if (subWorkflow) {
                        console.log(`📁 Running sub-workflow: ${subWorkflow.name}`);
                        for (const subStep of subWorkflow.steps) {
                            if (context.shouldStop) break;
                            await executeStep(subStep, context, allAiProviders, defaultSystemPrompt);
                        }
                    }
                    // After sub-workflow, continue listening (loop back)
                }
                else if (pressedAction.action === "keypress" && pressedAction.keypressConfig) {
                    // Send keypress to OS
                    try {
                        await invoke("send_keypress", {
                            key: pressedAction.keypressConfig.key,
                            modifiers: pressedAction.keypressConfig.modifiers || null
                        });
                        console.log(`⌨️ Sent keypress: ${pressedAction.keypressConfig.key}`);
                    } catch (e) {
                        console.error("Keypress failed:", e);
                    }
                    // Continue listening
                }
                else if (pressedAction.action === "continue") {
                    // Exit await, continue to next workflow step
                    console.log("➡️ Await Input: Continue to next step");
                    continueListening = false;
                }
                else if (pressedAction.action === "break") {
                    // Stop entire workflow
                    console.log("🛑 Await Input: Breaking workflow");
                    context.shouldStop = true;
                    continueListening = false;
                }
            }

            // Cleanup all temporary callbacks
            cleanupFns.forEach(fn => fn());
            context.stepOutputs.push(`[Await Input completed]`);

            // CRITICAL: Unregister only the await keys we added (not everything)
            for (const actionId of registeredAwaitKeys) {
                try {
                    await invoke("unregister_shortcut", { actionId });
                } catch (e) {
                    console.error(`Failed to unregister await key ${actionId}:`, e);
                }
            }
            console.log(`🔑 Cleaned up ${registeredAwaitKeys.length} await keys (incremental)`);
        }

        return lastResult;
    };

    const executeWorkflow = async (workflow: Workflow) => {
        const currentWindow = await import("@tauri-apps/api/window").then(m => m.getCurrentWindow());
        if (currentWindow.label !== "main") {
            return;
        }

        console.log(`[${currentWindow.label}] 🚀 Starting workflow: ${workflow.name}`);

        let lastResult: any = null;
        let userPromptContext: string = "";
        let lastProviderId: string | undefined = undefined;  // Track provider for conversation persistence
        let lastModel: string | undefined = undefined;       // Track model for conversation persistence
        const context: ExecutionContext = createExecutionContext();

        // Reset stop flag and register emergency stop callback
        shouldStopRef.current = false;
        const stopActionId = `${workflow.id}_stop`;
        if (workflow.trigger.emergencyStopKey) {
            registerCustomShortcutCallback(stopActionId, () => {
                console.log("🛑 Emergency stop key pressed!");
                shouldStopRef.current = true;
            });
        }

        try {
            for (const step of workflow.steps) {
                // Sync stop flag from ref to context
                context.shouldStop = shouldStopRef.current;
                if (context.shouldStop) {
                    console.log("🛑 Workflow stopped by user");
                    break;
                }

                // Handle steps that need special processing in main loop
                if (step.type === "ai_process") {
                    console.log(`Running step: ${step.type}`);

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

                    let rawPrompt = aiConfig.prompt;
                    if (!rawPrompt || rawPrompt.trim() === "") {
                        if (aiConfig.systemPromptId) {
                            rawPrompt = " ";
                            console.log("Using system prompt only (no user prompt)");
                        } else {
                            const lastRealOutput = context.stepOutputs
                                .slice()
                                .reverse()
                                .find(o => !o.startsWith("[Image") && !o.startsWith("[Keypress") && !o.startsWith("[Wait") && !o.startsWith("[Loop") && !o.startsWith("[Await"));

                            if (lastRealOutput) {
                                rawPrompt = lastRealOutput;
                            } else {
                                rawPrompt = "Analyze this image.";
                            }
                        }
                    }

                    userPromptContext = interpolateVariables(rawPrompt, context.stepOutputs);
                    console.log("User prompt context:", userPromptContext.substring(0, 100) + "...");

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

                    // Track provider/model for conversation persistence
                    lastProviderId = providerId;
                    lastModel = aiConfig.model;
                }
                else if (step.type === "action_notification" || step.type === "system_action") {
                    console.log(`Running step: ${step.type}`);

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
                            updatedAt: timestamp,
                            providerId: lastProviderId,  // Remember which provider created this conversation
                            model: lastModel             // Remember which model was used
                        });

                        await invoke("open_dashboard");
                    }
                    context.stepOutputs.push("Action Executed");
                }
                else {
                    // Use helper for capture, keypress, wait, loop, await_input
                    context.shouldStop = shouldStopRef.current; // Sync before each step
                    const result = await executeStep(step, context, allAiProviders, defaultSystemPrompt);
                    if (result) lastResult = result;
                }
            }
        } catch (error) {
            console.error("Workflow execution failed:", error);
        } finally {
            // Cleanup emergency stop callback
            if (workflow.trigger.emergencyStopKey) {
                unregisterCustomShortcutCallback(stopActionId);
            }
        }
    };

    return { executeWorkflow };
};