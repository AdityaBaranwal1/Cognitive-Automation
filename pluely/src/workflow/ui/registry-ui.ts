/**
 * Workflow step registry — UI side.
 *
 * Records carry React + lucide. Imported only by editor / graph / sidebar
 * components, never by the runner or tests.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { StepType, WorkflowStep } from "@/types";

export interface StepUIDefinition<C = unknown> {
    type: StepType;
    icon: LucideIcon;
    /** CSS color used as the accent for the graph node and tree-view chip. */
    color: string;
    /** Optional rich tooltip rendered on graph nodes. */
    tooltip?: (config: C) => ReactNode | null;
}

const UI_REGISTRY = new Map<StepType, StepUIDefinition>();

export function registerStepUI<C>(def: StepUIDefinition<C>): void {
    UI_REGISTRY.set(def.type, def as StepUIDefinition);
}

export function getStepUI(type: StepType): StepUIDefinition | undefined {
    return UI_REGISTRY.get(type);
}

export function getStepIcon(type: StepType): LucideIcon | undefined {
    return UI_REGISTRY.get(type)?.icon;
}

export function getStepColor(type: StepType): string {
    return UI_REGISTRY.get(type)?.color ?? "#6b7280";
}

export function getStepTooltip(step: WorkflowStep): ReactNode | null {
    const ui = UI_REGISTRY.get(step.type);
    if (!ui?.tooltip) return null;
    try {
        return ui.tooltip(step.config as never);
    } catch {
        return null;
    }
}
