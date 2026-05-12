import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib";
import { getShortcutsConfig, persistAndSync } from "@/lib/storage";
import { useTauriEvent } from "@/lib/tauri/use-event";
import { IWorkflowContextType, Workflow, WorkflowExecution } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    ReactNode,
    createContext,
    useContext,
    useEffect,
    useState,
    useRef,
} from "react";

// Create the context
const WorkflowContext = createContext<IWorkflowContextType | undefined>(undefined);

// Create the provider component
export const WorkflowProvider = ({ children }: { children: ReactNode }) => {
    // Workflow State
    const [workflows, setWorkflows] = useState<Workflow[]>([]);

    // Workflow Execution Tracking (for progress indicators)
    const [workflowExecution, setWorkflowExecution] = useState<WorkflowExecution | null>(null);

    // Load workflows from localStorage on mount
    useEffect(() => {
        const savedWorkflows = safeLocalStorage.getItem(STORAGE_KEYS.WORKFLOWS);
        if (savedWorkflows) {
            try {
                setWorkflows(JSON.parse(savedWorkflows));
            } catch (e) {
                console.error("Failed to parse workflows", e);
            }
        }
    }, []);

    // --- SINGLE SOURCE OF TRUTH: Tauri push-based cross-window sync ---
    // Replaces old `window.addEventListener("storage")` which had TOCTOU races.
    useTauriEvent<string>("data-updated", (event) => {
        if (event.payload === STORAGE_KEYS.WORKFLOWS) {
            const savedWorkflows = safeLocalStorage.getItem(STORAGE_KEYS.WORKFLOWS);
            if (savedWorkflows) {
                try {
                    setWorkflows(JSON.parse(savedWorkflows));
                } catch (e) {
                    console.error("Failed to parse workflows from data-updated event", e);
                }
            }
        }
    });

    // Listen for cross-window workflow execution events (dashboard receives from main).
    // Main window sets state directly via setWorkflowExecution — only non-main subscribes.
    const isMainWindow = getCurrentWindow().label === "main";
    useTauriEvent<WorkflowExecution | null>(
        "workflow-execution-update",
        (event) => {
            if (!isMainWindow) setWorkflowExecution(event.payload);
        },
        [isMainWindow],
    );

    // --- HOTKEY OPTIMIZATION START ---

    // Store the "fingerprint" of the last registered shortcuts
    const prevShortcutsHash = useRef<string>("");

    // Sync workflows to shortcuts (OPTIMIZED)
    useEffect(() => {
        const syncWorkflowShortcuts = async () => {
            // 1. Filter down to ONLY the data that matters for hotkeys
            const hotkeyData = workflows.map((w) => ({
                id: w.id,
                key: w.trigger.key,
                emergencyStopKey: w.trigger.emergencyStopKey,
                enabled: w.trigger.enabled,
            }));

            // 2. Create a stable string representation (Hash)
            const currentHash = JSON.stringify(hotkeyData);

            // 3. THE GUARD CLAUSE:
            if (currentHash === prevShortcutsHash.current) {
                return;
            }

            // 4. Update the ref for the next render
            prevShortcutsHash.current = currentHash;

            console.log("⚡ Updating System Shortcuts (Config Changed)...");

            // 5. Proceed with the update logic
            const currentShortcuts = getShortcutsConfig();
            const workflowBindings: Record<string, any> = {};

            workflows.forEach((w) => {
                // Register trigger hotkey
                if (w.trigger.type === "hotkey" && w.trigger.enabled && w.trigger.key) {
                    workflowBindings[w.id] = {
                        action: w.id,
                        key: w.trigger.key,
                        enabled: true,
                        label: w.name,
                    };
                }
                // Register emergency stop hotkey
                if (w.trigger.emergencyStopKey) {
                    workflowBindings[`${w.id}_stop`] = {
                        action: `${w.id}_stop`,
                        key: w.trigger.emergencyStopKey,
                        enabled: true,
                        label: `Emergency Stop: ${w.name}`,
                    };
                }
            });

            // Merge bindings
            const newConfig = {
                bindings: {
                    ...currentShortcuts.bindings,
                    ...workflowBindings,
                },
            };

            try {
                await invoke("update_shortcuts", { config: newConfig });
            } catch (error) {
                console.error("Failed to update workflow shortcuts:", error);
            }
        };

        // Run sync
        if (workflows.length > 0) {
            syncWorkflowShortcuts();
        }
    }, [workflows]);

    // --- HOTKEY OPTIMIZATION END ---

    const saveWorkflow = async (workflow: Workflow) => {
        const newWorkflows = [...workflows, workflow];
        setWorkflows(newWorkflows);
        await persistAndSync(STORAGE_KEYS.WORKFLOWS, newWorkflows);
    };

    const updateWorkflow = async (workflow: Workflow) => {
        const newWorkflows = workflows.map((w) =>
            w.id === workflow.id ? workflow : w
        );
        setWorkflows(newWorkflows);
        await persistAndSync(STORAGE_KEYS.WORKFLOWS, newWorkflows);
    };

    const deleteWorkflow = async (id: string) => {
        const newWorkflows = workflows.filter((w) => w.id !== id);
        setWorkflows(newWorkflows);
        await persistAndSync(STORAGE_KEYS.WORKFLOWS, newWorkflows);
    };

    const value: IWorkflowContextType = {
        workflows,
        saveWorkflow,
        deleteWorkflow,
        updateWorkflow,
        workflowExecution,
        setWorkflowExecution,
    };

    return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
};

// Create a hook to access the context
export const useWorkflow = () => {
    const context = useContext(WorkflowContext);

    if (!context) {
        throw new Error("useWorkflow must be used within a WorkflowProvider");
    }

    return context;
};
