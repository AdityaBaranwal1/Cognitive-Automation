import { Button, Header, Input, Selection, TextInput } from "@/components";
import { SearchableSelect } from "@/components/SearchableSelect";
import { PROVIDER_PRESETS } from "@/config/provider-presets.constants";
import { fetchModelsForPreset } from "@/lib/functions/key-detection.service";
import { saveApiKey } from "@/lib/keychain";
import { addSavedProvider } from "@/lib/storage/saved-providers.storage";
import { UseSettingsReturn } from "@/types";
import type { ProviderPreset } from "@/types/provider-preset.type";
import {
  RefreshCwIcon,
  Loader2Icon,
  CheckCircleIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState, useCallback } from "react";

export const StandardSetup = ({
  onSetSelectedAIProvider,
}: UseSettingsReturn) => {
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [configName, setConfigName] = useState("");
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const preset = PROVIDER_PRESETS[selectedPresetId] as ProviderPreset | undefined;

  const fetchModels = useCallback(
    async (presetId: string, key?: string) => {
      const p = PROVIDER_PRESETS[presetId];
      if (!p) return;
      const apiKey = key || apiKeyInput;
      if (!apiKey && p.authHeaderFormat !== "none") return;

      setIsLoadingModels(true);
      const fetched = await fetchModelsForPreset(p, apiKey);
      setModels(fetched);
      setIsLoadingModels(false);
    },
    [apiKeyInput]
  );

  const handleSave = useCallback(async () => {
    if (!selectedPresetId || !selectedModel) return;
    if (preset?.authHeaderFormat !== "none" && !apiKeyInput.trim()) return;

    setIsSaving(true);
    try {
      const defaultName = `${preset?.name ?? selectedPresetId} / ${selectedModel}`;
      const name = configName.trim() || defaultName;

      const savedConfig = addSavedProvider({
        name,
        presetId: selectedPresetId,
        model: selectedModel,
        isDefault: true,
      });

      // Save API key under config UUID
      if (apiKeyInput.trim()) {
        await saveApiKey(savedConfig.id, apiKeyInput.trim());
      }

      onSetSelectedAIProvider({
        provider: savedConfig.id,
        variables: { model: selectedModel },
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setApiKeyInput("");
      // AllProviders reloads via Tauri "data-updated" event
    } catch (err) {
      console.error("Failed to save:", err);
    }
    setIsSaving(false);
  }, [selectedPresetId, selectedModel, apiKeyInput, configName, preset, onSetSelectedAIProvider]);

  const presetOptions = Object.values(PROVIDER_PRESETS).map((p) => ({
    label: p.name,
    value: p.id,
  }));

  return (
    <div className="space-y-4">
      <Header
        title="Select Provider"
        description="Choose a provider, enter your API key, and select a model."
      />

      <div className="space-y-2">
        <Header title="Provider" description="Select an AI provider" />
        <Selection
          selected={selectedPresetId}
          options={presetOptions}
          placeholder="Choose a provider"
          onChange={(value) => {
            setSelectedPresetId(value);
            setSelectedModel("");
            setApiKeyInput("");
            setConfigName("");
            setSaved(false);
            setModels([]);
          }}
        />
      </div>

      {preset && preset.authHeaderFormat !== "none" && (
        <div className="space-y-2">
          <Header title="API Key" description={`Enter your ${preset.name} API key`} />
          <Input
            type="password"
            placeholder="Enter API key"
            value={apiKeyInput}
            onChange={(v) => setApiKeyInput(typeof v === "string" ? v : v.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKeyInput.trim()) {
                fetchModels(selectedPresetId, apiKeyInput.trim());
              }
            }}
            className="h-11 border-1 border-input/50"
          />
          {apiKeyInput.trim() && (
            <Button
              onClick={() => fetchModels(selectedPresetId, apiKeyInput.trim())}
              variant="outline"
              size="sm"
              disabled={isLoadingModels}
            >
              {isLoadingModels ? <Loader2Icon className="h-3 w-3 animate-spin mr-1" /> : null}
              Fetch Models
            </Button>
          )}
        </div>
      )}

      {preset && preset.authHeaderFormat === "none" && (
        <Button
          onClick={() => fetchModels(selectedPresetId)}
          variant="outline"
          size="sm"
          disabled={isLoadingModels}
        >
          {isLoadingModels ? <Loader2Icon className="h-3 w-3 animate-spin mr-1" /> : null}
          Fetch Models from {preset.name}
        </Button>
      )}

      {preset && (
        <div className="space-y-2">
          <Header title="Model" description={`Select or type a model for ${preset.name}`} />
          <div className="flex gap-2">
            {models.length > 0 ? (
              <SearchableSelect
                selected={selectedModel}
                options={models.map((m) => ({ label: m, value: m }))}
                placeholder="Select a model"
                searchPlaceholder="Search models (e.g. free, claude, llama)..."
                emptyMessage="No matching models."
                onChange={setSelectedModel}
                className="flex-1"
              />
            ) : (
              <TextInput
                placeholder="Enter model name"
                value={selectedModel}
                onChange={setSelectedModel}
                className="flex-1"
              />
            )}
            <Button
              onClick={() => fetchModels(selectedPresetId)}
              disabled={isLoadingModels}
              size="icon"
              variant="outline"
              className="shrink-0 h-11 w-11"
              title="Refresh models"
            >
              {isLoadingModels ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {selectedModel && (
        <div className="space-y-2">
          <Header
            title="Name (optional)"
            description={`Default: "${preset?.name} / ${selectedModel}"`}
          />
          <TextInput
            placeholder="e.g. My Claude Config"
            value={configName}
            onChange={setConfigName}
          />
        </div>
      )}

      {preset && selectedModel && (
        <Button
          onClick={handleSave}
          disabled={isSaving || (preset.authHeaderFormat !== "none" && !apiKeyInput.trim())}
          className="w-full h-11"
        >
          {isSaving && <Loader2Icon className="h-4 w-4 animate-spin mr-2" />}
          {saved ? <CheckCircleIcon className="h-4 w-4 mr-2" /> : null}
          {saved ? "Saved!" : `Save & Activate ${configName.trim() || `${preset.name} / ${selectedModel}`}`}
        </Button>
      )}

      {saved && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <ShieldCheckIcon className="h-4 w-4" />
          Provider saved! Key stored securely in OS keychain.
        </div>
      )}
    </div>
  );
};
