/**
 * Workflow step registry — runtime side.
 *
 * StepDefinition records have NO React and NO lucide imports — they're safe
 * for the runner, tests, and any non-UI consumer. The UI half (icon, color,
 * tooltip, editor) lives in ../ui/registry-ui.ts, linked by `type` string.
 *
 * Phase 0.5.4 lands the shell with metadata + defaults + summary.
 * Phase 2a will add `configSchema` (Zod).
 * Phase 2b will add `execute` to flip dispatch off the if-chain in
 * useWorkflowRunner / useCaptureStep.
 */

import type { ZodTypeAny } from "zod";
import type { WorkflowStep, StepType } from "@/types";

export type StepCategory = "capture" | "input" | "ai" | "flow" | "data" | "action";

export type SideEffect =
    | "input"           // keystrokes / mouse
    | "network"         // outbound HTTP
    | "fs"              // file I/O
    | "clipboard"
    | "screen-read"
    | "ui-overlay"      // shows the dashboard / a notification
    | "hotkey";

export interface StepDefinition<C = unknown> {
    type: StepType;
    label: string;
    category: StepCategory;
    sideEffects: SideEffect[];
    /**
     * Runtime-only Zod schema for the step's config. NEVER persisted; used at
     * save time (and in Phase 2b at execute time) to validate user-supplied data.
     * Optional during Phase 2a's rollout — steps without a schema bypass
     * validation today and gain it incrementally as schemas are authored.
     */
    configSchema?: ZodTypeAny;
    defaultConfig: () => C;
    /** Single-line plain-string summary for logs / headers / graph node labels. */
    summary: (config: C) => string;
}

const REGISTRY = new Map<StepType, StepDefinition>();

export function registerStep<C>(def: StepDefinition<C>): void {
    REGISTRY.set(def.type, def as StepDefinition);
}

export function getStep(type: StepType): StepDefinition | undefined {
    return REGISTRY.get(type);
}

export function allSteps(): StepDefinition[] {
    return Array.from(REGISTRY.values());
}

export function getStepLabel(type: StepType): string {
    return REGISTRY.get(type)?.label ?? type;
}

export function getStepDefaults(type: StepType): unknown {
    return REGISTRY.get(type)?.defaultConfig() ?? {};
}

export function getStepSummary(step: WorkflowStep): string {
    const def = REGISTRY.get(step.type);
    if (!def) return step.type;
    try {
        return def.summary(step.config as never);
    } catch {
        return def.label;
    }
}

export type StepValidationResult =
    | { ok: true }
    | { ok: false; errors: string[] };

/**
 * Validate a step's `config` against its registered Zod schema.
 *
 * Returns `{ ok: true }` for steps whose registry entry has no `configSchema`
 * yet (Phase 2a's rollout is incremental — schemas are added per step).
 * Returns `{ ok: true }` for unknown step types so this never blocks a
 * round-trip through the migrator.
 */
export function validateStepConfig(
    type: StepType,
    config: unknown,
): StepValidationResult {
    const def = REGISTRY.get(type);
    if (!def?.configSchema) return { ok: true };
    const result = def.configSchema.safeParse(config);
    if (result.success) return { ok: true };
    return {
        ok: false,
        errors: result.error.issues.map(
            (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
        ),
    };
}

export function stepsByCategory(): Record<StepCategory, StepDefinition[]> {
    const out: Record<StepCategory, StepDefinition[]> = {
        capture: [],
        input: [],
        ai: [],
        flow: [],
        data: [],
        action: [],
    };
    for (const def of REGISTRY.values()) {
        out[def.category].push(def);
    }
    return out;
}
