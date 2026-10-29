/**
 * Single-source helper for the macOS screen-recording permission check.
 *
 * Replaces the verbatim 23-line block previously duplicated in
 * useCompletion.ts:853-881 and useChatCompletion.ts:594-622.
 *
 * On non-macOS platforms returns `{ granted: true }` immediately.
 */

const PERMISSION_ERROR_MESSAGE =
    "Screen Recording permission required. Please enable it by going to System Settings > Privacy & Security > Screen & System Audio Recording. If you don't see the app in the list, click the '+' button to add it. If it's already listed, make sure it's enabled. Then restart the app.";

export type ScreenPermissionResult =
    | { granted: true }
    | { granted: false; userFacingError: string };

export async function ensureScreenRecordingPermission(): Promise<ScreenPermissionResult> {
    const platform = navigator.platform.toLowerCase();
    if (!platform.includes("mac")) {
        return { granted: true };
    }

    const {
        checkScreenRecordingPermission,
        requestScreenRecordingPermission,
    } = await import("tauri-plugin-macos-permissions-api");

    if (await checkScreenRecordingPermission()) {
        return { granted: true };
    }

    await requestScreenRecordingPermission();
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (await checkScreenRecordingPermission()) {
        return { granted: true };
    }

    return { granted: false, userFacingError: PERMISSION_ERROR_MESSAGE };
}
