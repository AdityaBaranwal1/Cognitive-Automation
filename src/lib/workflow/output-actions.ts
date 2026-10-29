/**
 * Canonical "output action" enumeration for workflow action_notification steps.
 *
 * Replaces the magic-string branching in useWorkflowRunner.ts where the action
 * was selected by `config.title === "Copy to Clipboard"`. Phase 1 migration
 * normalizes legacy v1 titles to these stable enum values.
 */

export const OutputAction = {
    ShowInOverlay: "show_in_overlay",
    CopyToClipboard: "copy_to_clipboard",
} as const;

export type OutputAction = (typeof OutputAction)[keyof typeof OutputAction];

export interface OutputActionOption {
    id: OutputAction;
    label: string;
}

export const OUTPUT_ACTION_OPTIONS: OutputActionOption[] = [
    { id: OutputAction.ShowInOverlay, label: "Show in Chat Overlay" },
    { id: OutputAction.CopyToClipboard, label: "Copy to Clipboard" },
];

/**
 * Resolve an action_notification config to a stable OutputAction value.
 * Accepts either the new `action` field or legacy `title` strings.
 */
export function resolveOutputAction(config: unknown): OutputAction {
    const c = config as { action?: string; title?: string } | null | undefined;
    if (c?.action === OutputAction.CopyToClipboard || c?.title === "Copy to Clipboard") {
        return OutputAction.CopyToClipboard;
    }
    return OutputAction.ShowInOverlay;
}

export function getOutputActionLabel(action: OutputAction): string {
    return OUTPUT_ACTION_OPTIONS.find((o) => o.id === action)?.label ?? String(action);
}
