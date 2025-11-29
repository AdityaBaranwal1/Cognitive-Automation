import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { Workflow, AIStepConfig } from "@/types";
import { saveConversation, generateMessageId, generateConversationTitle, getAllSystemPrompts, fetchAIResponse } from "@/lib";
import { TYPE_PROVIDER } from "@/types/provider.type";

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
        console.log(`🚀 Starting workflow: ${workflow.name}`);

        let lastResult: any = null;
        let capturedImageBase64: string = "";
        let userPromptContext: string = "";

        try {
            for (const step of workflow.steps) {
                console.log(`Running step: ${step.type}`);

                // CRITICAL FIX: Listen for BOTH legacy 'capture_region' and new 'capture_screen'
                if (step.type === "capture_region" || step.type === "capture_screen") {
                    const config = step.config as any;
                    const { x, y, width, height, monitorIndex, mode } = config;

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
                    capturedImageBase64 = base64;
                    lastResult = base64;
                }
                else if (step.type === "ai_process") {
                    if (!capturedImageBase64) {
                        console.warn("No image captured for AI process. Proceeding with text only.");
                    }

                    const config = step.config as AIStepConfig;
                    const providerId = config.providerId || "lm-studio";

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

                    // 2. Get System Prompt
                    let systemPromptContent = defaultSystemPrompt;
                    if (config.systemPromptId) {
                        try {
                            const allPrompts = await getAllSystemPrompts();
                            const found = allPrompts.find(p => String(p.id) === String(config.systemPromptId));
                            if (found) systemPromptContent = found.prompt;
                        } catch (e) {
                            console.error("Failed to fetch system prompt", e);
                        }
                    }

                    userPromptContext = config.prompt || "Analyze this image.";

                    // 3. Execute using ROBUST fetchAIResponse (Logic Reuse)
                    let fullResponse = "";

                    const generator = fetchAIResponse({
                        provider: providerConfig,
                        selectedProvider: {
                            provider: providerId,
                            variables: {
                                // FIX: Keys must be lowercase to pass validation check
                                model: config.model || "qwen/qwen3-vl-8b",
                                api_key: providerConfig.variables?.["api_key"] || providerConfig.variables?.["API_KEY"] || "",
                                ...(providerConfig.variables || {})
                            }
                        },
                        systemPrompt: systemPromptContent,
                        userMessage: userPromptContext,
                        imagesBase64: capturedImageBase64 ? [capturedImageBase64] : [],
                        history: []
                    });

                    for await (const chunk of generator) {
                        fullResponse += chunk;
                    }

                    console.log("AI Response:", fullResponse);
                    lastResult = fullResponse;
                }
                else if (step.type === "action_notification" || step.type === "system_action") {
                    const outputText = typeof lastResult === "string" ? lastResult : JSON.stringify(lastResult);
                    const config = step.config as any;
                    const isCopy = config.title === "Copy to Clipboard" || config.action === "copy_to_clipboard";

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
                                    attachedFiles: capturedImageBase64 ? [{
                                        id: crypto.randomUUID(),
                                        name: "workflow_capture.png",
                                        type: "image/png",
                                        base64: capturedImageBase64,
                                        size: capturedImageBase64.length
                                    }] : []
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
                }
            }
        } catch (error) {
            console.error("Workflow execution failed:", error);
        }
    };

    return { executeWorkflow };
};