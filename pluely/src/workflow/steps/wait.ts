import { z } from "zod";
import { Clock } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { WaitStepConfig } from "@/types";

const WaitConfigSchema = z
    .object({
        durationMs: z.number().int().min(0).max(600_000),
    })
    .passthrough();

registerStep<WaitStepConfig>({
    type: "wait",
    label: "Wait",
    category: "flow",
    sideEffects: [],
    configSchema: WaitConfigSchema,
    defaultConfig: () => ({ durationMs: 500 }),
    summary: (c) => `${c?.durationMs ?? 500}ms`,
});

registerStepUI<WaitStepConfig>({
    type: "wait",
    icon: Clock,
    color: "#f59e0b",
});
