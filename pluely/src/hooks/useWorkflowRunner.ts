import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp, useSystemPrompts } from "@/contexts";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { Workflow } from "@/types";
import { saveConversation, generateMessageId, generateConversationTitle, getAllSystemPrompts } from "@/lib";

export const useWorkflowRunner = () => {
    const { workflows, systemPrompt: defaultSystemPrompt } = useApp();
    const { registerCustomShortcutCallback } = useGlobalShortcuts();
    // We can't use useSystemPrompts hook inside the callback directly because of stale closures,
    // but we can fetch fresh prompts from the DB when needed.

    useEffect(() => {
        // Register callbacks for all active workflows
        workflows.forEach(workflow => {
            if (workflow.trigger.type === "hotkey" && workflow.trigger.enabled) {
                registerCustomShortcutCallback(workflow.id, () => executeWorkflow(workflow));
            }
        });
    }, [workflows, registerCustomShortcutCallback]);

    const executeWorkflow = async (workflow: Workflow) => {
        console.log(`🚀 Starting workflow: ${workflow.name}`);

        let lastResult: any = null;
        let capturedImageBase64: string | null = null;
        let userPromptContext: string = "";

        try {
            for (const step of workflow.steps) {
                console.log(`Running step: ${step.type}`);

                if (step.type === "capture_region") {
                    // Capture the region defined in config
                    const { x, y, width, height, monitorIndex } = step.config;

                    // Use the silent capture command
                    const base64 = await invoke<string>("capture_area_silent", {
                        coords: { x, y, width, height },
                        monitorIndex: monitorIndex ?? 0
                    });
                    capturedImageBase64 = base64;
                    lastResult = base64;
                }
                else if (step.type === "ai_process") {
                    if (!capturedImageBase64) {
                        throw new Error("No image captured for AI process");
                    }

                    // Fetch the actual system prompt content
                    let systemPromptContent = defaultSystemPrompt;
                    if (step.config.systemPromptId) {
                        try {
                            // We fetch directly from DB to avoid hook rules/stale state issues in this async callback
                            const allPrompts = await getAllSystemPrompts();
                            const found = allPrompts.find(p => String(p.id) === String(step.config.systemPromptId));
                            if (found) {
                                systemPromptContent = found.prompt;
                            }
                        } catch (e) {
                            console.error("Failed to fetch system prompt, using default", e);
                        }
                    }

                    userPromptContext = step.config.prompt || "Analyze this image.";

                    // LM Studio Payload
                    const payload = {
                        model: step.config.model || "qwen2-vl-2b-instruct",
                        messages: [
                            {
                                role: "system",
                                content: systemPromptContent
                            },
                            {
                                role: "user",
                                content: [
                                    {
                                        type: "text",
                                        text: userPromptContext
                                    },
                                    {
                                        type: "image_url",
                                        image_url: {
                                            url: `data:image/png;base64,${capturedImageBase64}`
                                        }
                                    }
                                ]
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: -1,
                        stream: false
                    };

                    // Send to LM Studio (assuming localhost:1234)
                    const response = await fetch("http://localhost:1234/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        throw new Error(`AI Request failed: ${response.statusText}`);
                    }

                    const data = await response.json();
                    const aiText = data.choices?.[0]?.message?.content || "No response";
                    lastResult = aiText;
                }
                else if (step.type === "action_notification") {
                    const outputText = typeof lastResult === "string" ? lastResult : "Workflow completed";
                    const actionType = step.config.title; // We reused 'title' field for the dropdown selection

                    if (actionType === "Copy to Clipboard") {
                        try {
                            await navigator.clipboard.writeText(outputText);
                            // Optional: Show a small toast or notification that it was copied
                            if ("Notification" in window && Notification.permission === "granted") {
                                new Notification("Copied to Clipboard", { body: "AI response copied to clipboard" });
                            }
                        } catch (err) {
                            console.error("Failed to copy to clipboard:", err);
                        }
                    } else {
                        // Default: Show in Chat Overlay
                        const timestamp = Date.now();

                        // Create a new conversation or append to existing?
                        // For simplicity, let's create a new "Workflow Result" conversation for now,
                        // or better yet, just inject into the DB and let the UI pick it up if we reload.
                        // Ideally we want to append to the "current" conversation if one is open, but we don't have that ID here easily.
                        // So we create a new one.

                        const conversationId = crypto.randomUUID();
                        const userMsg = {
                            id: generateMessageId("user", timestamp),
                            role: "user" as const,
                            content: `[Workflow] ${userPromptContext}`, // Show what we asked
                            timestamp: timestamp
                        };
                        const aiMsg = {
                            id: generateMessageId("assistant", timestamp + 1),
                            role: "assistant" as const,
                            content: outputText,
                            timestamp: timestamp + 1
                        };

                        const newConversation = {
                            id: conversationId,
                            title: generateConversationTitle(userPromptContext) || "Workflow Result",
                            messages: [userMsg, aiMsg],
                            createdAt: timestamp,
                            updatedAt: timestamp
                        };

                        await saveConversation(newConversation);

                        // Open the dashboard to show the result
                        await invoke("open_dashboard");

                        // We might need to trigger a reload of the conversation list in the UI
                        // but since we just opened the dashboard, it might re-fetch. 
                        // If not, the user will see it in the history list.
                    }
                }
            }
        } catch (error) {
            console.error("Workflow execution failed:", error);
            if ("Notification" in window && Notification.permission === "granted") {
                new Notification("Workflow Failed", { body: String(error) });
            }
        }
    };
};
