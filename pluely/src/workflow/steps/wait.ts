import { Clock } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { WaitStepConfig } from "@/types";

registerStep<WaitStepConfig>({
    type: "wait",
    label: "Wait",
    category: "flow",
    sideEffects: [],
    defaultConfig: () => ({ durationMs: 500 }),
    summary: (c) => `${c?.durationMs ?? 500}ms`,
});

registerStepUI<WaitStepConfig>({
    type: "wait",
    icon: Clock,
    color: "#f59e0b",
});
