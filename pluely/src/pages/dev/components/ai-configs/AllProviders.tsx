import { Button, Header } from "@/components";
import { PROVIDER_PRESETS } from "@/config/provider-presets.constants";
import { deleteApiKey } from "@/lib/keychain";
import {
  getSavedProviders,
  removeSavedProvider,
  setDefaultProvider,
} from "@/lib/storage/saved-providers.storage";
import type { SavedProviderConfig } from "@/types/provider-preset.type";
import { StarIcon, TrashIcon, ServerIcon } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTauriEvent } from "@/lib/tauri/use-event";

export const AllProviders = () => {
  const [configs, setConfigs] = useState<SavedProviderConfig[]>([]);

  const loadConfigs = useCallback(() => {
    setConfigs(getSavedProviders());
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useTauriEvent<string>(
    "data-updated",
    (event) => {
      if (event.payload === "saved_provider_configs") {
        loadConfigs();
      }
    },
    [loadConfigs],
  );

  const handleSetDefault = (id: string) => {
    setDefaultProvider(id);
    loadConfigs();
  };

  const handleDelete = async (config: SavedProviderConfig) => {
    await deleteApiKey(config.id);
    removeSavedProvider(config.id);
    loadConfigs();
  };

  if (configs.length === 0) {
    return (
      <div className="space-y-3">
        <Header
          title="All Providers"
          description="Your saved provider configurations appear here."
          isMainTitle
        />
        <div className="rounded-xl border border-dashed border-muted-foreground/30 p-8 text-center">
          <ServerIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No providers configured yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Use Quick Setup or Select Provider above to add your first provider.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Header
        title="All Providers"
        description="Manage your saved provider configurations. Star one to set it as default."
        isMainTitle
      />

      <div className="space-y-2">
        {configs.map((config) => {
          const preset = PROVIDER_PRESETS[config.presetId];
          const providerName = preset?.name ?? config.presetId;

          return (
            <div
              key={config.id}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                config.isDefault
                  ? "border-primary/40 bg-primary/5"
                  : "border-input/50 hover:border-input"
              }`}
            >
              {/* Default star */}
              <button
                onClick={() => handleSetDefault(config.id)}
                className="shrink-0"
                title={config.isDefault ? "Default provider" : "Set as default"}
              >
                <StarIcon
                  className={`h-4 w-4 transition-colors ${
                    config.isDefault
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground/40 hover:text-yellow-400"
                  }`}
                />
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {config.name}
                  </span>
                  {config.isDefault && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      DEFAULT
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {providerName} &middot; {config.model}
                </div>
              </div>

              {/* Delete */}
              <Button
                onClick={() => handleDelete(config)}
                size="icon"
                variant="ghost"
                className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                title="Remove provider"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
