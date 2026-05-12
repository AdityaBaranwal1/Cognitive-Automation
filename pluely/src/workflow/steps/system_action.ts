import { z } from "zod";
import { Zap } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { SystemActionConfig } from "@/types";

const SystemActionConfigSchema = z
    .object({
        action: z.enum(["copy_to_clipboard", "save_to_file", "open_url", "run_command", "notification"]),
        value: z.string(),
    })
    .passthrough();

// Vestigial step type in v1 — keeps it visible to the registry so legacy
// workflows render correctly. Phase 1 migration normalizes it into
// `action_notification` with the explicit OutputAction enum.
registerStep<SystemActionConfig>({
    type: "system_action",
    label: "System Action",
    category: "action",
    sideEffects: ["clipboard", "fs", "ui-overlay"],
    configSchema: SystemActionConfigSchema,
    defaultConfig: () => ({ action: "copy_to_clipboard", value: "" }),
    summary: (c) => c?.action || "system_action",
});

registerStepUI<SystemActionConfig>({
    type: "system_action",
    icon: Zap,
    color: "#ef4444",
});
