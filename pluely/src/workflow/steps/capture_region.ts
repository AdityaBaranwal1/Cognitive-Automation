import { z } from "zod";
import { Camera } from "lucide-react";
import { registerStep } from "../core/registry";
import { registerStepUI } from "../ui/registry-ui";
import type { CaptureStepConfig } from "@/types";

type Config = CaptureStepConfig & {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    monitorIndex?: number;
};

const CaptureRegionConfigSchema = z
    .object({
        mode: z.enum(["fullscreen", "window", "area", "fixed"]),
        x: z.number().int().min(0).optional(),
        y: z.number().int().min(0).optional(),
        width: z.number().int().min(0).optional(),
        height: z.number().int().min(0).optional(),
        monitorIndex: z.number().int().min(0).optional(),
    })
    .passthrough();

registerStep<Config>({
    type: "capture_region",
    label: "Capture Region",
    category: "capture",
    sideEffects: ["screen-read"],
    configSchema: CaptureRegionConfigSchema,
    defaultConfig: () => ({ x: 0, y: 0, width: 0, height: 0, mode: "fixed" }),
    summary: (c) => {
        if (c?.width && c?.height) return `${c.width}×${c.height}`;
        return "Region not set";
    },
});

registerStepUI<Config>({
    type: "capture_region",
    icon: Camera,
    color: "#22c55e",
});
