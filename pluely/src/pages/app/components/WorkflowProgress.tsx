import { useWorkflow } from "@/contexts";
import { Brain, Camera, Clock, Loader2, CheckCircle2, AlertCircle, Zap } from "lucide-react";
import type { WorkflowExecutionStatus } from "@/types";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

// Height constants matching useWindow.ts
const BASE_HEIGHT = 54;
const PROGRESS_HEIGHT = 24;
const EXPANDED_HEIGHT = BASE_HEIGHT + PROGRESS_HEIGHT; // 78

// Status configuration for consistent rendering
const statusConfig: Record<WorkflowExecutionStatus, {
    icon: React.ElementType;
    label: string;
    color: string;
    animate: boolean;
}> = {
    idle: { icon: Loader2, label: "Starting...", color: "var(--accent)", animate: true },
    running: { icon: Zap, label: "Running", color: "var(--accent)", animate: true },
    ai_thinking: { icon: Brain, label: "AI Thinking", color: "#8b5cf6", animate: true },
    capturing: { icon: Camera, label: "Capturing", color: "#22c55e", animate: true },
    waiting: { icon: Clock, label: "Waiting", color: "#f59e0b", animate: false },
    completed: { icon: CheckCircle2, label: "Complete", color: "#22c55e", animate: false },
    error: { icon: AlertCircle, label: "Error", color: "#ef4444", animate: false },
};

export const WorkflowProgress = () => {
    const { workflowExecution } = useWorkflow();
    const wasVisibleRef = useRef(false);
    // --- PROMISE-GATED: Don't render progress DOM until the OS window has physically resized ---
    const [isResized, setIsResized] = useState(false);

    // Dynamically resize the window when progress appears/disappears
    useEffect(() => {
        const isVisible = !!workflowExecution;
        let cancelled = false;

        if (isVisible && !wasVisibleRef.current) {
            // Progress just appeared — expand window, THEN allow render
            wasVisibleRef.current = true;
            setIsResized(false);

            invoke("set_window_height", {
                window: getCurrentWebviewWindow(),
                height: EXPANDED_HEIGHT,
            })
                .then(() => {
                    if (!cancelled) setIsResized(true);
                })
                .catch((e) => {
                    console.error("Failed to expand window for progress:", e);
                    // Still allow render on failure — graceful degradation
                    if (!cancelled) setIsResized(true);
                });
        } else if (!isVisible && wasVisibleRef.current) {
            // Progress just disappeared — shrink window back
            wasVisibleRef.current = false;
            setIsResized(false);
            invoke("set_window_height", {
                window: getCurrentWebviewWindow(),
                height: BASE_HEIGHT,
            }).catch((e) => console.error("Failed to shrink window after progress:", e));
        }

        return () => {
            cancelled = true;
        };
    }, [workflowExecution]);

    // Gate: don't paint the 24px progress bar until the OS window has expanded
    if (!workflowExecution || !isResized) return null;

    const { workflowName, activeStepIndex, totalSteps, status, error } = workflowExecution;
    const config = statusConfig[status] || statusConfig.running;
    const StatusIcon = config.icon;
    const progress = totalSteps > 0 ? ((activeStepIndex + 1) / totalSteps) * 100 : 0;
    const isError = status === "error";
    const isComplete = status === "completed";

    return (
        <>
            {/* Separator line from main card content */}
            <div className="w-full border-t border-secondary/30" />

            {/* Progress content - integrated inside the card */}
            <div
                data-workflow-active="true"
                className="flex items-center gap-2 px-2 py-1"
                style={{
                    animation: "workflow-fade-in 0.2s ease-out",
                    height: `${PROGRESS_HEIGHT}px`,
                    minHeight: `${PROGRESS_HEIGHT}px`,
                    maxHeight: `${PROGRESS_HEIGHT}px`,
                }}
            >
                {/* Status Icon */}
                <StatusIcon
                    className="flex-shrink-0"
                    style={{
                        width: 12,
                        height: 12,
                        color: config.color,
                        animation: config.animate ? "workflow-spin 1.5s linear infinite" : "none",
                    }}
                />

                {/* Workflow name + status */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[10px] font-medium text-foreground/90 truncate max-w-[100px]">
                        {workflowName}
                    </span>
                    <span className="text-[9px] font-medium whitespace-nowrap" style={{ color: config.color }}>
                        {isError && error
                            ? (error.length > 30 ? error.substring(0, 30) + "..." : error)
                            : config.label}
                    </span>
                </div>

                {/* Step counter */}
                {!isComplete && !isError && (
                    <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                        {activeStepIndex + 1}/{totalSteps}
                    </span>
                )}

                {/* Progress bar */}
                <div className="flex-1 min-w-[40px] max-w-[80px] h-[3px] rounded-full bg-secondary/30 overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-400 ease-out"
                        style={{
                            width: `${isComplete ? 100 : progress}%`,
                            background: config.color,
                        }}
                    />
                </div>
            </div>

            {/* Animations */}
            <style>{`
                @keyframes workflow-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes workflow-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}
            </style>
        </>
    );
};
