import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
import { getShortcutsConfig } from "@/lib";

// Global state for listener management
let listenerCount = 0;
let activeUnlistenFns: UnlistenFn[] = [];
let setupGeneration = 0;

// We need a way to access the *current* callback refs from the global listener.
// Since the listener is global, but the callbacks are local to the hook instance,
// we'll update this global ref whenever a new hook instance takes control (becomes the active listener owner).
let globalCallbackRefs: {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  audioCallbackRef: React.MutableRefObject<(() => void) | null>;
  screenshotCallbackRef: React.MutableRefObject<(() => void | Promise<void>) | null>;
  systemAudioCallbackRef: React.MutableRefObject<(() => void) | null>;
  customShortcutCallbacksRef: React.MutableRefObject<Map<string, () => void>>;
} | null = null;

// Global debounce for screenshot events
let lastScreenshotEventTime = 0;

export const useGlobalShortcuts = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioCallbackRef = useRef<(() => void) | null>(null);
  const screenshotCallbackRef = useRef<(() => void) | null>(null);
  const systemAudioCallbackRef = useRef<(() => void) | null>(null);
  const customShortcutCallbacksRef = useRef<Map<string, () => void>>(new Map());

  // Helper to update the global refs to point to THIS instance
  const updateGlobalRefs = useCallback(() => {
    globalCallbackRefs = {
      inputRef,
      audioCallbackRef,
      screenshotCallbackRef,
      systemAudioCallbackRef,
      customShortcutCallbacksRef,
    };
  }, []);

  const checkShortcutsRegistered = useCallback(async (): Promise<boolean> => {
    try {
      const registered = await invoke<boolean>("check_shortcuts_registered");
      return registered;
    } catch (error) {
      console.error("Failed to check shortcuts:", error);
      return false;
    }
  }, []);

  const getShortcuts = useCallback(async (): Promise<Record<
    string,
    string
  > | null> => {
    try {
      const shortcuts = await invoke<Record<string, string>>(
        "get_registered_shortcuts"
      );
      return shortcuts;
    } catch (error) {
      console.error("Failed to get shortcuts:", error);
      return null;
    }
  }, []);

  const updateShortcuts = useCallback(async (): Promise<boolean> => {
    try {
      const config = getShortcutsConfig();
      await invoke("update_shortcuts", { config });
      return true;
    } catch (error) {
      console.error("Failed to update shortcuts:", error);
      return false;
    }
  }, []);

  // Register input element for auto-focus
  const registerInputRef = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    // If we are the active instance, ensure global sees this change (though refs are stable objects, so it should be fine)
  }, []);

  // Register audio callback
  const registerAudioCallback = useCallback((callback: () => void) => {
    audioCallbackRef.current = callback;
  }, []);

  // Register screenshot callback
  const registerScreenshotCallback = useCallback(
    (callback: () => void | Promise<void>) => {
      screenshotCallbackRef.current = callback;
    },
    []
  );

  // Register system audio callback
  const registerSystemAudioCallback = useCallback((callback: () => void) => {
    systemAudioCallbackRef.current = callback;
  }, []);

  // Register custom shortcut callback
  const registerCustomShortcutCallback = useCallback(
    (actionId: string, callback: () => void) => {
      customShortcutCallbacksRef.current.set(actionId, callback);
    },
    []
  );

  // Unregister custom shortcut callback
  const unregisterCustomShortcutCallback = useCallback((actionId: string) => {
    customShortcutCallbacksRef.current.delete(actionId);
  }, []);

  // Setup event listeners
  useEffect(() => {
    // Increment count and generation
    listenerCount++;
    const myGeneration = ++setupGeneration;

    // Make this instance the owner of global callbacks
    updateGlobalRefs();

    const setupEventListeners = async () => {
      try {
        // --- Define Listeners ---

        // Focus Listener
        const unlistenFocus = await listen("focus-text-input", () => {
          setTimeout(() => {
            if (globalCallbackRefs?.inputRef.current) {
              globalCallbackRefs.inputRef.current.focus();
            }
          }, 100);
        });
        if (listenerCount === 0 || myGeneration !== setupGeneration) { unlistenFocus(); return; }
        activeUnlistenFns.push(unlistenFocus);

        // Audio Listener
        const unlistenAudio = await listen("start-audio-recording", () => {
          if (globalCallbackRefs?.audioCallbackRef.current) {
            globalCallbackRefs.audioCallbackRef.current();
          }
        });
        if (listenerCount === 0 || myGeneration !== setupGeneration) { unlistenAudio(); return; }
        activeUnlistenFns.push(unlistenAudio);

        // Screenshot Listener
        const unlistenScreenshot = await listen("trigger-screenshot", () => {
          const now = Date.now();
          const timeSinceLastEvent = now - lastScreenshotEventTime;
          if (timeSinceLastEvent < 300) return; // Debounce
          lastScreenshotEventTime = now;

          if (globalCallbackRefs?.screenshotCallbackRef.current) {
            Promise.resolve(globalCallbackRefs.screenshotCallbackRef.current()).catch(console.error);
          }
        });
        if (listenerCount === 0 || myGeneration !== setupGeneration) { unlistenScreenshot(); return; }
        activeUnlistenFns.push(unlistenScreenshot);

        // System Audio Listener
        const unlistenSystemAudio = await listen("toggle-system-audio", () => {
          if (globalCallbackRefs?.systemAudioCallbackRef.current) {
            globalCallbackRefs.systemAudioCallbackRef.current();
          }
        });
        if (listenerCount === 0 || myGeneration !== setupGeneration) { unlistenSystemAudio(); return; }
        activeUnlistenFns.push(unlistenSystemAudio);

        // Custom Shortcut Listener
        const unlistenCustomShortcut = await listen<{ action: string }>(
          "custom-shortcut-triggered",
          (event) => {
            const actionId = event.payload.action;
            const callback = globalCallbackRefs?.customShortcutCallbacksRef.current.get(actionId);
            if (callback) {
              callback();
            }
          }
        );
        if (listenerCount === 0 || myGeneration !== setupGeneration) { unlistenCustomShortcut(); return; }
        activeUnlistenFns.push(unlistenCustomShortcut);

        // Registration Error Listener
        const unlistenRegistrationError = await listen<Array<[string, string, string]>>(
          "shortcut-registration-error",
          (event) => {
            window.dispatchEvent(new CustomEvent("shortcutRegistrationError", { detail: event.payload }));
          }
        );
        if (listenerCount === 0 || myGeneration !== setupGeneration) { unlistenRegistrationError(); return; }
        activeUnlistenFns.push(unlistenRegistrationError);

      } catch (error) {
        console.error("Failed to setup event listeners:", error);
      }
    };

    // Only setup if we are the first/only active listener (or if we just took over ownership)
    // Actually, with the generation pattern, we ALWAYS try to setup if we are mounting,
    // but we invalidate any previous setups.
    // However, we should clean up previous listeners first if they exist.

    if (activeUnlistenFns.length > 0) {
      activeUnlistenFns.forEach(fn => fn());
      activeUnlistenFns = [];
    }

    setupEventListeners();

    return () => {
      listenerCount--;
      if (listenerCount === 0) {
        // Last one out turns off the lights
        setupGeneration++; // Invalidate pending setups
        activeUnlistenFns.forEach(fn => fn());
        activeUnlistenFns = [];
        globalCallbackRefs = null;
      }
    };
  }, [updateGlobalRefs]);

  return {
    checkShortcutsRegistered,
    getShortcuts,
    updateShortcuts,
    registerInputRef,
    registerAudioCallback,
    registerScreenshotCallback,
    registerSystemAudioCallback,
    registerCustomShortcutCallback,
    unregisterCustomShortcutCallback,
  };
};
