import { useState, useEffect } from "react";
import { Header, Button, Selection } from "@/components";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/contexts";
import { useModelTester, TestResult } from "@/hooks/useModelTester";
import {
    getProfiles,
    saveProfile,
    getProfileForModel,
    setProfileForModel,
    deleteProfile,
    getGlobalDefaultProfileId,
    setGlobalDefaultProfileId,
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
    Trash2Icon,
    TimerIcon,
    PencilIcon,
    StarIcon,
} from "lucide-react";
import curl2Json from "@bany/curl-to-json";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * Context Management Page
 * Configure how Pluely handles AI context, model capabilities, and conversation history.
 */
const Context = () => {
    const { allAiProviders, selectedAIProvider } = useApp();
    const tester = useModelTester();

    // State
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
    const [showConfirm, setShowConfirm] = useState(false);

    // Profile editor state
    const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
    const [editName, setEditName] = useState("");
    const [editVision, setEditVision] = useState(true);
    const [editContext, setEditContext] = useState(32000);

    // Test delay settings
    const [testDelay, setTestDelay] = useState(30); // seconds between tests

    // Global default profile
    const [globalDefaultId, setGlobalDefaultId] = useState(getGlobalDefaultProfileId());

    // Load profiles on mount
    useEffect(() => {
        setProfiles(getProfiles());
        setGlobalDefaultId(getGlobalDefaultProfileId());
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

            let baseUrl = "";
            let apiKey = "";

            try {
                const curlJson = curl2Json(provider.curl);
                const url = curlJson.url;

                if (url.includes("/chat/completions")) {
                    baseUrl = url.split("/chat/completions")[0];
                } else if (url.includes("/completions")) {
                    baseUrl = url.split("/completions")[0];
                } else {
                    const urlObj = new URL(url);
                    baseUrl = `${urlObj.protocol}//${urlObj.host}/v1`;
                }

                apiKey = provider.variables?.API_KEY || provider.variables?.api_key || "";

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
                if (providerId === "lm-studio") baseUrl = "http://localhost:1234/v1";
            }

            if (!baseUrl) return;

            const modelsUrl = `${baseUrl}/models`;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (apiKey && !apiKey.includes("{{")) {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

            const isLocal = modelsUrl.includes("localhost") || modelsUrl.includes("127.0.0.1");
            const fetchFn = isLocal ? fetch : tauriFetch;

            const response = await fetchFn(modelsUrl, { method: "GET", headers });
            if (response.ok) {
                const data = await response.json();
                const models = data.data?.map((m: any) => m.id) || [];
                setFetchedModels(models);
                if (models.length > 0 && !selectedModel) {
                    setSelectedModel(models[0]);
                }
            }
        } catch (error) {
            console.error("Error fetching models:", error);
        } finally {
            setIsLoadingModels(false);
        }
    };

    // Get provider name for display
    const getProviderName = (providerId: string): string => {
        const provider = allAiProviders?.find((p) => p?.id === providerId);
        return provider?.name || providerId;
    };

    // Get current capabilities (from profile or estimate)
    const getCurrentCapabilities = (): TestResult | null => {
        if (tester.result) return tester.result;

        const defaults = getProviderDefaults(selectedProvider);
        return {
            supportsVision: defaults.vision,
            contextWindow: defaults.context,
            testedAt: 0,
            isEstimate: true,
        };
    };

    // Confirm and run test with delay
    const confirmTest = async () => {
        setShowConfirm(false);
        if (selectedProvider && selectedModel) {
            // Pass the delay to the tester (we'll implement this)
            await tester.runFullTest(selectedProvider, selectedModel, testDelay);
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


    // Delete a profile
    const handleDeleteProfile = (profileId: string) => {
        deleteProfile(profileId);
        setProfiles(getProfiles());
        if (selectedProfileId === profileId) {
            setSelectedProfileId("");
        }
    };

    // Open profile for editing
    const handleEditProfile = (profile: ModelProfile) => {
        setEditingProfile(profile);
        setEditName(profile.name);
        setEditVision(profile.supportsVision);
        setEditContext(profile.contextWindow);
    };

    // Save edited profile
    const handleSaveEditedProfile = () => {
        if (!editingProfile || !editName.trim()) return;

        const updatedProfile: ModelProfile = {
            ...editingProfile,
            name: editName.trim(),
            supportsVision: editVision,
            contextWindow: editContext,
        };

        saveProfile(updatedProfile);
        setProfiles(getProfiles());
        setEditingProfile(null);
    };

    const capabilities = getCurrentCapabilities();

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="space-y-6 pb-10 pt-6">
                {/* Page Header */}
                <Header
                    title="🧠 Model Profiles"
                    description="Configure how Pluely handles history and images for different models to prevent crashes and save tokens."
                    isMainTitle
                />

                {/* Section 1: Global Default Profile */}
                <Card className="p-4 space-y-4">
                    <div className="flex items-center gap-2">
                        <StarIcon className="size-4 text-yellow-500" />
                        <h3 className="font-semibold">Global Default Profile</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        This profile is used when a model doesn't have a specific profile assigned.
                        Select from the built-in or custom profiles below.
                    </p>

                    <div className="flex items-center gap-4">
                        <Selection
                            selected={globalDefaultId}
                            options={profiles.map((p) => ({
                                label: p.name,
                                value: p.id,
                            }))}
                            placeholder="Select default profile"
                            onChange={(v) => {
                                setGlobalDefaultId(v);
                                setGlobalDefaultProfileId(v);
                            }}
                        />
                        {profiles.find(p => p.id === globalDefaultId) && (
                            <div className="text-sm text-muted-foreground">
                                {profiles.find(p => p.id === globalDefaultId)?.supportsVision ? "✅ Vision" : "❌ No Vision"} |
                                {" "}{profiles.find(p => p.id === globalDefaultId)?.contextWindow.toLocaleString()} tokens
                            </div>
                        )}
                    </div>
                </Card>


                {/* Section 2: Model Testing (Beta) */}
                <Card className="p-4 space-y-4">
                    <div className="flex items-center gap-2">
                        <FlaskConicalIcon className="size-4 text-primary" />
                        <h3 className="font-semibold">Model Testing</h3>
                        <Badge variant="outline" className="text-xs">Beta</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Test a specific model's capabilities by sending probe requests.
                    </p>

                    {/* Provider & Model Selection */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Provider</label>
                            <Selection
                                selected={selectedProvider}
                                options={allAiProviders?.map((p) => ({
                                    label: getProviderName(p?.id || ""),
                                    value: p?.id || "",
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

                    {/* Test Delay Slider */}
                    <div className="space-y-2 p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <TimerIcon className="size-4 text-muted-foreground" />
                                <label className="text-sm font-medium">Test Delay</label>
                            </div>
                            <span className="text-sm font-mono">{testDelay}s</span>
                        </div>
                        <Slider
                            value={[testDelay]}
                            onValueChange={(v) => setTestDelay(v[0])}
                            min={5}
                            max={120}
                            step={5}
                            className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                            Wait time between tests to avoid rate limits. Higher = safer but slower.
                        </p>
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
                            onClick={() => setShowConfirm(true)}
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
                </Card>

                {/* Section 3: Model Profiles */}
                <Card className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold">Model Profiles</h3>
                            <Badge variant="secondary" className="text-xs">{profiles.length}</Badge>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Saved capability profiles for quick assignment to models.
                    </p>

                    {profiles.length > 0 ? (
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="text-left p-3 font-medium">Name</th>
                                        <th className="text-center p-3 font-medium">Vision</th>
                                        <th className="text-right p-3 font-medium">Context</th>
                                        <th className="text-right p-3 font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {profiles.map((profile) => (
                                        <tr key={profile.id} className="border-t hover:bg-muted/30 transition-colors">
                                            <td className="p-3">
                                                {profile.name}
                                                {profile.isDefault && (
                                                    <Badge variant="outline" className="ml-2 text-xs">Built-in</Badge>
                                                )}
                                            </td>
                                            <td className="p-3 text-center">
                                                {profile.supportsVision ? (
                                                    <CheckCircle2Icon className="size-4 text-green-500 mx-auto" />
                                                ) : (
                                                    <XCircleIcon className="size-4 text-red-500 mx-auto" />
                                                )}
                                            </td>
                                            <td className="p-3 text-right font-mono">
                                                {profile.contextWindow.toLocaleString()}
                                            </td>
                                            <td className="p-3 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {/* Star - indicates/sets as global default */}
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => {
                                                            setGlobalDefaultId(profile.id);
                                                            setGlobalDefaultProfileId(profile.id);
                                                        }}
                                                        className={`h-8 w-8 ${globalDefaultId === profile.id ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-500"}`}
                                                        title={globalDefaultId === profile.id ? "Current default" : "Set as global default"}
                                                    >
                                                        <StarIcon className={`size-4 ${globalDefaultId === profile.id ? "fill-yellow-500" : ""}`} />
                                                    </Button>
                                                    {/* Edit button - only for custom profiles */}
                                                    {!profile.isDefault && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleEditProfile(profile)}
                                                            className="h-8 w-8"
                                                            title="Edit profile"
                                                        >
                                                            <PencilIcon className="size-3" />
                                                        </Button>
                                                    )}
                                                    {/* Delete button - only for custom profiles */}
                                                    {!profile.isDefault && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDeleteProfile(profile.id)}
                                                            className="h-8 w-8 text-destructive hover:text-destructive"
                                                            title="Delete profile"
                                                        >
                                                            <Trash2Icon className="size-3" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="p-8 text-center text-muted-foreground border rounded-lg border-dashed">
                            No profiles yet. Test a model and save the results.
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
                                    ⏱️ Tests will run with {testDelay}s delay between each
                                </p>
                                <p className="text-yellow-600 dark:text-yellow-500">
                                    💰 Estimated cost: varies by model (could be $0.01-$0.50)
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

                {/* Edit Profile Dialog */}
                <Dialog open={!!editingProfile} onOpenChange={(open) => !open && setEditingProfile(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Edit Profile</DialogTitle>
                            <DialogDescription>
                                Modify the profile settings.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Profile Name</label>
                                <Input
                                    placeholder="Profile name"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Vision Support</label>
                                <Selection
                                    selected={editVision ? "true" : "false"}
                                    options={[
                                        { label: "Enabled", value: "true" },
                                        { label: "Disabled", value: "false" },
                                    ]}
                                    onChange={(v) => setEditVision(v === "true")}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Context Window (tokens)</label>
                                <Input
                                    type="number"
                                    placeholder="e.g., 32000"
                                    value={editContext}
                                    onChange={(e) => setEditContext(Number(e.target.value))}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setEditingProfile(null)}>
                                Cancel
                            </Button>
                            <Button onClick={handleSaveEditedProfile} disabled={!editName.trim()}>
                                Save Changes
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

export default Context;
