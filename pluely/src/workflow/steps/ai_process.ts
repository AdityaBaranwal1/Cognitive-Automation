import { z } from "zod";
import { Brain } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { AIStepConfig } from "@/types";

const AIStepConfigSchema = z
    .object({
        providerId: z.string().min(1),
        model: z.string().min(1),
        prompt: z.string(),
        systemPromptId: z.string().optional(),
        profileId: z.string().optional(),
        outputRules: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().min(1).optional(),
        stitchImages: z.boolean().optional(),
        stitchMaxCount: z.number().int().min(1).max(50).optional(),
        stitchScaleFactor: z.number().min(0.1).max(1.0).optional(),
    })
    .passthrough();

registerStep<AIStepConfig>({
    type: "ai_process",
    label: "AI Process",
    category: "ai",
    sideEffects: ["network"],
    configSchema: AIStepConfigSchema,
    defaultConfig: () => ({
        prompt: "",
        model: "qwen2-vl-2b-instruct",
        providerId: "lm-studio",
    }),
    summary: (c) => {
        const provider = c?.providerId || "provider";
        const model = c?.model || "model";
        const shortModel = model.length > 15 ? model.slice(0, 15) + "…" : model;
        return `${provider} / ${shortModel}`;
    },
});

registerStepUI<AIStepConfig>({
    type: "ai_process",
    icon: Brain,
    color: "#8b5cf6",
});
