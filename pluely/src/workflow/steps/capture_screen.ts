import { z } from "zod";
import { Camera } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { CaptureStepConfig } from "@/types";

type Config = CaptureStepConfig & { monitorIndex?: number };

const CaptureScreenConfigSchema = z
    .object({
        mode: z.enum(["fullscreen", "window", "area", "fixed"]),
        monitorIndex: z.number().int().min(0).optional(),
    })
    .passthrough();

registerStep<Config>({
    type: "capture_screen",
    label: "Capture Screen",
    category: "capture",
    sideEffects: ["screen-read"],
    configSchema: CaptureScreenConfigSchema,
    defaultConfig: () => ({ mode: "fullscreen", monitorIndex: 0 }),
    summary: () => "Fullscreen",
});

registerStepUI<Config>({
    type: "capture_screen",
    icon: Camera,
    color: "#22c55e",
});
