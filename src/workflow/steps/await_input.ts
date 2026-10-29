import { z } from "zod";
import type { ReactNode } from "react";
import { createElement, Fragment } from "react";
import { Pause } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { AwaitInputStepConfig, AwaitInputKeyAction } from "@/types";

const AwaitInputKeyActionSchema = z
    .object({
        key: z.string().min(1),
        action: z.enum(["run_workflow", "keypress", "continue", "break"]),
        workflowId: z.string().optional(),
        keypressConfig: z
            .object({ key: z.string(), modifiers: z.array(z.string()).optional() })
            .optional(),
        label: z.string().optional(),
    })
    .passthrough();

const AwaitInputConfigSchema = z
    .object({
        timeout: z.number().int().min(0).optional(),
        keymap: z.array(AwaitInputKeyActionSchema).min(1),
    })
    .passthrough();

registerStep<AwaitInputStepConfig>({
    type: "await_input",
    label: "Await Input",
    category: "flow",
    sideEffects: ["hotkey"],
    configSchema: AwaitInputConfigSchema,
    defaultConfig: () => ({
        timeout: 0,
        keymap: [{ key: "F6", action: "continue", label: "Done" }],
    }),
    summary: (c) => c?.keymap?.map((k) => k.key).join(", ") || "No keys",
});

registerStepUI<AwaitInputStepConfig>({
    type: "await_input",
    icon: Pause,
    color: "#ec4899",
    tooltip: (config): ReactNode | null => {
        if (!config?.keymap?.length) return null;
        const rows = config.keymap.map((k: AwaitInputKeyAction, i: number) =>
            createElement(
                "div",
                {
                    key: i,
                    style: {
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 10,
                        color: "rgba(255,255,255,0.8)",
                    },
                },
                createElement(
                    "span",
                    {
                        style: {
                            background: "rgba(255,255,255,0.1)",
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontFamily: "monospace",
                            fontWeight: 600,
                        },
                    },
                    k.key || "?",
                ),
                createElement("span", { style: { color: "#ec4899" } }, "→"),
                createElement("span", null, k.label || k.action),
            ),
        );
        return createElement(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 6 } },
            createElement(
                "div",
                {
                    style: {
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#fff",
                        marginBottom: 2,
                    },
                },
                "Key Bindings",
            ),
            createElement(Fragment, null, rows),
        );
    },
});
