import type { LoopStepConfig, WorkflowStep } from "@/types/workflow";

/**
 * Steps inside a loop. v2 stores them in `body`; `children` is the
 * deprecated v1 alias the migrator renames. Editors must read through this
 * and write `body`, or edits land in a field the runner ignores.
 */
export function getLoopBody(config: unknown): WorkflowStep[] {
    const loop = (config ?? {}) as Partial<LoopStepConfig>;
    return loop.body ?? loop.children ?? [];
}
