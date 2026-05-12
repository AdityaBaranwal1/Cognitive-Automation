import { useState, useEffect } from "react";
import { Header, Button, Selection } from "@/components";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useConfig } from "@/contexts";
import { useModelTester, TestResult } from "@/hooks/useModelTester";
import {
    getProfiles,
    saveProfile,
    getProfileForModel,
    setProfileForModel,
} from "@/lib/storage/model-profiles.storage";
import { getProviderDefaults } from "@/config";
import { ModelProfile } from "@/types";
import {
    FlaskConicalIcon,
    Loader2Icon,
    CheckCircle2Icon,
    XCircleIcon,
    EyeIcon,
    AlertTriangleIcon,
    SaveIcon,
    RefreshCwIcon,
} from "lucide-react";
import { listModels } from "@/lib/providers/model-discovery";

/**
 * Model Manager component for testing and configuring model capabilities.
 * Lives in Dev Space below provider config.
 */
export const ModelManager = () => {
    const { allAiProviders, selectedAIProvider } = useConfig();
    const tester = useModelTester();

    // State
    const [showConfirm, setShowConfirm] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState<string>(
        selectedAIProvider?.provider || ""
    );
    const [selectedModel, setSelectedModel] = useState<string>(
        selectedAIProvider?.variables?.model || ""
    );
    const [fetchedModels, setFetchedModels] = useState<string[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [profiles, setProfiles] = useState<ModelProfile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<string>("");
    const [customProfileName, setCustomProfileName] = useState("");
    const [showSaveDialog, setShowSaveDialog] = useState(false);

    // Load profiles on mount
    useEffect(() => {
        setProfiles(getProfiles());
    }, []);

    // Sync with global selection
    useEffect(() => {
        if (selectedAIProvider?.provider) {
            setSelectedProvider(selectedAIProvider.provider);
            if (selectedAIProvider.variables?.model) {
                setSelectedModel(selectedAIProvider.variables.model);
            }
        }
    }, [selectedAIProvider]);

    // Fetch models when provider changes
    useEffect(() => {
        if (selectedProvider) {
            fetchModelsForProvider(selectedProvider);
            // Auto-select profile for current model
            const profileId = getProfileForModel(selectedModel);
            setSelectedProfileId(profileId);
        }
    }, [selectedProvider]);

    // Fetch available models for a provider
    const fetchModelsForProvider = async (providerId: string) => {
        setIsLoadingModels(true);
        try {
            const provider = allAiProviders?.find((p) => p?.id === providerId);
            if (!provider) return;
            const models = await listModels(providerId, provider);
            setFetchedModels(models);
            if (models.length > 0 && !selectedModel) {
                setSelectedModel(models[0]);
            }
        } catch (error) {
            console.error("Error fetching models:", error);
        } finally {
            setIsLoadingModels(false);
        }
    };

    // Get display name for provider
    const getProviderName = (providerId: string): string => {
        const provider = allAiProviders?.find((p) => p?.id === providerId);
        return provider?.name || providerId;
    };

    // Get current capabilities (from profile or estimate)
    const getCurrentCapabilities = (): TestResult | null => {
        if (tester.result) return tester.result;

        // Return estimate from provider defaults
        const defaults = getProviderDefaults(selectedProvider);
        return {
            supportsVision: defaults.vision,
            contextWindow: defaults.context,
            testedAt: 0,
            isEstimate: true,
        };
    };

    // Handle test button click
    const handleTestClick = () => {
        setShowConfirm(true);
    };

    // Confirm and run test
    const confirmTest = async () => {
        setShowConfirm(false);
        if (selectedProvider && selectedModel) {
            await tester.runFullTest(selectedProvider, selectedModel);
        }
    };

    // Save test result as profile
    const handleSaveProfile = () => {
        if (!tester.result || !customProfileName.trim()) return;

        const newProfile: ModelProfile = {
            id: `custom-${Date.now()}`,
            name: customProfileName.trim(),
            supportsVision: tester.result.supportsVision,
            contextWindow: tester.result.contextWindow,
        };

        saveProfile(newProfile);
        setProfileForModel(selectedModel, newProfile.id);
        setProfiles(getProfiles());
        setSelectedProfileId(newProfile.id);
        setShowSaveDialog(false);
        setCustomProfileName("");
    };

    // Apply existing profile to model
    const handleApplyProfile = (profileId: string) => {
        setProfileForModel(selectedModel, profileId);
        setSelectedProfileId(profileId);
    };

    const capabilities = getCurrentCapabilities();

    return (
        <div className="space-y-4">
            <Header
                title="🧪 Model Capabilities"
                description="Test and configure model capabilities for context management."
                isMainTitle
            />

            <Card className="p-4 space-y-4">
                {/* Provider & Model Selection */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Provider</label>
                        <Selection
                            selected={selectedProvider}
                            options={allAiProviders?.map((p) => ({
                                label: getProviderName(p?.id || ""),
                                value: p?.id || "",
                                isCustom: p?.isCustom,
                            })) || []}
                            placeholder="Select provider"
                            onChange={setSelectedProvider}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Model</label>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <Selection
                                    selected={selectedModel}
                                    options={fetchedModels.map((m) => ({ label: m, value: m }))}
                                    placeholder={isLoadingModels ? "Loading..." : "Select model"}
                                    isLoading={isLoadingModels}
                                    onChange={setSelectedModel}
                                />
                            </div>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => selectedProvider && fetchModelsForProvider(selectedProvider)}
                                disabled={!selectedProvider || isLoadingModels}
                                title="Refresh available models"
                                className="h-11 w-11 shrink-0"
                            >
                                {isLoadingModels ? (
                                    <Loader2Icon className="size-4 animate-spin" />
                                ) : (
                                    <RefreshCwIcon className="size-4" />
                                )}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Current Capabilities Display */}
                {capabilities && (
                    <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Current Capabilities</span>
                            {capabilities.isEstimate ? (
                                <Badge variant="secondary" className="text-xs">
                                    <AlertTriangleIcon className="size-3 mr-1" />
                                    Estimated
                                </Badge>
                            ) : (
                                <Badge variant="default" className="text-xs bg-green-500/20 text-green-500">
                                    <CheckCircle2Icon className="size-3 mr-1" />
                                    Tested
                                </Badge>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex items-center gap-2">
                                <EyeIcon className="size-4 text-muted-foreground" />
                                <span>Vision:</span>
                                {capabilities.supportsVision ? (
                                    <CheckCircle2Icon className="size-4 text-green-500" />
                                ) : (
                                    <XCircleIcon className="size-4 text-red-500" />
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">Context:</span>
                                <span className="font-mono">
                                    {capabilities.contextWindow.toLocaleString()} tokens
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Test Progress */}
                {tester.isLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2Icon className="size-4 animate-spin" />
                        {tester.testProgress}
                    </div>
                )}

                {/* Error Display */}
                {tester.error && (
                    <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                        {tester.error}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    <Button
                        onClick={handleTestClick}
                        disabled={!selectedProvider || !selectedModel || tester.isLoading}
                        className="gap-2"
                    >
                        <FlaskConicalIcon className="size-4" />
                        Test Capabilities
                    </Button>

                    {tester.result && !tester.result.isEstimate && (
                        <Button
                            variant="outline"
                            onClick={() => setShowSaveDialog(true)}
                            className="gap-2"
                        >
                            <SaveIcon className="size-4" />
                            Save as Profile
                        </Button>
                    )}
                </div>

                {/* Apply Existing Profile */}
                {profiles.length > 0 && (
                    <div className="space-y-2 pt-2 border-t">
                        <label className="text-sm font-medium">Or Apply Existing Profile</label>
                        <div className="flex gap-2">
                            <Selection
                                selected={selectedProfileId}
                                options={profiles.map((p) => ({
                                    label: `${p.name} (${p.contextWindow.toLocaleString()}, ${p.supportsVision ? "Vision" : "Text"})`,
                                    value: p.id,
                                }))}
                                placeholder="Select profile"
                                onChange={handleApplyProfile}
                            />
                        </div>
                    </div>
                )}
            </Card>

            {/* Confirmation Dialog */}
            <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>⚠️ Test Model Capabilities</DialogTitle>
                        <DialogDescription className="space-y-2">
                            <p>This will send test requests to verify:</p>
                            <ul className="list-disc list-inside text-sm">
                                <li>Vision support (small image test)</li>
                                <li>Context window (progressive test)</li>
                            </ul>
                            <p className="font-medium text-yellow-600 dark:text-yellow-500">
                                Estimated cost: ~$0.01 in API tokens
                            </p>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowConfirm(false)}>
                            Cancel
                        </Button>
                        <Button onClick={confirmTest}>Run Test</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Save Profile Dialog */}
            <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Save as Profile</DialogTitle>
                        <DialogDescription>
                            Save these capabilities as a reusable profile.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Profile Name</label>
                            <Input
                                placeholder="e.g., My Local Vision Model"
                                value={customProfileName}
                                onChange={(e) => setCustomProfileName(e.target.value)}
                            />
                        </div>
                        {tester.result && (
                            <div className="text-sm text-muted-foreground">
                                Vision: {tester.result.supportsVision ? "Yes" : "No"} |
                                Context: {tester.result.contextWindow.toLocaleString()} tokens
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveProfile} disabled={!customProfileName.trim()}>
                            Save Profile
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ModelManager;
