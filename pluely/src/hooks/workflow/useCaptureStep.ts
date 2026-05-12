import { invoke } from "@tauri-apps/api/core";
import { WorkflowStep, WaitStepConfig, LoopStepConfig, AwaitInputStepConfig } from "@/types";
import { TYPE_PROVIDER } from "@/types/provider.type";
import { CapturedImage, ExecutionContext } from "./useWorkflowState";
import { Workflow } from "@/types";
import { registerAwaitInputKeys } from "@/lib/shortcuts/workflow-shortcuts";

/**
 * Execute a single non-AI step: capture, keypress, wait, loop, await_input.
 * Recursive for loop children. Returns the last result (e.g. base64 for captures).
 */
export const executeCaptureStep = async (
    step: WorkflowStep,
    context: ExecutionContext,
    allAiProviders: TYPE_PROVIDER[],
    defaultSystemPrompt: string,
    workflows: Workflow[],
    registerCustomShortcutCallback: (id: string, cb: () => void) => void,
    unregisterCustomShortcutCallback: (id: string) => void,
    executeStepFn: (step: WorkflowStep, ctx: ExecutionContext, providers: TYPE_PROVIDER[], sysprompt: string) => Promise<any>,
): Promise<any> => {
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
            base64,
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
        try {
            await invoke("send_keypress", { key, modifiers: modifiers.length > 0 ? modifiers : null });
            context.stepOutputs.push(`[Keypress: ${key}]`);
        } catch (e) {
            console.error("Keypress failed:", e);
            context.stepOutputs.push(`[Keypress Failed]`);
        }
    }
    else if (step.type === "wait") {
        const waitConfig = step.config as WaitStepConfig;
        await new Promise(resolve => setTimeout(resolve, waitConfig.durationMs));
        context.stepOutputs.push(`[Wait: ${waitConfig.durationMs}ms]`);
    }
    else if (step.type === "loop") {
        const loopConfig = step.config as LoopStepConfig;
        // v2 uses `body`; `children` is the deprecated v1 alias kept for
        // workflows that have not been re-saved through the migrator yet.
        const children = loopConfig.body ?? loopConfig.children ?? [];
        for (let i = 0; i < loopConfig.iterations; i++) {
            if (context.shouldStop) break;
            for (const childStep of children) {
                if (context.shouldStop) break;
                await executeStepFn(childStep, context, allAiProviders, defaultSystemPrompt);
            }
        }
        context.stepOutputs.push(`[Loop: ${loopConfig.iterations}x completed]`);
    }
    else if (step.type === "await_input") {
        lastResult = await executeAwaitInput(
            step, context, workflows,
            registerCustomShortcutCallback,
            unregisterCustomShortcutCallback,
            allAiProviders, defaultSystemPrompt, executeStepFn,
        );
    }

    return lastResult;
};

/** Await Input: human-in-the-loop dispatch center */
async function executeAwaitInput(
    step: WorkflowStep,
    context: ExecutionContext,
    workflows: Workflow[],
    registerCustomShortcutCallback: (id: string, cb: () => void) => void,
    unregisterCustomShortcutCallback: (id: string) => void,
    allAiProviders: TYPE_PROVIDER[],
    defaultSystemPrompt: string,
    executeStepFn: (step: WorkflowStep, ctx: ExecutionContext, providers: TYPE_PROVIDER[], sysprompt: string) => Promise<any>,
): Promise<any> {
    const awaitConfig = step.config as AwaitInputStepConfig;
    let awaitKeyPressed: string | null = null;

    // Register await keys as system hotkeys via the shared module.
    const awaitHandle = await registerAwaitInputKeys(
        awaitConfig.keymap.map((k) => ({
            key: k.key,
            actionId: `await_${step.id}_${k.key}`,
        })),
    );

    // Register temporary JS-side callbacks
    const cleanupFns: (() => void)[] = [];
    for (const keyAction of awaitConfig.keymap) {
        const callbackId = `await_${step.id}_${keyAction.key}`;
        registerCustomShortcutCallback(callbackId, () => {
            awaitKeyPressed = keyAction.key;
        });
        cleanupFns.push(() => unregisterCustomShortcutCallback(callbackId));
    }

    // Main await loop
    let continueListening = true;
    while (continueListening && !context.shouldStop) {
        awaitKeyPressed = null;
        const startTime = Date.now();
        const timeout = awaitConfig.timeout || 0;

        while (!awaitKeyPressed && !context.shouldStop) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (timeout > 0 && Date.now() - startTime > timeout) {
                continueListening = false;
                break;
            }
        }
        if (!awaitKeyPressed || context.shouldStop) break;

        const pressedAction = awaitConfig.keymap.find(a => a.key === awaitKeyPressed);
        if (!pressedAction) continue;

        if (pressedAction.action === "run_workflow") {
            const subWorkflow = workflows.find(w => w.id === pressedAction.workflowId);
            if (subWorkflow) {
                for (const subStep of subWorkflow.steps) {
                    if (context.shouldStop) break;
                    await executeStepFn(subStep, context, allAiProviders, defaultSystemPrompt);
                }
            }
        } else if (pressedAction.action === "keypress" && pressedAction.keypressConfig) {
            try {
                await invoke("send_keypress", {
                    key: pressedAction.keypressConfig.key,
                    modifiers: pressedAction.keypressConfig.modifiers || null
                });
            } catch (e) {
                console.error("Keypress failed:", e);
            }
        } else if (pressedAction.action === "continue") {
            continueListening = false;
        } else if (pressedAction.action === "break") {
            context.shouldStop = true;
            continueListening = false;
        }
    }

    // Cleanup
    cleanupFns.forEach(fn => fn());
    context.stepOutputs.push(`[Await Input completed]`);
    await awaitHandle.dispose();

    return null;
}
