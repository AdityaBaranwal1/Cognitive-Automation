import { z } from "zod";
import { Keyboard } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { KeypressStepConfig } from "@/types";

const KeypressConfigSchema = z
    .object({
        key: z.string().min(1),
        modifiers: z.array(z.enum(["ctrl", "alt", "shift", "win", "meta"])).optional(),
    })
    .passthrough();

registerStep<KeypressStepConfig>({
    type: "keypress",
    label: "Keypress",
    category: "input",
    sideEffects: ["input"],
    configSchema: KeypressConfigSchema,
    defaultConfig: () => ({ key: "PageDown", modifiers: [] }),
    summary: (c) => c?.key || "Key",
});

registerStepUI<KeypressStepConfig>({
    type: "keypress",
    icon: Keyboard,
    color: "#06b6d4",
});
