import { Camera } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { CaptureStepConfig } from "@/types";

type Config = CaptureStepConfig & { monitorIndex?: number };

registerStep<Config>({
    type: "capture_screen",
    label: "Capture Screen",
    category: "capture",
    sideEffects: ["screen-read"],
    defaultConfig: () => ({ mode: "fullscreen", monitorIndex: 0 }),
    summary: () => "Fullscreen",
});

registerStepUI<Config>({
    type: "capture_screen",
    icon: Camera,
    color: "#22c55e",
});
