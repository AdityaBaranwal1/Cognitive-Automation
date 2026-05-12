import { describe, it, expect } from "vitest";
import v1 from "./workflow-v1.json";

describe("workflow-v1 fixture", () => {
    it("loads as JSON and covers every v1 step type (including deprecated ones)", () => {
        expect(v1).toBeTruthy();
        expect(Array.isArray(v1.steps)).toBe(true);
        const types = new Set(v1.steps.map((s) => s.type));
        for (const required of [
            "capture_region",
            "capture_screen",
            "ai_process",
            "keypress",
            "wait",
            "loop",
            "await_input",
            "action_notification",
            // Deprecated v1 types — must round-trip through the migrator in Phase 1
            "system_action",
            "delay",
        ]) {
            expect(types.has(required)).toBe(true);
        }
    });

    it("has a loop step with nested children (recursive shape)", () => {
        const loop = v1.steps.find((s) => s.type === "loop");
        expect(loop).toBeTruthy();
        expect(Array.isArray((loop as { config: { children: unknown[] } }).config.children)).toBe(true);
    });

    it("has no schemaVersion field (this is v1)", () => {
        expect((v1 as { schemaVersion?: unknown }).schemaVersion).toBeUndefined();
    });
});
