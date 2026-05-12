import { Brain } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { AIStepConfig } from "@/types";

registerStep<AIStepConfig>({
    type: "ai_process",
    label: "AI Process",
    category: "ai",
    sideEffects: ["network"],
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
