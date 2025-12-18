import { useState } from "react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, RefreshCwIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { useApp } from "@/contexts";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import curl2Json from "@bany/curl-to-json";

interface ModelSwitcherProps {
    currentProviderId?: string;
    currentModel?: string;
    onSwitch: (providerId: string, model: string) => void;
}

interface ProviderModels {
    providerId: string;
    providerName: string;
    models: string[];
    isLoading: boolean;
}

export const ModelSwitcher = ({
    currentProviderId,
    currentModel,
    onSwitch,
}: ModelSwitcherProps) => {
    const { allAiProviders, selectedAIProvider } = useApp();
    const [providerModels, setProviderModels] = useState<Map<string, ProviderModels>>(new Map());
    const [isOpen, setIsOpen] = useState(false);

    // Determine display values
    const effectiveProviderId = currentProviderId || selectedAIProvider?.provider;
    const effectiveModel = currentModel || selectedAIProvider?.variables?.model;

    // Get provider name for display
    const getProviderName = (providerId: string): string => {
        const provider = allAiProviders?.find((p) => p?.id === providerId);
        if (!provider) return providerId;
        if (provider.isCustom) {
            try {
                const json = curl2Json(provider.curl);
                return json?.url ? new URL(json.url).hostname : "Custom";
            } catch {
                return "Custom";
            }
        }
        return provider.name || provider.id || "Unknown";
    };

    // Fetch models for a specific provider
    const fetchModelsForProvider = async (providerId: string): Promise<string[]> => {
        try {
            const provider = allAiProviders?.find((p) => p?.id === providerId);
            if (!provider) return [];

            let baseUrl = "";
            let apiKey = "";

            try {
                const curlJson = curl2Json(provider.curl);
                const url = curlJson.url;

                // Extract Base URL
                if (url.includes("/chat/completions")) {
                    baseUrl = url.split("/chat/completions")[0];
                } else if (url.includes("/completions")) {
                    baseUrl = url.split("/completions")[0];
                } else {
                    const urlObj = new URL(url);
                    baseUrl = `${urlObj.protocol}//${urlObj.host}/v1`;
                }

                // Extract API Key
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

            if (!baseUrl) return [];

            const modelsUrl = `${baseUrl}/models`;
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };

            if (apiKey && !apiKey.includes("{{")) {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

            const isLocal = modelsUrl.includes("localhost") || modelsUrl.includes("127.0.0.1");
            const fetchFn = isLocal ? fetch : tauriFetch;

            const response = await fetchFn(modelsUrl, {
                method: "GET",
                headers,
            });

            if (!response.ok) return [];

            const data = await response.json();
            return data.data?.map((m: any) => m.id) || [];
        } catch (error) {
            console.error("Error fetching models:", error);
            return [];
        }
    };

    // Load models when dropdown opens
    const handleOpenChange = async (open: boolean) => {
        setIsOpen(open);
        if (open) {
            // Start loading models for all providers
            for (const provider of allAiProviders || []) {
                if (!provider?.id) continue;
                const existing = providerModels.get(provider.id);
                if (existing && existing.models.length > 0) continue; // Already loaded

                // Mark as loading
                setProviderModels((prev) => {
                    const next = new Map(prev);
                    next.set(provider.id!, {
                        providerId: provider.id!,
                        providerName: getProviderName(provider.id!),
                        models: [],
                        isLoading: true,
                    });
                    return next;
                });

                // Fetch models
                fetchModelsForProvider(provider.id).then((models) => {
                    setProviderModels((prev) => {
                        const next = new Map(prev);
                        next.set(provider.id!, {
                            providerId: provider.id!,
                            providerName: getProviderName(provider.id!),
                            models: models.length > 0 ? models : [selectedAIProvider?.variables?.model || "default"],
                            isLoading: false,
                        });
                        return next;
                    });
                });
            }
        }
    };

    // Refresh models for a provider
    const refreshProvider = async (providerId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        setProviderModels((prev) => {
            const next = new Map(prev);
            const existing = next.get(providerId);
            if (existing) {
                next.set(providerId, { ...existing, isLoading: true });
            }
            return next;
        });

        const models = await fetchModelsForProvider(providerId);
        setProviderModels((prev) => {
            const next = new Map(prev);
            next.set(providerId, {
                providerId,
                providerName: getProviderName(providerId),
                models: models.length > 0 ? models : ["default"],
                isLoading: false,
            });
            return next;
        });
    };

    const handleModelSelect = (providerId: string, model: string) => {
        onSwitch(providerId, model);
        setIsOpen(false);
    };

    return (
        <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="text-[10px] lg:text-sm h-6 lg:h-8 gap-1 max-w-[180px]"
                >
                    <SparklesIcon className="size-3 lg:size-4 shrink-0" />
                    <span className="truncate">
                        {effectiveProviderId
                            ? `${getProviderName(effectiveProviderId)}${effectiveModel ? ` / ${effectiveModel}` : ""}`
                            : "Select Model"}
                    </span>
                    <ChevronDown className="size-3 lg:size-4 shrink-0 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Switch AI Model
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allAiProviders?.map((provider) => {
                    if (!provider?.id) return null;
                    const models = providerModels.get(provider.id);
                    const isCurrentProvider = provider.id === effectiveProviderId;

                    return (
                        <DropdownMenuSub key={provider.id}>
                            <DropdownMenuSubTrigger
                                className={`cursor-pointer ${isCurrentProvider ? "bg-accent/50" : ""}`}
                            >
                                <div className="flex items-center justify-between w-full">
                                    <span className="truncate">{getProviderName(provider.id)}</span>
                                    {models?.isLoading && (
                                        <Loader2Icon className="size-3 animate-spin ml-2" />
                                    )}
                                </div>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                                <div className="flex items-center justify-between px-2 py-1">
                                    <span className="text-xs text-muted-foreground">Models</span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-5"
                                        onClick={(e) => refreshProvider(provider.id!, e)}
                                        disabled={models?.isLoading}
                                    >
                                        {models?.isLoading ? (
                                            <Loader2Icon className="size-3 animate-spin" />
                                        ) : (
                                            <RefreshCwIcon className="size-3" />
                                        )}
                                    </Button>
                                </div>
                                <DropdownMenuSeparator />
                                {models?.models && models.models.length > 0 ? (
                                    models.models.map((model) => (
                                        <DropdownMenuItem
                                            key={model}
                                            onClick={() => handleModelSelect(provider.id!, model)}
                                            className={`cursor-pointer ${isCurrentProvider && model === effectiveModel
                                                ? "bg-primary/10 font-medium"
                                                : ""
                                                }`}
                                        >
                                            <span className="truncate">{model}</span>
                                        </DropdownMenuItem>
                                    ))
                                ) : (
                                    <div className="px-2 py-2 text-xs text-muted-foreground">
                                        {models?.isLoading ? "Loading..." : "No models available"}
                                    </div>
                                )}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
