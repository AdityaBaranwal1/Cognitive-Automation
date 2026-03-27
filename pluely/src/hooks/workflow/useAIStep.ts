import { invoke } from "@tauri-apps/api/core";
import { AIStepConfig, Workflow } from "@/types";
import { TYPE_PROVIDER } from "@/types/provider.type";
import { getAllSystemPrompts, fetchAIResponse } from "@/lib";
import { injectKeychainKey, resolveFromSavedConfig } from "@/lib/functions/provider-resolver.function";
import {
    ExecutionContext,
    FALLBACK_LM_STUDIO_PROVIDER,
    interpolateVariables,
} from "./useWorkflowState";

export interface AIStepResult {
    fullResponse: string;
    providerId: string;
    model: string | undefined;
    userPromptContext: string;
}

/**
 * Execute an AI process step: resolve provider, build prompt, call LLM, log usage.
 */
export const executeAIStep = async (
    aiConfig: AIStepConfig,
    context: ExecutionContext,
    allAiProviders: TYPE_PROVIDER[],
    defaultSystemPrompt: string,
    workflow: Workflow,
    shouldStopFn?: () => boolean,
): Promise<AIStepResult> => {
    if (context.captures.length === 0) {
        console.warn("No images captured for AI process.");
    }

    // --- Provider resolution ---
    const providerId = aiConfig.providerId || "lm-studio";

    // Try resolving as a SavedProviderConfig first (UUID-based)
    const savedResolution = await resolveFromSavedConfig(providerId);

    let providerConfig: TYPE_PROVIDER;
    let resolvedVars: Record<string, string> | null = null;
    if (savedResolution) {
        providerConfig = savedResolution.provider;
        resolvedVars = savedResolution.selectedProvider.variables;
    } else {
        // Fall back to legacy provider lookup
        const legacy = allAiProviders.find(p => p.id === providerId);
        if (!legacy && providerId === "lm-studio") {
            providerConfig = FALLBACK_LM_STUDIO_PROVIDER;
        } else if (!legacy) {
            throw new Error(`Provider ${providerId} not found.`);
        } else {
            providerConfig = legacy;
        }
    }

    // --- System prompt lookup ---
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

    // --- User prompt interpolation ---
    let rawPrompt = aiConfig.prompt;
    if (!rawPrompt || rawPrompt.trim() === "") {
        if (aiConfig.systemPromptId) {
            rawPrompt = " ";
        } else {
            const lastRealOutput = context.stepOutputs
                .slice()
                .reverse()
                .find(o => !o.startsWith("[Image") && !o.startsWith("[Keypress") && !o.startsWith("[Wait") && !o.startsWith("[Loop") && !o.startsWith("[Await"));
            rawPrompt = lastRealOutput || "Analyze this image.";
        }
    }
    const userPromptContext = interpolateVariables(rawPrompt, context.stepOutputs);

    // --- Image stitching ---
    let imagesForAI: string[] = context.captures.map(c => c.base64);
    let wasStitched = false;

    if (aiConfig.stitchImages && context.captures.length > 1) {
        try {
            const stitched: string = await invoke("stitch_images_vertical", {
                imagesBase64: imagesForAI,
                maxCount: aiConfig.stitchMaxCount ?? 5,
                scaleFactor: aiConfig.stitchScaleFactor ?? 1.0
            });
            imagesForAI = [stitched];
            wasStitched = true;
        } catch (e) {
            console.error("Stitch failed:", e);
        }
    }

    // --- Call LLM ---
    let fullResponse = "";
    // Use pre-resolved vars from SavedProviderConfig, or inject from keychain
    const aiStepVars = resolvedVars ?? await injectKeychainKey(providerId, {
        model: aiConfig.model || "qwen/qwen3-vl-8b",
        api_key: providerConfig.variables?.["api_key"] || providerConfig.variables?.["API_KEY"] || "",
        ...(providerConfig.variables || {})
    });
    const generator = fetchAIResponse({
        provider: providerConfig,
        selectedProvider: {
            provider: providerId,
            variables: aiStepVars
        },
        systemPrompt: systemPromptContent,
        userMessage: userPromptContext,
        imagesBase64: imagesForAI,
        history: [],
        skipResponseSettings: true,
        outputRules: aiConfig.outputRules,
    });

    for await (const chunk of generator) {
        fullResponse += chunk;
        if (shouldStopFn?.()) {
            console.log("Emergency stop detected during AI streaming — aborting");
            break;
        }
    }

    // --- Error detection ---
    if (
        fullResponse.startsWith("Network error") ||
        fullResponse.startsWith("API request failed") ||
        fullResponse.startsWith("Failed to parse") ||
        fullResponse.startsWith("Missing required variable") ||
        fullResponse.trim() === ""
    ) {
        throw new Error(fullResponse.trim() || "AI returned empty response (server may be offline)");
    }

    const imageStatus = wasStitched
        ? `Sent 1 STITCHED image (from ${context.captures.length} captures)`
        : `Sent ${imagesForAI.length} image(s)`;
    console.log("AI Response:", fullResponse.substring(0, 200) + "...");
    console.log(imageStatus);

    // --- Log API usage ---
    try {
        const { logApiUsage } = await import("@/lib/storage/api-usage.storage");
        const estimatedTokens = Math.ceil(fullResponse.length / 4);
        logApiUsage({
            providerId,
            model: aiConfig.model || "unknown",
            promptTokens: 0,
            completionTokens: estimatedTokens,
            totalTokens: estimatedTokens,
            workflowId: workflow.id,
            workflowName: workflow.name,
        });
    } catch (e) {
        console.warn("Failed to log API usage:", e);
    }

    context.stepOutputs.push(fullResponse);

    return { fullResponse, providerId, model: aiConfig.model, userPromptContext };
};
