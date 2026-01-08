import { WorkflowStep, AIStepConfig, AwaitInputStepConfig, CaptureStepConfig, LoopStepConfig, KeypressStepConfig, WaitStepConfig } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Trash2, Camera, Brain, Clock, Repeat, Keyboard, Pause, Send, MousePointerClick, Sparkles } from 'lucide-react';
import { HotkeyRecorder } from '@/components';
import { getProfiles } from '@/lib/storage/model-profiles.storage';
import { getSuggestedProfileForModel } from '@/config';

// Icon mapping for step types
const stepIcons: Record<string, React.ElementType> = {
    capture_screen: Camera,
    capture_region: Camera,
    ai_process: Brain,
    wait: Clock,
    loop: Repeat,
    keypress: Keyboard,
    await_input: Pause,
    action_notification: Send,
};

const stepLabels: Record<string, string> = {
    capture_screen: 'Capture Screen',
    capture_region: 'Capture Region',
    ai_process: 'AI Processing',
    wait: 'Wait',
    loop: 'Loop',
    keypress: 'Keypress',
    await_input: 'Await Input',
    action_notification: 'Output Action',
};

interface StepEditorSidebarProps {
    step: WorkflowStep;
    stepIndex: number;
    onUpdate: (config: any) => void;
    onDelete: () => void;
    onClose: () => void;
    onPickRegion?: () => void;
    allAiProviders: Array<{ id?: string; isCustom?: boolean }>;
    systemPrompts: Array<{ id: string | number; name: string }>;
    workflows: Array<{ id: string; name: string }>;
    currentWorkflowId: string;
    isCapturing?: boolean;
}

export function StepEditorSidebar({
    step,
    stepIndex,
    onUpdate,
    onDelete,
    onClose,
    onPickRegion,
    allAiProviders,
    systemPrompts,
    workflows,
    currentWorkflowId,
    isCapturing = false,
}: StepEditorSidebarProps) {
    const Icon = stepIcons[step.type] || Brain;
    const label = stepLabels[step.type] || step.type;

    return (
        <div className="w-80 border-l border-border bg-card flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-md">
                        <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                        <h3 className="font-medium text-sm">{label}</h3>
                        <p className="text-xs text-muted-foreground">Step {stepIndex + 1}</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Content */}
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {/* Step Name - editable for all step types */}
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Custom Name</Label>
                        <Input
                            value={step.name || ''}
                            onChange={(e) => onUpdate({ __name__: e.target.value })}
                            placeholder={label}
                            className="h-9"
                        />
                        <p className="text-xs text-muted-foreground">
                            Give this step a descriptive name
                        </p>
                    </div>

                    {/* Capture Region */}
                    {step.type === 'capture_region' && (
                        <>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-muted p-2 rounded">X: {(step.config as CaptureStepConfig).x}</div>
                                <div className="bg-muted p-2 rounded">Y: {(step.config as CaptureStepConfig).y}</div>
                                <div className="bg-muted p-2 rounded">W: {(step.config as CaptureStepConfig).width}</div>
                                <div className="bg-muted p-2 rounded">H: {(step.config as CaptureStepConfig).height}</div>
                            </div>
                            <Button size="sm" variant="outline" onClick={onPickRegion} disabled={isCapturing} className="w-full">
                                <MousePointerClick className="mr-2 h-3 w-3" />
                                {isCapturing ? 'Picking...' : 'Set Watch Region'}
                            </Button>
                        </>
                    )}

                    {/* AI Process */}
                    {step.type === 'ai_process' && (
                        <>
                            <div className="space-y-2">
                                <Label>AI Provider</Label>
                                <Select
                                    value={(step.config as AIStepConfig).providerId || 'lm-studio'}
                                    onValueChange={(val) => onUpdate({ providerId: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Provider" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allAiProviders.map(p => (
                                            <SelectItem key={p.id} value={p.id || 'unknown'}>
                                                {p.id || 'Unknown'}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Model</Label>
                                <Input
                                    value={(step.config as AIStepConfig).model || ''}
                                    onChange={(e) => {
                                        const model = e.target.value;
                                        // Auto-suggest profile if not already set
                                        const currentProfile = (step.config as AIStepConfig).profileId;
                                        if (!currentProfile && model) {
                                            const suggested = getSuggestedProfileForModel(model);
                                            onUpdate({ model, profileId: suggested });
                                        } else {
                                            onUpdate({ model });
                                        }
                                    }}
                                    placeholder="e.g. qwen2-vl-2b-instruct"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="flex items-center gap-1">
                                    <Sparkles className="size-3" />
                                    Model Profile
                                </Label>
                                <Select
                                    value={(step.config as AIStepConfig).profileId || ''}
                                    onValueChange={(val) => onUpdate({ profileId: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Auto (based on model)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="">Auto (based on model)</SelectItem>
                                        {getProfiles().map(profile => (
                                            <SelectItem key={profile.id} value={profile.id}>
                                                {profile.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Controls context window and vision settings
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label>System Prompt</Label>
                                <Select
                                    value={(step.config as AIStepConfig).systemPromptId}
                                    onValueChange={(val) => onUpdate({ systemPromptId: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select prompt" />
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
                                <Label>User Prompt</Label>
                                <Textarea
                                    value={(step.config as AIStepConfig).prompt || ''}
                                    onChange={(e) => onUpdate({ prompt: e.target.value })}
                                    placeholder="e.g. Solve this puzzle..."
                                    className="h-20"
                                />
                            </div>
                        </>
                    )}

                    {/* Wait */}
                    {step.type === 'wait' && (
                        <div className="space-y-2">
                            <Label>Duration</Label>
                            <Select
                                value={String((step.config as WaitStepConfig).durationMs || 500)}
                                onValueChange={(val) => onUpdate({ durationMs: parseInt(val) })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="100">100ms</SelectItem>
                                    <SelectItem value="250">250ms</SelectItem>
                                    <SelectItem value="500">500ms</SelectItem>
                                    <SelectItem value="1000">1 second</SelectItem>
                                    <SelectItem value="2000">2 seconds</SelectItem>
                                    <SelectItem value="5000">5 seconds</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Keypress */}
                    {step.type === 'keypress' && (
                        <>
                            <div className="space-y-2">
                                <Label>Key</Label>
                                <Select
                                    value={(step.config as KeypressStepConfig).key || 'PageDown'}
                                    onValueChange={(val) => onUpdate({ key: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="PageDown">PageDown</SelectItem>
                                        <SelectItem value="PageUp">PageUp</SelectItem>
                                        <SelectItem value="ArrowDown">Arrow Down</SelectItem>
                                        <SelectItem value="ArrowUp">Arrow Up</SelectItem>
                                        <SelectItem value="Enter">Enter</SelectItem>
                                        <SelectItem value="Tab">Tab</SelectItem>
                                        <SelectItem value="Escape">Escape</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Modifiers</Label>
                                <div className="flex gap-3 flex-wrap">
                                    {['ctrl', 'alt', 'shift'].map((mod) => (
                                        <label key={mod} className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={((step.config as KeypressStepConfig).modifiers || []).includes(mod)}
                                                onChange={(e) => {
                                                    const current = (step.config as KeypressStepConfig).modifiers || [];
                                                    const updated = e.target.checked
                                                        ? [...current, mod]
                                                        : current.filter((m: string) => m !== mod);
                                                    onUpdate({ modifiers: updated });
                                                }}
                                                className="rounded"
                                            />
                                            <span className="text-xs capitalize">{mod}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Loop */}
                    {step.type === 'loop' && (
                        <div className="space-y-2">
                            <Label>Iterations</Label>
                            <Select
                                value={String((step.config as LoopStepConfig).iterations || 3)}
                                onValueChange={(val) => onUpdate({ iterations: parseInt(val) })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="2">2 times</SelectItem>
                                    <SelectItem value="3">3 times</SelectItem>
                                    <SelectItem value="5">5 times</SelectItem>
                                    <SelectItem value="10">10 times</SelectItem>
                                    <SelectItem value="20">20 times</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Loop children: {((step.config as LoopStepConfig).children || []).length} steps
                            </p>
                        </div>
                    )}

                    {/* Await Input */}
                    {step.type === 'await_input' && (
                        <div className="space-y-3">
                            <Label>Key Bindings</Label>
                            {((step.config as AwaitInputStepConfig).keymap || []).map((keyAction: any, idx: number) => (
                                <div key={idx} className="space-y-2 bg-muted/50 p-2 rounded">
                                    <HotkeyRecorder
                                        value={keyAction.key || ''}
                                        onChange={(key) => {
                                            const newKeymap = [...((step.config as AwaitInputStepConfig).keymap || [])];
                                            newKeymap[idx] = { ...newKeymap[idx], key };
                                            onUpdate({ keymap: newKeymap });
                                        }}
                                    />
                                    <Select
                                        value={keyAction.action}
                                        onValueChange={(val) => {
                                            const newKeymap = [...((step.config as AwaitInputStepConfig).keymap || [])];
                                            newKeymap[idx] = { ...newKeymap[idx], action: val as 'continue' | 'break' | 'keypress' | 'run_workflow' };
                                            onUpdate({ keymap: newKeymap });
                                        }}
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="continue">Continue</SelectItem>
                                            <SelectItem value="break">Stop</SelectItem>
                                            <SelectItem value="keypress">Keypress</SelectItem>
                                            <SelectItem value="run_workflow">Run Workflow</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    {keyAction.action === 'run_workflow' && (
                                        <Select
                                            value={keyAction.workflowId || ''}
                                            onValueChange={(val) => {
                                                const newKeymap = [...((step.config as AwaitInputStepConfig).keymap || [])];
                                                newKeymap[idx] = { ...newKeymap[idx], workflowId: val };
                                                onUpdate({ keymap: newKeymap });
                                            }}
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue placeholder="Select workflow" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {workflows.filter(w => w.id !== currentWorkflowId).map(w => (
                                                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    <Input
                                        value={keyAction.label || ''}
                                        placeholder="Label"
                                        className="h-8 text-xs"
                                        onChange={(e) => {
                                            const newKeymap = [...((step.config as AwaitInputStepConfig).keymap || [])];
                                            newKeymap[idx] = { ...newKeymap[idx], label: e.target.value };
                                            onUpdate({ keymap: newKeymap });
                                        }}
                                    />
                                </div>
                            ))}
                            <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                onClick={() => {
                                    const currentKeymap = (step.config as AwaitInputStepConfig).keymap || [];
                                    onUpdate({
                                        keymap: [...currentKeymap, { key: '', action: 'continue' as const, label: '' }]
                                    });
                                }}
                            >
                                + Add Key Binding
                            </Button>
                        </div>
                    )}

                    {/* Output Action */}
                    {step.type === 'action_notification' && (
                        <div className="space-y-2">
                            <Label>Output Destination</Label>
                            <Select
                                value={(step.config as any).title || 'Show in Chat Overlay'}
                                onValueChange={(val) => onUpdate({ title: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Show in Chat Overlay">Show in Chat Overlay</SelectItem>
                                    <SelectItem value="Copy to Clipboard">Copy to Clipboard</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
            </ScrollArea>

            {/* Footer */}
            <div className="p-4 border-t border-border">
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-destructive hover:bg-destructive/10"
                    onClick={onDelete}
                >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Step
                </Button>
            </div>
        </div>
    );
}
