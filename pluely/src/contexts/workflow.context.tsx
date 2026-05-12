import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib";
import { persistAndSync } from "@/lib/storage";
import { useTauriEvent } from "@/lib/tauri/use-event";
import { useWorkflowShortcutSync } from "@/lib/shortcuts/workflow-shortcuts";
import { migrateAll } from "@/lib/workflow/migrations";
import { IWorkflowContextType, Workflow, WorkflowExecution } from "@/types";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    ReactNode,
    createContext,
    useContext,
    useEffect,
    useState,
} from "react";

// Create the context
const WorkflowContext = createContext<IWorkflowContextType | undefined>(undefined);

// Create the provider component
export const WorkflowProvider = ({ children }: { children: ReactNode }) => {
    // Workflow State
    const [workflows, setWorkflows] = useState<Workflow[]>([]);

    // Workflow Execution Tracking (for progress indicators)
    const [workflowExecution, setWorkflowExecution] = useState<WorkflowExecution | null>(null);

    // Load workflows from localStorage on mount — runs the v1->v2 migrator
    // lazily on read so existing persisted data survives the IR change.
    useEffect(() => {
        const savedWorkflows = safeLocalStorage.getItem(STORAGE_KEYS.WORKFLOWS);
        if (savedWorkflows) {
            try {
                setWorkflows(migrateAll(JSON.parse(savedWorkflows)));
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
                    setWorkflows(migrateAll(JSON.parse(savedWorkflows)));
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

    // Sync workflow trigger + emergency-stop hotkeys to the OS.
    // Single-effect, hash-guarded helper lives in @/lib/shortcuts/workflow-shortcuts.
    useWorkflowShortcutSync(workflows);

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
