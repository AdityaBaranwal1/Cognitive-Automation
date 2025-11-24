import { useState, useEffect } from "react";
import { useApp, useSystemPrompts } from "@/contexts";
import { Workflow, WorkflowStep, AIStepConfig, CaptureStepConfig, ActionNotificationConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, MousePointerClick, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PageLayout } from "@/layouts";
import { HotkeyRecorder } from "@/components";

const WorkflowEditor = () => {
    const { workflows, saveWorkflow, updateWorkflow, deleteWorkflow } = useApp();
    const { prompts: systemPrompts } = useSystemPrompts();
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);

    const selectedWorkflow = workflows.find(w => w.id === selectedWorkflowId);

    // Listen for capture events
    useEffect(() => {
        const unlisten = listen("captured-selection", (event) => {
            // This is just a fallback/confirmation if needed, 
            // but we might not get the coords here directly if the backend command returns void.
            // Actually, we need to know WHICH step initiated the capture.
            // Since we can't easily pass state through the backend event, 
            // we'll rely on the fact that the user is "blocked" in the capture UI.
            // However, the backend command select_region_coordinates now returns void immediately.
            // Wait, the backend implementation I wrote returns Ok(()) immediately.
            // But it emits "captured-selection" with base64... wait.
            // The previous implementation of select_region_coordinates returned coords.
            // The NEW implementation returns Ok(()) and should emit an event with coords?
            // Let me re-read the backend code I just wrote.
            // I wrote: app.emit("captured-selection", &base64_str) in capture_selected_area.
            // BUT select_region_coordinates just opens the overlay.
            // The overlay logic needs to handle the selection.
            // The overlay logic in index.html/capture.ts likely calls capture_selected_area.
            // We need to make sure the overlay returns COORDS, not just base64.
            // For now, let's assume the standard capture flow works for "visual" selection,
            // but for "coordinate" selection, we might need to adjust the overlay to emit coords.

            // Actually, looking at the plan: "Emit an Event (e.g., AREA_SELECTED) to the main window with the JSON payload."
            // I haven't implemented that part in the overlay JS side yet.
            // But I did modify the backend to return immediately.

            // Let's implement the listener for now assuming we'll get "area-selected" event.
        });

        return () => {
            unlisten.then(f => f());
        };
    }, []);

    const handleCreateWorkflow = () => {
        const newWorkflow: Workflow = {
            id: crypto.randomUUID(),
            name: "New Workflow",
            trigger: { type: "hotkey", key: "", enabled: true },
            steps: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        saveWorkflow(newWorkflow);
        setSelectedWorkflowId(newWorkflow.id);
    };

    const handleAddStep = (type: WorkflowStep["type"]) => {
        if (!selectedWorkflow) return;

        let config: any = {};
        if (type === "capture_region") {
            config = { x: 0, y: 0, width: 0, height: 0, mode: "fixed" } as CaptureStepConfig;
        } else if (type === "ai_process") {
            config = { prompt: "", model: "qwen2-vl-2b-instruct" } as AIStepConfig;
        } else if (type === "action_notification") {
            config = { title: "Show in Chat Overlay" } as ActionNotificationConfig;
        }

        const newStep: WorkflowStep = {
            id: crypto.randomUUID(),
            type,
            config,
        };

        updateWorkflow({
            ...selectedWorkflow,
            steps: [...selectedWorkflow.steps, newStep],
            updatedAt: Date.now(),
        });
    };

    const handleUpdateStep = (stepId: string, newConfig: any) => {
        if (!selectedWorkflow) return;
        const newSteps = selectedWorkflow.steps.map(s =>
            s.id === stepId ? { ...s, config: { ...s.config, ...newConfig } } : s
        );
        updateWorkflow({ ...selectedWorkflow, steps: newSteps, updatedAt: Date.now() });
    };

    const handleDeleteStep = (stepId: string) => {
        if (!selectedWorkflow) return;
        const newSteps = selectedWorkflow.steps.filter(s => s.id !== stepId);
        updateWorkflow({ ...selectedWorkflow, steps: newSteps, updatedAt: Date.now() });
    };

    const handlePickRegion = async (stepId: string) => {
        try {
            setIsCapturing(true);

            // 1. Hide main window to get out of the way
            await invoke("toggle_dashboard");

            // 2. Start selection (opens overlay)
            await invoke("start_region_selection");

            // 3. Wait for result (blocks until user selects or timeouts)
            // This eliminates race conditions because we are explicitly waiting for the data
            const coords = await invoke<any>("wait_for_region_selection");

            console.log("Region selected:", coords);

            // 4. Update the step with new coordinates
            handleUpdateStep(stepId, {
                x: coords.x,
                y: coords.y,
                width: coords.width,
                height: coords.height,
                monitorIndex: coords.monitor_index,
                mode: "fixed"
            });

            // 5. Show dashboard again
            await invoke("open_dashboard");
            setIsCapturing(false);

        } catch (error) {
            console.error("Failed to pick region:", error);
            setIsCapturing(false);
            await invoke("open_dashboard");
        }
    };

    return (
        <PageLayout title="Workflow Engine" description="Automate tasks with AI workflows triggered by hotkeys.">
            <div className="flex h-[calc(100vh-140px)] gap-4">
                {/* Sidebar: Workflow List */}
                <Card className="w-64 flex flex-col">
                    <CardHeader className="p-4 border-b">
                        <CardTitle className="text-sm font-medium flex justify-between items-center">
                            Workflows
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCreateWorkflow}>
                                <Plus className="h-4 w-4" />
                            </Button>
                        </CardTitle>
                    </CardHeader>
                    <ScrollArea className="flex-1">
                        <div className="p-2 space-y-1">
                            {workflows.map(w => (
                                <div
                                    key={w.id}
                                    className={`p-2 rounded-md cursor-pointer text-sm flex justify-between items-center hover:bg-accent ${selectedWorkflowId === w.id ? "bg-accent" : ""}`}
                                    onClick={() => setSelectedWorkflowId(w.id)}
                                >
                                    <span className="truncate font-medium">{w.name}</span>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:text-destructive"
                                        onClick={(e) => { e.stopPropagation(); deleteWorkflow(w.id); }}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </Card>

                {/* Main Editor */}
                <div className="flex-1 flex flex-col gap-4">
                    {selectedWorkflow ? (
                        <>
                            <Card className="p-4">
                                <div className="flex gap-4 items-end">
                                    <div className="flex-1 space-y-2">
                                        <Label>Workflow Name</Label>
                                        <Input
                                            value={selectedWorkflow.name}
                                            onChange={(e) => updateWorkflow({ ...selectedWorkflow, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="w-48 space-y-2">
                                        <Label>Hotkey</Label>
                                        <HotkeyRecorder
                                            value={selectedWorkflow.trigger.key}
                                            onChange={(key) => updateWorkflow({
                                                ...selectedWorkflow,
                                                trigger: { ...selectedWorkflow.trigger, key }
                                            })}
                                        />
                                    </div>
                                </div>
                            </Card>

                            <ScrollArea className="flex-1 pr-4">
                                <div className="space-y-4 pb-10">
                                    {selectedWorkflow.steps.map((step, index) => (
                                        <Card key={step.id} className="relative group">
                                            <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDeleteStep(step.id)}>
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                            <CardHeader className="p-4 pb-2">
                                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                                    <div className="bg-primary/10 p-1 rounded text-primary text-xs w-6 h-6 flex items-center justify-center">
                                                        {index + 1}
                                                    </div>
                                                    {step.type === "capture_region" && "Capture Region"}
                                                    {step.type === "ai_process" && "AI Processing"}
                                                    {step.type === "action_notification" && "Output Action"}
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="p-4 pt-2 space-y-4">
                                                {step.type === "capture_region" && (
                                                    <div className="flex flex-col gap-3">
                                                        <div className="flex gap-4 items-center">
                                                            <div className="grid grid-cols-4 gap-2 text-xs flex-1">
                                                                <div className="bg-muted p-2 rounded">X: {step.config.x}</div>
                                                                <div className="bg-muted p-2 rounded">Y: {step.config.y}</div>
                                                                <div className="bg-muted p-2 rounded">W: {step.config.width}</div>
                                                                <div className="bg-muted p-2 rounded">H: {step.config.height}</div>
                                                                {step.config.monitorIndex !== undefined && (
                                                                    <div className="bg-muted p-2 rounded col-span-4 text-center">Monitor: {step.config.monitorIndex}</div>
                                                                )}
                                                            </div>
                                                            <Button size="sm" variant="outline" onClick={() => handlePickRegion(step.id)} disabled={isCapturing}>
                                                                <MousePointerClick className="mr-2 h-3 w-3" />
                                                                {isCapturing ? "Picking..." : "Set Watch Region"}
                                                            </Button>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground italic">
                                                            Pressing the hotkey will silently capture this exact region.
                                                        </div>
                                                    </div>
                                                )}

                                                {step.type === "ai_process" && (
                                                    <div className="space-y-4">
                                                        <div className="space-y-2">
                                                            <Label>System Prompt</Label>
                                                            <Select
                                                                value={step.config.systemPromptId}
                                                                onValueChange={(val) => handleUpdateStep(step.id, { systemPromptId: val })}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select a system prompt" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {systemPrompts.map(prompt => (
                                                                        <SelectItem key={prompt.id} value={String(prompt.id)}>
                                                                            {prompt.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>User Prompt (Optional Context)</Label>
                                                            <Textarea
                                                                placeholder="e.g. Solve this puzzle..."
                                                                value={step.config.prompt}
                                                                onChange={(e) => handleUpdateStep(step.id, { prompt: e.target.value })}
                                                                className="h-20"
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {step.type === "action_notification" && (
                                                    <div className="space-y-2">
                                                        <Label>Output Destination</Label>
                                                        <Select
                                                            value={step.config.title}
                                                            onValueChange={(val) => handleUpdateStep(step.id, { title: val })}
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue placeholder="Select output destination" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="Show in Chat Overlay">Show in Chat Overlay</SelectItem>
                                                                <SelectItem value="Copy to Clipboard">Copy to Clipboard</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    ))}

                                    <div className="flex gap-2 justify-center pt-4">
                                        <Button variant="outline" size="sm" onClick={() => handleAddStep("capture_region")}>+ Capture</Button>
                                        <Button variant="outline" size="sm" onClick={() => handleAddStep("ai_process")}>+ AI Process</Button>
                                        <Button variant="outline" size="sm" onClick={() => handleAddStep("action_notification")}>+ Output</Button>
                                    </div>
                                </div>
                            </ScrollArea>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-muted-foreground">
                            Select or create a workflow to start editing
                        </div>
                    )}
                </div>
            </div>
        </PageLayout>
    );
};

export default WorkflowEditor;
