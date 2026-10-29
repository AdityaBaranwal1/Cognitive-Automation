import { MutableRefObject, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { safeLocalStorage } from "./helper";

export interface PersistAndSyncOptions {
    /**
     * Pass a self-echo-guard ref (see useSelfEchoGuard) so the caller's own
     * data-updated listener can ignore the echo of its own write.
     */
    selfEchoGuard?: MutableRefObject<Set<string>>;
    /**
     * Time in ms to keep `key` in the self-echo guard. Default 500ms — matches
     * the legacy pattern in theme.context.tsx and config.context.tsx.
     */
    selfEchoTtlMs?: number;
}

/**
 * Persist a value to localStorage AND push it to the Rust persistent-state
 * pipeline so all other windows receive a `data-updated` event.
 *
 * Replaces the duplicated `JSON.stringify` + `safeLocalStorage.setItem` +
 * `invoke("save_persistent_data")` sequence in workflow.context.tsx,
 * theme.context.tsx, config.context.tsx, saved-providers.storage.ts, and
 * useHistory.ts.
 *
 * The value is stringified once; the same string is written to localStorage
 * and sent to Rust so both sides see identical bytes.
 */
export async function persistAndSync<T>(
    key: string,
    data: T,
    opts: PersistAndSyncOptions = {},
): Promise<void> {
    const json = typeof data === "string" ? data : JSON.stringify(data);
    safeLocalStorage.setItem(key, json);

    if (opts.selfEchoGuard) {
        opts.selfEchoGuard.current.add(key);
        const ttl = opts.selfEchoTtlMs ?? 500;
        setTimeout(() => {
            opts.selfEchoGuard?.current.delete(key);
        }, ttl);
    }

    try {
        await invoke("save_persistent_data", { key, data: json });
    } catch (e) {
        console.error(`[persistAndSync] Failed to sync key "${key}":`, e);
    }
}

export interface SelfEchoGuard {
    ref: MutableRefObject<Set<string>>;
    markWritten(key: string, ttlMs?: number): void;
    isSelfWrite(key: string): boolean;
}

/**
 * Hook to mark keys "we just wrote ourselves" so cross-window
 * `data-updated` listeners can skip the echo of their own write.
 *
 * Replaces the inline `recentlyWrittenKeys` + 500ms timeout pattern
 * duplicated across theme.context.tsx and config.context.tsx.
 */
export function useSelfEchoGuard(): SelfEchoGuard {
    const ref = useRef<Set<string>>(new Set<string>());
    return {
        ref,
        markWritten(key: string, ttlMs = 500) {
            ref.current.add(key);
            setTimeout(() => {
                ref.current.delete(key);
            }, ttlMs);
        },
        isSelfWrite(key: string) {
            return ref.current.has(key);
        },
    };
}
