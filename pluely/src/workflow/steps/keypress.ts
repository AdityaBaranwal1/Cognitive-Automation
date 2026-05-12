import { Keyboard } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { KeypressStepConfig } from "@/types";

registerStep<KeypressStepConfig>({
    type: "keypress",
    label: "Keypress",
    category: "input",
    sideEffects: ["input"],
    defaultConfig: () => ({ key: "PageDown", modifiers: [] }),
    summary: (c) => c?.key || "Key",
});

registerStepUI<KeypressStepConfig>({
    type: "keypress",
    icon: Keyboard,
    color: "#06b6d4",
});
