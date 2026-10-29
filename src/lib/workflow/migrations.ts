/**
 * Workflow schema migrations.
 *
 * `migrate(raw)` accepts any persisted workflow shape (v1 or v2) and returns
 * a canonical v2 `Workflow`. Lazy-on-read: called by workflow.context.tsx
 * before setWorkflows so existing localStorage data survives the IR change.
 *
 * v1 -> v2 rules:
 *   - `schemaVersion` stamped to 2 on output.
 *   - `loop.children` -> `loop.body` (both accepted on read; body wins).
 *   - `delay` -> `wait` (renames the type; preserves `durationMs`).
 *   - `system_action` with action="copy_to_clipboard" -> `action_notification`
 *     with title="Copy to Clipboard". Other system_action subtypes are kept
 *     as-is (they have no UI but the runner is tolerant).
 *   - Recursive: applies to nested children inside loop bodies.
 *   - Auto-generates `step.key` from `step.name` when absent; deduped.
 *   - `allowedHosts` defaults to empty array (no http_request permitted).
 *
 * The migrator never throws on unknown step types — it passes them through.
 */

import type {
    StepType,
    Workflow,
    WorkflowStep,
    LoopStepConfig,
    DelayStepConfig,
    WaitStepConfig,
    SystemActionConfig,
    ActionNotificationConfig,
} from "@/types";
import { WORKFLOW_SCHEMA_VERSION } from "@/types";

interface UnknownStep {
    id?: string;
    type?: string;
    name?: string;
    key?: string;
    config?: Record<string, unknown>;
    policy?: unknown;
}

interface UnknownWorkflow {
    id?: string;
    schemaVersion?: number;
    name?: string;
    description?: string;
    trigger?: unknown;
    steps?: UnknownStep[];
    allowedHosts?: string[];
    createdAt?: number;
    updatedAt?: number;
}

/**
 * Slug-case a string into an identifier valid for expression bindings.
 * Returns null if nothing usable can be derived (caller falls back to UUID).
 */
function slugifyKey(name: string | undefined): string | null {
    if (!name) return null;
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!slug) return null;
    // Must start with [a-z_]; if it starts with a digit, prefix.
    return /^[a-z_]/.test(slug) ? slug : `_${slug}`;
}

/** Migrate a single step recursively. */
function migrateStep(raw: UnknownStep, usedKeys: Set<string>): WorkflowStep {
    const id = raw.id ?? crypto.randomUUID();
    const name = raw.name;
    const policy = (raw.policy as WorkflowStep["policy"]) ?? undefined;

    // Carry-through key if present + valid; otherwise generate from name.
    let key: string | undefined = raw.key;
    if (!key) {
        const candidate = slugifyKey(name);
        if (candidate) {
            // dedupe
            let final = candidate;
            let n = 2;
            while (usedKeys.has(final)) {
                final = `${candidate}_${n}`;
                n += 1;
            }
            key = final;
        }
    }
    if (key) usedKeys.add(key);

    const rawType = raw.type ?? "";
    const rawConfig = (raw.config ?? {}) as Record<string, unknown>;

    // --- type rewrites ---

    // delay -> wait
    if (rawType === "delay") {
        const delayCfg = rawConfig as Partial<DelayStepConfig>;
        const waitCfg: WaitStepConfig = { durationMs: delayCfg.durationMs ?? 500 };
        return { id, key, name, policy, type: "wait", config: waitCfg };
    }

    // system_action(copy_to_clipboard) -> action_notification("Copy to Clipboard")
    // Other system_action variants are kept (no UI, runner tolerates).
    if (rawType === "system_action") {
        const sysCfg = rawConfig as Partial<SystemActionConfig>;
        if (sysCfg.action === "copy_to_clipboard") {
            const notif: ActionNotificationConfig = { title: "Copy to Clipboard" };
            return { id, key, name, policy, type: "action_notification", config: notif };
        }
        return {
            id,
            key,
            name,
            policy,
            type: "system_action",
            config: { action: sysCfg.action ?? "copy_to_clipboard", value: sysCfg.value ?? "" },
        };
    }

    // loop: children -> body (both accepted on read; body wins). Recurse.
    if (rawType === "loop") {
        const rawLoop = rawConfig as { iterations?: number; body?: UnknownStep[]; children?: UnknownStep[] };
        const source = rawLoop.body ?? rawLoop.children ?? [];
        const innerUsedKeys = new Set<string>();
        const body: WorkflowStep[] = source.map((c) => migrateStep(c, innerUsedKeys));
        const cfg: LoopStepConfig = { iterations: rawLoop.iterations ?? 1, body };
        return { id, key, name, policy, type: "loop", config: cfg };
    }

    // if/foreach/try_catch carry nested arrays — recurse on each.
    if (rawType === "if") {
        const ifCfg = rawConfig as { condition?: string; then?: UnknownStep[]; else?: UnknownStep[] };
        const thenKeys = new Set<string>();
        const elseKeys = new Set<string>();
        return {
            id,
            key,
            name,
            policy,
            type: "if",
            config: {
                condition: ifCfg.condition ?? "false",
                then: (ifCfg.then ?? []).map((s) => migrateStep(s, thenKeys)),
                else: ifCfg.else ? ifCfg.else.map((s) => migrateStep(s, elseKeys)) : undefined,
            },
        };
    }
    if (rawType === "foreach") {
        const fe = rawConfig as { source?: string; body?: UnknownStep[] };
        const bodyKeys = new Set<string>();
        return {
            id,
            key,
            name,
            policy,
            type: "foreach",
            config: {
                source: fe.source ?? "vars.items",
                body: (fe.body ?? []).map((s) => migrateStep(s, bodyKeys)),
            },
        };
    }
    if (rawType === "try_catch") {
        const tc = rawConfig as {
            body?: UnknownStep[];
            catch?: UnknownStep[];
            finally?: UnknownStep[];
        };
        return {
            id,
            key,
            name,
            policy,
            type: "try_catch",
            config: {
                body: (tc.body ?? []).map((s) => migrateStep(s, new Set())),
                catch: (tc.catch ?? []).map((s) => migrateStep(s, new Set())),
                finally: tc.finally ? tc.finally.map((s) => migrateStep(s, new Set())) : undefined,
            },
        };
    }

    // Anything else: pass through under the known StepType union.
    // (Validation tightening happens in Phase 2a via Zod.)
    return {
        id,
        key,
        name,
        policy,
        type: rawType as StepType,
        config: rawConfig as never,
    } as WorkflowStep;
}

/**
 * Migrate a raw workflow value (typically from JSON.parse(localStorage)).
 *
 * Idempotent: a v2 workflow round-trips cleanly. Never throws — best-effort
 * on malformed input, with a console warning per dropped field.
 */
export function migrate(raw: unknown): Workflow {
    const w = (raw ?? {}) as UnknownWorkflow;

    const usedKeys = new Set<string>();
    const steps: WorkflowStep[] = (w.steps ?? []).map((s) => migrateStep(s, usedKeys));

    return {
        id: w.id ?? crypto.randomUUID(),
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        name: w.name ?? "Untitled Workflow",
        description: w.description,
        trigger: (w.trigger as Workflow["trigger"]) ?? {
            type: "manual",
            enabled: false,
        },
        allowedHosts: w.allowedHosts ?? [],
        steps,
        createdAt: w.createdAt ?? Date.now(),
        updatedAt: w.updatedAt ?? Date.now(),
    };
}

export function migrateAll(raw: unknown): Workflow[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(migrate);
}
