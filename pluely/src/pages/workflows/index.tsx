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
import { Plus, Trash2, MousePointerClick, RefreshCw, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PageLayout } from "@/layouts";
import { HotkeyRecorder } from "@/components";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import curl2Json from "@bany/curl-to-json";
import { deepVariableReplacer } from "@/lib/functions/common.function";

const WorkflowEditor = () => {
    const { workflows, saveWorkflow, updateWorkflow, deleteWorkflow, allAiProviders } = useApp();
    const { prompts: systemPrompts } = useSystemPrompts();
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
    const [isLoadingModels, setIsLoadingModels] = useState<string | null>(null);
    const [deleteConfirmWorkflowId, setDeleteConfirmWorkflowId] = useState<string | null>(null); // For delete confirmation dialog

    const selectedWorkflow = workflows.find(w => w.id === selectedWorkflowId);

    // Listen for capture events
    useEffect(() => {
        const unlisten = listen("captured-selection", (event) => {
            // Placeholder for future event handling
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
            config = { prompt: "", model: "qwen2-vl-2b-instruct", providerId: "lm-studio" } as AIStepConfig;
        } else if (type === "action_notification") {
            config = { title: "Show in Chat Overlay" } as ActionNotificationConfig;
        } else if (type === "keypress") {
            config = { key: "PageDown", modifiers: [] };
        } else if (type === "wait") {
            config = { durationMs: 500 };
        } else if (type === "loop") {
            config = { iterations: 3, children: [] };
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
            await invoke("toggle_dashboard");
            await invoke("start_region_selection");
            const coords = await invoke<any>("wait_for_region_selection");

            handleUpdateStep(stepId, {
                x: coords.x,
                y: coords.y,
                width: coords.width,
                height: coords.height,
                monitorIndex: coords.monitor_index,
                mode: "fixed"
            });

            await invoke("open_dashboard");
            setIsCapturing(false);

        } catch (error) {
            console.error("Failed to pick region:", error);
            setIsCapturing(false);
            await invoke("open_dashboard");
        }
    };

    const fetchModelsForProvider = async (providerId: string) => {
        setIsLoadingModels(providerId);
        try {
            const provider = allAiProviders.find(p => p.id === providerId);
            if (!provider) throw new Error("Provider not found");

            // Try to deduce the models endpoint from the chat endpoint
            let curlCommand = provider.curl;
            let baseUrl = "";
            let apiKey = "";

            // Parse cURL to get URL and Headers (for Key)
            try {
                const curlJson = curl2Json(curlCommand);
                const url = curlJson.url;

                // Extract Base URL (remove /chat/completions or similar)
                // Common patterns: /v1/chat/completions -> /v1/models
                if (url.includes("/chat/completions")) {
                    baseUrl = url.split("/chat/completions")[0];
                } else if (url.includes("/completions")) {
                    baseUrl = url.split("/completions")[0];
                } else {
                    // Fallback: try to just use the domain + /v1/models
                    const urlObj = new URL(url);
                    baseUrl = `${urlObj.protocol}//${urlObj.host}/v1`;
                }

                // Extract API Key from headers or variables
                // Check variables first
                apiKey = provider.variables?.API_KEY || "";

                // If not in variables, check if it's hardcoded in the header
                if (!apiKey && curlJson.header) {
                    const authHeader = curlJson.header["Authorization"];
                    if (authHeader && authHeader.includes("Bearer ")) {
                        const parts = authHeader.split("Bearer ");
                        if (parts.length > 1 && !parts[1].includes("{{")) {
                            apiKey = parts[1];
                        }
                    }
                }
            } catch (e) {
                console.warn("Failed to parse cURL for model fetching", e);
                // Fallback for standard providers if cURL parsing fails
                if (providerId === "openai") baseUrl = "https://api.openai.com/v1";
                if (providerId === "lm-studio") baseUrl = "http://localhost:1234/v1";
            }

            if (!baseUrl) throw new Error("Could not determine base URL");

            const modelsUrl = `${baseUrl}/models`;

            // Prepare headers
            const headers: Record<string, string> = {
                "Content-Type": "application/json"
            };

            // If we have an API key (either resolved from variables or hardcoded), add it
            // Note: If the key is still {{API_KEY}}, deepVariableReplacer will handle it if we pass variables
            // But here we need to manually resolve it for the models call

            let finalApiKey = apiKey;
            if (!finalApiKey && provider.variables?.API_KEY) {
                finalApiKey = provider.variables.API_KEY;
            }

            if (finalApiKey && !finalApiKey.includes("{{")) {
                headers["Authorization"] = `Bearer ${finalApiKey}`;
            }

            const isLocal = modelsUrl.includes("localhost") || modelsUrl.includes("127.0.0.1");
            const fetchFn = isLocal ? fetch : tauriFetch;

            const response = await fetchFn(modelsUrl, {
                method: "GET",
                headers
            });

            if (!response.ok) throw new Error("Failed to fetch models");

            const data = await response.json();
            const models = data.data?.map((m: any) => m.id) || [];

            setFetchedModels(prev => ({ ...prev, [providerId]: models }));

        } catch (error) {
            console.error("Error fetching models:", error);
            // Fallback models if fetch fails
            setFetchedModels(prev => ({ ...prev, [providerId]: ["gpt-4o", "gpt-3.5-turbo", "claude-3-opus", "qwen2-vl-2b-instruct"] }));
        } finally {
            setIsLoadingModels(null);
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
                        <div className="p-2 pr-3 space-y-1">
                            {workflows.map(w => (
                                <div
                                    key={w.id}
                                    className={`p-2 rounded-md cursor-pointer text-sm flex justify-between items-center hover:bg-accent gap-2 ${selectedWorkflowId === w.id ? "bg-accent" : ""}`}
                                    onClick={() => setSelectedWorkflowId(w.id)}
                                >
                                    <span className="truncate font-medium flex-1 min-w-0">{w.name}</span>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6 shrink-0 text-gray-500 hover:text-red-500 hover:bg-red-500/10"
                                        onClick={(e) => { e.stopPropagation(); deleteWorkflow(w.id); }}
                                        title="Delete workflow"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
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
                                {/* Delete Workflow Button - Separate Row */}
                                <div className="flex justify-end mt-3 pt-3 border-t border-border/50">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-muted-foreground hover:text-red-500 hover:border-red-500 hover:bg-red-500/10"
                                        onClick={() => setDeleteConfirmWorkflowId(selectedWorkflow.id)}
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete Workflow
                                    </Button>
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
                                                    {step.type === "keypress" && "Keypress"}
                                                    {step.type === "wait" && "⏳ Wait"}
                                                    {step.type === "loop" && "🔄 Loop"}
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
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="space-y-2">
                                                                <Label>AI Provider</Label>
                                                                <Select
                                                                    value={step.config.providerId || "lm-studio"}
                                                                    onValueChange={(val) => handleUpdateStep(step.id, { providerId: val })}
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue placeholder="Select Provider" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {allAiProviders.map(p => (
                                                                            <SelectItem key={p.id} value={p.id || "unknown"}>
                                                                                {p.isCustom ? (p.id) : (p.id || "Unknown")}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label className="flex justify-between items-center">
                                                                    Model
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-4 w-4"
                                                                        onClick={() => fetchModelsForProvider(step.config.providerId || "lm-studio")}
                                                                        disabled={isLoadingModels === (step.config.providerId || "lm-studio")}
                                                                    >
                                                                        {isLoadingModels === (step.config.providerId || "lm-studio") ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                                    </Button>
                                                                </Label>
                                                                <Select
                                                                    value={step.config.model}
                                                                    onValueChange={(val) => handleUpdateStep(step.id, { model: val })}
                                                                >
                                                                    <SelectTrigger>
                                                                        <SelectValue placeholder="Select Model" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {(fetchedModels[step.config.providerId || "lm-studio"] || [step.config.model, "gpt-4o", "gpt-3.5-turbo", "qwen2-vl-2b-instruct"]).map(m => (
                                                                            <SelectItem key={m} value={m}>
                                                                                {m}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </div>

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

                                                {step.type === "keypress" && (
                                                    <div className="space-y-4">
                                                        <div className="space-y-2">
                                                            <Label>Key to Press</Label>
                                                            <Select
                                                                value={step.config.key || "PageDown"}
                                                                onValueChange={(val) => handleUpdateStep(step.id, { key: val })}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select key" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="PageDown">PageDown</SelectItem>
                                                                    <SelectItem value="PageUp">PageUp</SelectItem>
                                                                    <SelectItem value="ArrowDown">Arrow Down</SelectItem>
                                                                    <SelectItem value="ArrowUp">Arrow Up</SelectItem>
                                                                    <SelectItem value="ArrowLeft">Arrow Left</SelectItem>
                                                                    <SelectItem value="ArrowRight">Arrow Right</SelectItem>
                                                                    <SelectItem value="Enter">Enter</SelectItem>
                                                                    <SelectItem value="Tab">Tab</SelectItem>
                                                                    <SelectItem value="Escape">Escape</SelectItem>
                                                                    <SelectItem value="Space">Space</SelectItem>
                                                                    <SelectItem value="Home">Home</SelectItem>
                                                                    <SelectItem value="End">End</SelectItem>
                                                                    <SelectItem value="F1">F1</SelectItem>
                                                                    <SelectItem value="F2">F2</SelectItem>
                                                                    <SelectItem value="F3">F3</SelectItem>
                                                                    <SelectItem value="F4">F4</SelectItem>
                                                                    <SelectItem value="F5">F5</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>Modifiers (Optional)</Label>
                                                            <div className="flex gap-4">
                                                                {["ctrl", "alt", "shift", "win"].map((mod) => (
                                                                    <label key={mod} className="flex items-center gap-2 cursor-pointer">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={(step.config.modifiers || []).includes(mod)}
                                                                            onChange={(e) => {
                                                                                const current = step.config.modifiers || [];
                                                                                const updated = e.target.checked
                                                                                    ? [...current, mod]
                                                                                    : current.filter((m: string) => m !== mod);
                                                                                handleUpdateStep(step.id, { modifiers: updated });
                                                                            }}
                                                                            className="rounded"
                                                                        />
                                                                        <span className="text-sm capitalize">{mod}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground italic">
                                                            Sends keypresses to the active window. Use for scrolling, navigation, etc.
                                                        </div>
                                                    </div>
                                                )}

                                                {step.type === "wait" && (
                                                    <div className="space-y-4">
                                                        <div className="space-y-2">
                                                            <Label>Duration (ms)</Label>
                                                            <Select
                                                                value={String(step.config.durationMs || 500)}
                                                                onValueChange={(val) => handleUpdateStep(step.id, { durationMs: parseInt(val) })}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select duration" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="100">100ms</SelectItem>
                                                                    <SelectItem value="250">250ms</SelectItem>
                                                                    <SelectItem value="500">500ms (Default)</SelectItem>
                                                                    <SelectItem value="1000">1 second</SelectItem>
                                                                    <SelectItem value="2000">2 seconds</SelectItem>
                                                                    <SelectItem value="3000">3 seconds</SelectItem>
                                                                    <SelectItem value="5000">5 seconds</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="text-xs text-muted-foreground italic">
                                                            Pauses execution. Use between captures to allow page scrolling.
                                                        </div>
                                                    </div>
                                                )}

                                                {step.type === "loop" && (
                                                    <div className="space-y-4">
                                                        <div className="space-y-2">
                                                            <Label>Iterations</Label>
                                                            <Select
                                                                value={String(step.config.iterations || 3)}
                                                                onValueChange={(val) => handleUpdateStep(step.id, { iterations: parseInt(val) })}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select iterations" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="2">2 times</SelectItem>
                                                                    <SelectItem value="3">3 times</SelectItem>
                                                                    <SelectItem value="5">5 times</SelectItem>
                                                                    <SelectItem value="10">10 times</SelectItem>
                                                                    <SelectItem value="15">15 times</SelectItem>
                                                                    <SelectItem value="20">20 times</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="border-l-2 border-dashed border-primary/30 pl-4 ml-2 text-xs text-muted-foreground">
                                                            <p className="font-medium mb-1">Loop Children: {(step.config.children || []).length} steps</p>
                                                            <p className="italic">Nested steps will be executed in each iteration.</p>
                                                            <p className="mt-1">To add children, manually edit the workflow JSON for now.</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    ))}

                                    <div className="flex gap-2 justify-center pt-4 flex-wrap">
                                        <Button variant="outline" size="sm" onClick={() => handleAddStep("capture_region")}>+ Capture</Button>
                                        <Button variant="outline" size="sm" onClick={() => handleAddStep("keypress")}>+ Keypress</Button>
                                        <Button variant="outline" size="sm" onClick={() => handleAddStep("wait")}>+ Wait</Button>
                                        <Button variant="outline" size="sm" onClick={() => handleAddStep("loop")}>+ Loop</Button>
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

            {/* Delete Workflow Confirmation Dialog */}
            {deleteConfirmWorkflowId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-background border rounded-lg p-6 max-w-md mx-4">
                        <h3 className="text-lg font-semibold mb-2">Delete Workflow</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Are you sure you want to delete this workflow? This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setDeleteConfirmWorkflowId(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    deleteWorkflow(deleteConfirmWorkflowId);
                                    setDeleteConfirmWorkflowId(null);
                                    if (selectedWorkflowId === deleteConfirmWorkflowId) {
                                        setSelectedWorkflowId(null);
                                    }
                                }}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </PageLayout>
    );
};

export default WorkflowEditor;
