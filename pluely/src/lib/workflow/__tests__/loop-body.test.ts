import { describe, expect, it } from "vitest";
import { getLoopBody } from "../loop-body";
import { migrate } from "../migrations";

const step = (id: string) => ({ id, type: "wait", config: { durationMs: 1 } });

describe("getLoopBody", () => {
    it("reads v2 body", () => {
        expect(getLoopBody({ iterations: 2, body: [step("a")] })).toHaveLength(1);
    });

    it("falls back to the v1 children alias", () => {
        expect(getLoopBody({ iterations: 2, children: [step("a"), step("b")] })).toHaveLength(2);
    });

    it("prefers body over children", () => {
        const body = getLoopBody({ body: [step("b")], children: [step("c1"), step("c2")] });
        expect(body.map((s) => s.id)).toEqual(["b"]);
    });

    it("returns [] for missing config", () => {
        expect(getLoopBody(undefined)).toEqual([]);
    });

    it("sees the steps of a loop after v1 -> v2 migration", () => {
        const wf = migrate({
            id: "w",
            name: "w",
            trigger: { type: "hotkey", key: "F8", enabled: true },
            steps: [{ id: "l", type: "loop", config: { iterations: 3, children: [step("x"), step("y")] } }],
        });
        expect(getLoopBody(wf.steps[0].config).map((s) => s.id)).toEqual(["x", "y"]);
    });
});
