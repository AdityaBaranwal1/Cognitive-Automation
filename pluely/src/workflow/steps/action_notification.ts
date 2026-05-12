import { Send } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { ActionNotificationConfig } from "@/types";

registerStep<ActionNotificationConfig>({
    type: "action_notification",
    label: "Output Action",
    category: "action",
    sideEffects: ["clipboard", "ui-overlay"],
    defaultConfig: () => ({ title: "Show in Chat Overlay" }),
    summary: (c) => {
        const title = c?.title || "Output";
        return title.length > 18 ? title.slice(0, 18) + "…" : title;
    },
});

registerStepUI<ActionNotificationConfig>({
    type: "action_notification",
    icon: Send,
    color: "#6366f1",
});
