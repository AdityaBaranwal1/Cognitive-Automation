import { Zap } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { SystemActionConfig } from "@/types";

// Vestigial step type in v1 — keeps it visible to the registry so legacy
// workflows render correctly. Phase 1 migration normalizes it into
// `action_notification` with the explicit OutputAction enum.
registerStep<SystemActionConfig>({
    type: "system_action",
    label: "System Action",
    category: "action",
    sideEffects: ["clipboard", "fs", "ui-overlay"],
    defaultConfig: () => ({ action: "copy_to_clipboard", value: "" }),
    summary: (c) => c?.action || "system_action",
});

registerStepUI<SystemActionConfig>({
    type: "system_action",
    icon: Zap,
    color: "#ef4444",
});
