import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useConfig, useWorkflow } from "@/contexts";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { Workflow, AIStepConfig, WorkflowStep, WorkflowExecutionStatus } from "@/types";
import { saveConversation, generateMessageId, generateConversationTitle } from "@/lib";
import { TYPE_PROVIDER } from "@/types/provider.type";

import { ExecutionContext, createExecutionContext, createEmitProgress } from "./workflow/useWorkflowState";
import { executeCaptureStep } from "./workflow/useCaptureStep";
import { executeAIStep } from "./workflow/useAIStep";

// Re-export types for consumers
export type { CapturedImage, ExecutionContext } from "./workflow/useWorkflowState";

export const useWorkflowRunner = () => {
    const { systemPrompt: defaultSystemPrompt, allAiProviders } = useConfig();
    const { workflows, setWorkflowExecution } = useWorkflow();
    const { registerCustomShortcutCallback, unregisterCustomShortcutCallback } = useGlobalShortcuts();

    const shouldStopRef = useRef(false);

    useEffect(() => {
        workflows.forEach(workflow => {
            if (workflow.trigger.type === "hotkey" && workflow.trigger.enabled) {
                registerCustomShortcutCallback(workflow.id, () => executeWorkflow(workflow));
            }
        });
    }, [workflows, registerCustomShortcutCallback]);

    /** Dispatch a single step to the appropriate handler */
    const executeStep = async (
        step: WorkflowStep,
        context: ExecutionContext,
        providers: TYPE_PROVIDER[],
        sysprompt: string,
    ): Promise<any> => {
        return executeCaptureStep(
            step, context, providers, sysprompt,
            workflows, registerCustomShortcutCallback,
            unregisterCustomShortcutCallback, executeStep,
        );
    };

    const executeWorkflow = async (workflow: Workflow) => {
        const currentWindow = await import("@tauri-apps/api/window").then(m => m.getCurrentWindow());
        if (currentWindow.label !== "main") return;

        console.log(`[${currentWindow.label}] Starting workflow: ${workflow.name}`);

        let lastResult: any = null;
        let userPromptContext: string = "";
        let lastProviderId: string | undefined = undefined;
        let lastModel: string | undefined = undefined;
        const context: ExecutionContext = createExecutionContext();

        shouldStopRef.current = false;
        const stopActionId = `${workflow.id}_stop`;
        if (workflow.trigger.emergencyStopKey) {
            registerCustomShortcutCallback(stopActionId, () => {
                shouldStopRef.current = true;
            });
        }

        const emitProgress = createEmitProgress(workflow, setWorkflowExecution);
        emitProgress({ status: "running" });

        let hadError = false;
        try {
            for (let i = 0; i < workflow.steps.length; i++) {
                const step = workflow.steps[i];
                context.shouldStop = shouldStopRef.current;
                if (context.shouldStop) break;

                if (step.type === "ai_process") {
                    emitProgress({
                        activeStepId: step.id,
                        activeStepType: step.type,
                        activeStepIndex: i,
                        status: "ai_thinking",
                    });

                    const aiConfig = step.config as AIStepConfig;
                    const result = await executeAIStep(
                        aiConfig, context, allAiProviders, defaultSystemPrompt, workflow,
                        () => shouldStopRef.current,
                    );
                    lastResult = result.fullResponse;
                    userPromptContext = result.userPromptContext;
                    lastProviderId = result.providerId;
                    lastModel = result.model;
                }
                else if (step.type === "action_notification" || step.type === "system_action") {
                    emitProgress({
                        activeStepId: step.id,
                        activeStepType: step.type,
                        activeStepIndex: i,
                        status: "running",
                    });

                    const outputText = typeof lastResult === "string" ? lastResult : JSON.stringify(lastResult);
                    const actionConfig = step.config as any;
                    const isCopy = actionConfig.title === "Copy to Clipboard" || actionConfig.action === "copy_to_clipboard";

                    if (isCopy) {
                        await navigator.clipboard.writeText(outputText);
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification("Copied to Clipboard", { body: "AI response copied" });
                        }
                    } else {
                        await saveWorkflowConversation(
                            userPromptContext, outputText, context,
                            lastProviderId, lastModel,
                        );
                        await invoke("open_dashboard");
                    }
                    context.stepOutputs.push("Action Executed");
                }
                else {
                    let stepStatus: WorkflowExecutionStatus = "running";
                    if (step.type === "capture_region" || step.type === "capture_screen") {
                        stepStatus = "capturing";
                    } else if (step.type === "wait") {
                        stepStatus = "waiting";
                    }
                    emitProgress({
                        activeStepId: step.id,
                        activeStepType: step.type,
                        activeStepIndex: i,
                        status: stepStatus,
                    });
                    context.shouldStop = shouldStopRef.current;
                    const result = await executeStep(step, context, allAiProviders, defaultSystemPrompt);
                    if (result) lastResult = result;
                }
            }
        } catch (error) {
            hadError = true;
            console.error("Workflow execution failed:", error);
            emitProgress({
                status: "error",
                error: error instanceof Error ? error.message : String(error),
            });
            setTimeout(() => {
                setWorkflowExecution(null);
                emit("workflow-execution-update", null).catch(() => { });
            }, 5000);
        } finally {
            if (workflow.trigger.emergencyStopKey) {
                unregisterCustomShortcutCallback(stopActionId);
            }
            if (!hadError) {
                emitProgress({ status: "completed", activeStepId: null, activeStepType: null });
                setTimeout(() => {
                    setWorkflowExecution(null);
                    emit("workflow-execution-update", null).catch(() => { });
                }, 3000);
            }
        }
    };

    return { executeWorkflow };
};

/** Save a workflow result as a conversation */
async function saveWorkflowConversation(
    userPromptContext: string,
    outputText: string,
    context: ExecutionContext,
    lastProviderId: string | undefined,
    lastModel: string | undefined,
) {
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
                timestamp,
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
        providerId: lastProviderId,
        model: lastModel
    });
}
