import { describe, it, expect } from "vitest";
import { migrate } from "../migrations";
import v1 from "@/test/fixtures/workflow-v1.json";
import type { Workflow, LoopStepConfig } from "@/types";
import { WORKFLOW_SCHEMA_VERSION } from "@/types";

describe("migrate(v1)", () => {
    const w: Workflow = migrate(v1);

    it("stamps schemaVersion to v2", () => {
        expect(w.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
    });

    it("preserves all step ids", () => {
        const v1Ids = (v1.steps as Array<{ id: string }>).map((s) => s.id);
        const v2Ids = w.steps.map((s) => s.id);
        expect(v2Ids).toEqual(v1Ids);
    });

    it("auto-generates a slug-cased key from name when key is absent", () => {
        const aiStep = w.steps.find((s) => s.type === "ai_process");
        expect(aiStep).toBeTruthy();
        expect(aiStep!.key).toBeTruthy();
        expect(aiStep!.key).toMatch(/^[a-z_][a-z0-9_]*$/);
    });

    it("renames loop.children to loop.body and migrates nested children", () => {
        const loop = w.steps.find((s) => s.type === "loop");
        expect(loop).toBeTruthy();
        const cfg = loop!.config as LoopStepConfig;
        expect(Array.isArray(cfg.body)).toBe(true);
        expect(cfg.body!.length).toBeGreaterThan(0);
        // The legacy `children` field should be gone on the v2 shape we wrote.
        expect((cfg as { children?: unknown }).children).toBeUndefined();
    });

    it("rewrites delay -> wait while preserving durationMs", () => {
        const delays = w.steps.filter((s) => s.type === "delay");
        expect(delays.length).toBe(0);
        // The fixture's legacy delay step had durationMs: 750 — find that wait now.
        const wait750 = w.steps.find(
            (s) => s.type === "wait" && (s.config as { durationMs: number }).durationMs === 750,
        );
        expect(wait750).toBeTruthy();
    });

    it("rewrites system_action(copy_to_clipboard) -> action_notification(Copy to Clipboard)", () => {
        const systemActions = w.steps.filter((s) => s.type === "system_action");
        // The fixture's only system_action used copy_to_clipboard -> should be gone.
        expect(systemActions.length).toBe(0);
        const copies = w.steps.filter(
            (s) =>
                s.type === "action_notification" &&
                (s.config as { title?: string }).title === "Copy to Clipboard",
        );
        expect(copies.length).toBeGreaterThanOrEqual(1);
    });

    it("defaults allowedHosts to an empty list", () => {
        expect(Array.isArray(w.allowedHosts)).toBe(true);
        expect(w.allowedHosts!.length).toBe(0);
    });

    it("is idempotent on a v2 workflow (round-trip equality on shape)", () => {
        const once = migrate(v1);
        const twice = migrate(JSON.parse(JSON.stringify(once)));
        expect(twice).toEqual(once);
    });

    it("survives malformed input without throwing", () => {
        expect(() => migrate(null)).not.toThrow();
        expect(() => migrate(undefined)).not.toThrow();
        expect(() => migrate({})).not.toThrow();
        expect(() => migrate({ steps: [{ type: "totally-unknown" }] })).not.toThrow();
    });

    it("dedupes auto-generated keys when two steps share a name", () => {
        const result = migrate({
            id: "x",
            steps: [
                { id: "1", type: "wait", name: "Wait a bit", config: { durationMs: 100 } },
                { id: "2", type: "wait", name: "Wait a bit", config: { durationMs: 200 } },
            ],
        });
        const keys = result.steps.map((s) => s.key);
        expect(keys[0]).toBe("wait_a_bit");
        expect(keys[1]).toBe("wait_a_bit_2");
    });

    it("prefixes leading-digit slugs with underscore for expression safety", () => {
        const result = migrate({
            id: "x",
            steps: [
                { id: "1", type: "wait", name: "1st step", config: { durationMs: 100 } },
            ],
        });
        expect(result.steps[0].key).toBe("_1st_step");
        // Result must match the expression-binding regex.
        expect(result.steps[0].key).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
    });
});
