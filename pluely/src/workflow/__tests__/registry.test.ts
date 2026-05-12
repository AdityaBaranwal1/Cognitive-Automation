import { describe, it, expect, beforeAll } from "vitest";
import { allSteps, validateStepConfig, getStepDefaults } from "../core/registry";

// Side-effecting import — registers all built-in step types.
beforeAll(async () => {
    await import("../steps");
});

describe("step registry", () => {
    it("registers all 9 built-in step types", () => {
        const types = new Set(allSteps().map((d) => d.type));
        for (const required of [
            "capture_region",
            "capture_screen",
            "ai_process",
            "keypress",
            "wait",
            "loop",
            "await_input",
            "action_notification",
            "system_action",
        ]) {
            expect(types.has(required as never)).toBe(true);
        }
    });

    it("each step's defaultConfig validates against its own configSchema", () => {
        for (const def of allSteps()) {
            const result = validateStepConfig(def.type, def.defaultConfig());
            expect(result.ok, `${def.type} default config failed: ${
                result.ok ? "" : result.errors.join("; ")
            }`).toBe(true);
        }
    });

    it("returns ok for unknown step types (never blocks)", () => {
        const result = validateStepConfig("totally-unknown" as never, {});
        expect(result.ok).toBe(true);
    });

    it("rejects a malformed wait config", () => {
        const result = validateStepConfig("wait", { durationMs: "five hundred" } as unknown);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors[0]).toMatch(/durationMs/);
        }
    });

    it("rejects a missing required field on ai_process", () => {
        const result = validateStepConfig("ai_process", { prompt: "" } as unknown);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.some((e) => /providerId|model/.test(e))).toBe(true);
        }
    });

    it("accepts unknown extra fields via passthrough", () => {
        const result = validateStepConfig("wait", { durationMs: 100, extra: "fine" });
        expect(result.ok).toBe(true);
    });

    it("getStepDefaults returns the registered defaults", () => {
        expect(getStepDefaults("wait")).toEqual({ durationMs: 500 });
    });
});
