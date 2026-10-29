import { Button, Header, Input, Selection, TextInput } from "@/components";
import { SearchableSelect } from "@/components/SearchableSelect";
import { UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { KeyIcon, TrashIcon, RefreshCwIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { listModels } from "@/lib/providers/model-discovery";
import { saveApiKey } from "@/lib/keychain";

export const Providers = ({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
  variables,
}: UseSettingsReturn) => {
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  useEffect(() => {
    if (selectedAIProvider?.provider) {
      const provider = allAiProviders?.find(
        (p) => p?.id === selectedAIProvider?.provider
      );
      if (provider) {
        const json = curl2Json(provider?.curl);
        setLocalSelectedProvider(json as ResultJSON);
      }
      // Auto-fetch models when provider changes
      fetchModelsForProvider(selectedAIProvider.provider);
    }
  }, [selectedAIProvider?.provider]);

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selectedAIProvider?.variables) return "";
    return selectedAIProvider?.variables?.[apiKeyVar.key] || "";
  };

  const isApiKeyEmpty = () => {
    return !getApiKeyValue().trim();
  };

  // Fetch available models from the provider's API.
  // Note: this passes `providerId` (the discovery target), not `selectedAIProvider.provider`,
  // fixing the latent bug that previously consulted the keychain under the wrong id.
  const fetchModelsForProvider = async (providerId: string) => {
    setIsLoadingModels(true);
    setFetchedModels([]);
    try {
      const provider = allAiProviders?.find(p => p?.id === providerId);
      if (!provider) throw new Error("Provider not found");
      const models = await listModels(providerId, provider);
      setFetchedModels(models);
    } catch (error) {
      console.error("Error fetching models:", error);
      setFetchedModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const getCurrentModelValue = () => {
    const modelVar = findKeyAndValue("model");
    if (!modelVar?.key || !selectedAIProvider?.variables) return "";
    return selectedAIProvider.variables[modelVar.key] || "";
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Header
          title="⚡ Default AI Provider"
          description="This provider is used for new chats and follow-up messages. Conversations remember their provider automatically."
        />
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            return {
              label: provider?.isCustom
                ? json?.url || "Custom Provider"
                : provider?.id || "Custom Provider",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your AI provider"
          onChange={(value) => {
            onSetSelectedAIProvider({
              provider: value,
              variables: {},
            });
          }}
        />
      </div>

      {localSelectedProvider ? (
        <Header
          title={`Method: ${localSelectedProvider?.method || "Invalid"
            }, Endpoint: ${localSelectedProvider?.url || "Invalid"}`}
          description={`If you want to use different url or method, you can always create a custom provider.`}
        />
      ) : null}

      {findKeyAndValue("api_key") ? (
        <div className="space-y-2">
          <Header
            title="API Key"
            description={`Enter your ${allAiProviders?.find(
              (p) => p?.id === selectedAIProvider?.provider
            )?.isCustom
                ? "Custom Provider"
                : selectedAIProvider?.provider
              } API key to authenticate and access AI models. Your key is stored locally and never shared.`}
          />

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="**********"
                value={getApiKeyValue()}
                onChange={(value) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]:
                        typeof value === "string" ? value : value.target.value,
                    },
                  });
                }}
                onBlur={(e) => {
                  const keyValue = (e.target as HTMLInputElement).value.trim();
                  if (keyValue && selectedAIProvider?.provider) {
                    saveApiKey(selectedAIProvider.provider, keyValue);
                  }
                }}
                onKeyDown={(e) => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;

                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [apiKeyVar.key]: (e.target as HTMLInputElement).value,
                    },
                  });
                }}
                disabled={false}
                className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
              />
              {isApiKeyEmpty() ? (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider || isApiKeyEmpty())
                      return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: getApiKeyValue(),
                      },
                    });
                  }}
                  disabled={isApiKeyEmpty()}
                  size="icon"
                  className="shrink-0 h-11 w-11"
                  title="Submit API Key"
                >
                  <KeyIcon className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const apiKeyVar = findKeyAndValue("api_key");
                    if (!apiKeyVar || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [apiKeyVar.key]: "",
                      },
                    });
                  }}
                  size="icon"
                  variant="destructive"
                  className="shrink-0 h-11 w-11"
                  title="Remove API Key"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Model Selection - Special handling with dropdown */}
      {findKeyAndValue("model") && (
        <div className="space-y-2">
          <Header
            title="Model"
            description={`Select or enter the model to use for ${selectedAIProvider?.provider || "this provider"}`}
          />
          <div className="flex gap-2">
            {fetchedModels.length > 0 ? (
              <SearchableSelect
                selected={getCurrentModelValue()}
                options={fetchedModels.map(model => ({
                  label: model,
                  value: model,
                }))}
                placeholder="Select a model"
                searchPlaceholder="Search models (e.g. free, claude, llama)..."
                emptyMessage="No matching models."
                onChange={(value) => {
                  const modelVar = findKeyAndValue("model");
                  if (!modelVar?.key || !selectedAIProvider) return;
                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [modelVar.key]: value,
                    },
                  });
                }}
                className="flex-1"
              />
            ) : (
              <TextInput
                placeholder={`Enter model name (e.g., gpt-4o, qwen2-vl-2b-instruct)`}
                value={getCurrentModelValue()}
                onChange={(value) => {
                  const modelVar = findKeyAndValue("model");
                  if (!modelVar?.key || !selectedAIProvider) return;
                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: {
                      ...selectedAIProvider.variables,
                      [modelVar.key]: value,
                    },
                  });
                }}
                className="flex-1"
              />
            )}
            <Button
              onClick={() => {
                if (selectedAIProvider?.provider) {
                  fetchModelsForProvider(selectedAIProvider.provider);
                }
              }}
              disabled={isLoadingModels || !selectedAIProvider?.provider}
              size="icon"
              variant="outline"
              className="shrink-0 h-11 w-11"
              title="Refresh available models"
            >
              {isLoadingModels ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="h-4 w-4" />
              )}
            </Button>
          </div>
          {isLoadingModels && (
            <p className="text-xs text-muted-foreground">Fetching available models...</p>
          )}
        </div>
      )}

      {/* Other variables (excluding api_key and model which are handled above) */}
      <div className="space-y-4 mt-2">
        {variables
          .filter(
            (variable) =>
              variable.key !== findKeyAndValue("api_key")?.key &&
              variable.key !== "model"
          )
          .map((variable) => {
            const getVariableValue = () => {
              if (!variable?.key || !selectedAIProvider?.variables) return "";
              return selectedAIProvider.variables[variable.key] || "";
            };

            return (
              <div className="space-y-1" key={variable?.key}>
                <Header
                  title={variable?.value || ""}
                  description={`add your preferred ${variable?.key?.replace(
                    /_/g,
                    " "
                  )} for ${allAiProviders?.find(
                    (p) => p?.id === selectedAIProvider?.provider
                  )?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                    }`}
                />
                <TextInput
                  placeholder={`Enter ${allAiProviders?.find(
                    (p) => p?.id === selectedAIProvider?.provider
                  )?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                    } ${variable?.key?.replace(/_/g, " ") || "value"}`}
                  value={getVariableValue()}
                  onChange={(value) => {
                    if (!variable?.key || !selectedAIProvider) return;

                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: {
                        ...selectedAIProvider.variables,
                        [variable.key]: value,
                      },
                    });
                  }}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
};
