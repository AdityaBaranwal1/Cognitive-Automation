import { Button, Header, Input, TextInput } from "@/components";
import { SearchableSelect } from "@/components/SearchableSelect";
import { PROVIDER_PRESETS } from "@/config/provider-presets.constants";
import {
  detectProviderFromKey,
  resolveAmbiguousKey,
  fetchModelsForPreset,
} from "@/lib/functions/key-detection.service";
import { saveApiKey } from "@/lib/keychain";
import { addSavedProvider } from "@/lib/storage/saved-providers.storage";
import { UseSettingsReturn } from "@/types";
import {
  CheckCircleIcon,
  Loader2Icon,
  AlertCircleIcon,
  ZapIcon,
} from "lucide-react";
import { useState, useCallback } from "react";

interface QuickSetupState {
  rawKey: string;
  detectedProvider: string | null;
  confidence: number;
  isProbing: boolean;
  isValidating: boolean;
  isFetchingModels: boolean;
  availableModels: string[];
  error: string | null;
  success: boolean;
  selectedModel: string;
  configName: string;
}

export const QuickSetup = ({
  onSetSelectedAIProvider,
}: UseSettingsReturn) => {
  const [state, setState] = useState<QuickSetupState>({
    rawKey: "",
    detectedProvider: null,
    confidence: 0,
    isProbing: false,
    isValidating: false,
    isFetchingModels: false,
    availableModels: [],
    error: null,
    success: false,
    selectedModel: "",
    configName: "",
  });

  const handleKeyInput = useCallback(async (key: string) => {
    setState((prev) => ({
      ...prev,
      rawKey: key,
      error: null,
      success: false,
      availableModels: [],
      selectedModel: "",
      configName: "",
    }));

    if (!key.trim()) {
      setState((prev) => ({ ...prev, detectedProvider: null, confidence: 0 }));
      return;
    }

    const detection = detectProviderFromKey(key);
    if (!detection) {
      setState((prev) => ({
        ...prev,
        detectedProvider: null,
        confidence: 0,
        error: "Unrecognized key format. Try the Select Provider tab.",
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      detectedProvider: detection.providerId,
      confidence: detection.confidence,
    }));

    let resolvedProviderId = detection.providerId;

    if (detection.needsProbe) {
      setState((prev) => ({ ...prev, isProbing: true }));
      const probed = await resolveAmbiguousKey(key);
      if (probed) {
        resolvedProviderId = probed;
        setState((prev) => ({
          ...prev,
          detectedProvider: probed,
          confidence: 100,
          isProbing: false,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          isProbing: false,
          error: "Could not verify key. Try the Select Provider tab.",
        }));
        return;
      }
    }

    const preset = PROVIDER_PRESETS[resolvedProviderId];
    if (!preset) return;

    setState((prev) => ({ ...prev, isFetchingModels: true }));
    const models = await fetchModelsForPreset(preset, key);
    setState((prev) => ({ ...prev, isFetchingModels: false, availableModels: models }));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!state.detectedProvider || !state.rawKey || !state.selectedModel) return;

    setState((prev) => ({ ...prev, isValidating: true }));
    try {
      const preset = PROVIDER_PRESETS[state.detectedProvider];
      const defaultName = `${preset?.name ?? state.detectedProvider} / ${state.selectedModel}`;
      const name = state.configName.trim() || defaultName;

      // Create SavedProviderConfig
      const savedConfig = addSavedProvider({
        name,
        presetId: state.detectedProvider,
        model: state.selectedModel,
        isDefault: true,
      });

      // Save API key under the config's UUID
      await saveApiKey(savedConfig.id, state.rawKey);

      // Set as active provider (reference the saved config ID)
      onSetSelectedAIProvider({
        provider: savedConfig.id,
        variables: { model: state.selectedModel },
      });

      setState((prev) => ({
        ...prev,
        isValidating: false,
        success: true,
        rawKey: "",
      }));
      // AllProviders reloads via Tauri "data-updated" event
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isValidating: false,
        error: `Failed to save: ${err}`,
      }));
    }
  }, [state.detectedProvider, state.rawKey, state.selectedModel, state.configName, onSetSelectedAIProvider]);

  const presetName =
    state.detectedProvider && PROVIDER_PRESETS[state.detectedProvider]
      ? PROVIDER_PRESETS[state.detectedProvider].name
      : null;

  return (
    <div className="space-y-4">
      <Header
        title="Quick Setup"
        description="Paste your API key and we'll detect the provider automatically."
      />

      <Input
        type="password"
        placeholder="Paste your API key here (e.g. sk-or-...)"
        value={state.rawKey}
        onChange={(value) => {
          const v = typeof value === "string" ? value : value.target.value;
          handleKeyInput(v);
        }}
        className="h-12 text-base border-1 border-input/50 focus:border-primary/50"
      />

      {state.isProbing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          Detecting provider...
        </div>
      )}

      {presetName && !state.isProbing && (
        <div className="flex items-center gap-2 text-sm">
          <ZapIcon className="h-4 w-4 text-primary" />
          <span>
            Detected: <strong>{presetName}</strong>
            {state.confidence < 100 && (
              <span className="text-muted-foreground ml-1">({state.confidence}%)</span>
            )}
          </span>
        </div>
      )}

      {state.error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircleIcon className="h-4 w-4" />
          {state.error}
        </div>
      )}

      {state.isFetchingModels && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          Fetching available models...
        </div>
      )}

      {state.availableModels.length > 0 && (
        <div className="space-y-2">
          <Header title="Model" description="Select a model to use" />
          <SearchableSelect
            selected={state.selectedModel}
            options={state.availableModels.map((m) => ({ label: m, value: m }))}
            placeholder="Select a model"
            searchPlaceholder="Search models (e.g. free, claude, llama)..."
            emptyMessage="No matching models."
            onChange={(value) => setState((prev) => ({ ...prev, selectedModel: value }))}
          />
        </div>
      )}

      {/* Name field — shown after model selected */}
      {state.selectedModel && (
        <div className="space-y-2">
          <Header
            title="Name (optional)"
            description={`Default: "${presetName} / ${state.selectedModel}"`}
          />
          <TextInput
            placeholder="e.g. My Fast Free Model"
            value={state.configName}
            onChange={(value) => setState((prev) => ({ ...prev, configName: value }))}
          />
        </div>
      )}

      {state.detectedProvider && state.selectedModel && !state.success && (
        <Button
          onClick={handleConfirm}
          disabled={state.isValidating || !state.selectedModel || !state.rawKey}
          className="w-full h-11"
        >
          {state.isValidating && <Loader2Icon className="h-4 w-4 animate-spin mr-2" />}
          Save & Activate {state.configName.trim() || `${presetName} / ${state.selectedModel}`}
        </Button>
      )}

      {state.success && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircleIcon className="h-4 w-4" />
          Provider saved! Key stored securely in OS keychain.
        </div>
      )}
    </div>
  );
};
