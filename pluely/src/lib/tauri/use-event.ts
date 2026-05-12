import { useEffect, type DependencyList } from "react";
import { listen, type Event as TauriEvent, type EventName } from "@tauri-apps/api/event";

type Handler<P> = (event: TauriEvent<P>) => void;

/**
 * Subscribe to a Tauri event for the lifetime of the component.
 *
 * Replaces the duplicated boilerplate (8+ call sites) where each component
 * did `const unlisten = listen(name, cb)` and returned a cleanup that
 * resolved the promise to call the unlisten function.
 *
 * The handler is stored in a closure on the listener side and is not
 * re-bound when it changes — if you need a fresh handler, include any
 * captured values in `deps` so the listener re-subscribes. Default `deps`
 * is `[]` (subscribe once on mount, unsubscribe on unmount).
 */
export function useTauriEvent<P = unknown>(
    name: EventName,
    handler: Handler<P>,
    deps: DependencyList = [],
): void {
    useEffect(() => {
        let cancelled = false;
        let unlistenFn: (() => void) | null = null;
        listen<P>(name, (event) => {
            if (!cancelled) handler(event);
        }).then((fn) => {
            if (cancelled) {
                fn();
            } else {
                unlistenFn = fn;
            }
        });
        return () => {
            cancelled = true;
            if (unlistenFn) unlistenFn();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}

export interface TauriEventSpec<P = unknown> {
    name: EventName;
    handler: Handler<P>;
}

/**
 * Subscribe to multiple Tauri events with a single effect.
 *
 * Replaces the Shape B duplicate (`unlistenHide`/`unlistenShow` pair in
 * config.context.tsx) where multiple listeners shared one cleanup.
 */
export function useTauriEvents(
    specs: TauriEventSpec[],
    deps: DependencyList = [],
): void {
    useEffect(() => {
        let cancelled = false;
        const unlistens: Array<() => void> = [];

        Promise.all(
            specs.map((spec) =>
                listen(spec.name, (event) => {
                    if (!cancelled) spec.handler(event);
                }),
            ),
        ).then((fns) => {
            if (cancelled) {
                fns.forEach((f) => f());
            } else {
                unlistens.push(...fns);
            }
        });

        return () => {
            cancelled = true;
            unlistens.forEach((f) => f());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
