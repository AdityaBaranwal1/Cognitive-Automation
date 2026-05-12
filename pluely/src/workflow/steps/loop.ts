import type { ReactNode } from "react";
import { createElement, Fragment } from "react";
import { Repeat } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { LoopStepConfig, WorkflowStep } from "@/types";

registerStep<LoopStepConfig>({
    type: "loop",
    label: "Loop",
    category: "flow",
    sideEffects: [],
    defaultConfig: () => ({ iterations: 3, children: [] }),
    summary: (c) => `${c?.iterations ?? 0} iterations`,
});

registerStepUI<LoopStepConfig>({
    type: "loop",
    icon: Repeat,
    color: "#3b82f6",
    tooltip: (config): ReactNode | null => {
        if (!config?.children?.length) return null;
        const head = config.children.slice(0, 4).map((c: WorkflowStep, i: number) =>
            createElement("div", { key: i }, `• ${c.type}`),
        );
        const tail =
            config.children.length > 4
                ? createElement(
                      "div",
                      { key: "more" },
                      `…and ${config.children.length - 4} more`,
                  )
                : null;
        return createElement(
            "div",
            { style: { fontSize: 10, color: "rgba(255,255,255,0.8)" } },
            createElement(
                "div",
                { style: { fontWeight: 600, marginBottom: 4 } },
                "Loop Steps:",
            ),
            createElement(Fragment, null, head, tail),
        );
    },
});
