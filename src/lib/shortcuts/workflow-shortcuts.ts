/**
 * Centralized lifecycle for workflow-scoped global shortcuts.
 *
 * Previously split across three layers:
 *   - workflow.context.tsx — system-shortcut binding sync (update_shortcuts)
 *   - useWorkflowRunner.ts — JS-side trigger callback + emergency stop
 *   - useCaptureStep.ts — per-step await_input keymap registration
 *
 * Both Rust IPC paths (`update_shortcuts` and `register_shortcut`/
 * `unregister_shortcut`) are kept — they correspond to different backend
 * code paths — but their callers go through this module.
 */

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getShortcutsConfig } from "@/lib/storage";
import type { Workflow } from "@/types";

/**
 * Well-known OS/IDE hotkeys we warn about (case-insensitive substring match
 * against the binding string). Closes audit #20.
 */
const RESERVED_HOTKEYS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
    { pattern: /\bctrl\+alt\+del\b/i, label: "Ctrl+Alt+Del (cannot be intercepted)" },
    { pattern: /\bctrl\+shift\+esc\b/i, label: "Ctrl+Shift+Esc (Task Manager)" },
    { pattern: /\bsuper\+l\b/i, label: "Super+L (lock screen)" },
    { pattern: /\bmeta\+l\b/i, label: "Meta+L (lock screen)" },
    { pattern: /\bwin\+l\b/i, label: "Win+L (lock screen)" },
    { pattern: /\balt\+f4\b/i, label: "Alt+F4 (close window)" },
    { pattern: /\bctrl\+shift\+p\b/i, label: "Ctrl+Shift+P (VS Code command palette)" },
    { pattern: /\bwin\+r\b/i, label: "Win+R (Run dialog)" },
];

/**
 * Returns a list of reserved-binding labels matched by `key` (empty when safe).
 */
export function findReservedConflicts(key: string | undefined | null): string[] {
    if (!key) return [];
    return RESERVED_HOTKEYS.filter((r) => r.pattern.test(key)).map((r) => r.label);
}

interface WorkflowHotkeyFingerprint {
    id: string;
    key?: string;
    emergencyStopKey?: string;
    enabled: boolean;
}

function fingerprint(workflows: Workflow[]): WorkflowHotkeyFingerprint[] {
    return workflows.map((w) => ({
        id: w.id,
        key: w.trigger.key,
        emergencyStopKey: w.trigger.emergencyStopKey,
        enabled: w.trigger.enabled,
    }));
}

/**
 * Sync workflow trigger + emergency-stop hotkeys to the OS, with hash-guard so
 * no IPC fires when the relevant slice of workflow data is unchanged.
 *
 * Replaces the inline effect in workflow.context.tsx:80-147.
 */
export function useWorkflowShortcutSync(workflows: Workflow[]): void {
    const prev = useRef<string>("");

    useEffect(() => {
        if (workflows.length === 0) return;

        const fp = fingerprint(workflows);
        const hash = JSON.stringify(fp);
        if (hash === prev.current) return;
        prev.current = hash;

        const currentShortcuts = getShortcutsConfig();
        const workflowBindings: Record<
            string,
            { action: string; key: string; enabled: true; label: string }
        > = {};

        for (const w of workflows) {
            if (w.trigger.type === "hotkey" && w.trigger.enabled && w.trigger.key) {
                workflowBindings[w.id] = {
                    action: w.id,
                    key: w.trigger.key,
                    enabled: true,
                    label: w.name,
                };
            }
            if (w.trigger.emergencyStopKey) {
                workflowBindings[`${w.id}_stop`] = {
                    action: `${w.id}_stop`,
                    key: w.trigger.emergencyStopKey,
                    enabled: true,
                    label: `Emergency Stop: ${w.name}`,
                };
            }
        }

        invoke("update_shortcuts", {
            config: { bindings: { ...currentShortcuts.bindings, ...workflowBindings } },
        }).catch((e) => console.error("[workflow-shortcuts] update_shortcuts failed:", e));
    }, [workflows]);
}

export interface AwaitInputBinding {
    key: string;
    actionId: string; // e.g. `await_${stepId}_${key}`
}

export interface AwaitInputHandle {
    dispose(): Promise<void>;
}

/**
 * Register a batch of per-step `await_input` keys via the single-shortcut Tauri
 * IPC. Returns a handle that unregisters them all in one call.
 *
 * The caller is responsible for setting up its own JS-side callbacks via
 * `registerCustomShortcutCallback` — this module owns only the Rust-side IPC.
 */
export async function registerAwaitInputKeys(
    bindings: AwaitInputBinding[],
): Promise<AwaitInputHandle> {
    const registered: string[] = [];
    for (const b of bindings) {
        try {
            await invoke("register_shortcut", { actionId: b.actionId, key: b.key });
            registered.push(b.actionId);
        } catch (e) {
            console.error(
                `[workflow-shortcuts] register_shortcut failed for ${b.actionId} -> ${b.key}:`,
                e,
            );
        }
    }
    return {
        async dispose() {
            for (const actionId of registered) {
                try {
                    await invoke("unregister_shortcut", { actionId });
                } catch (e) {
                    console.error(
                        `[workflow-shortcuts] unregister_shortcut failed for ${actionId}:`,
                        e,
                    );
                }
            }
        },
    };
}
