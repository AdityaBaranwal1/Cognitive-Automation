import type { TYPE_PROVIDER } from "@/types/provider.type";
import { getApiKey } from "@/lib/keychain";
import { getSavedProviderById } from "@/lib/storage/saved-providers.storage";
import { PROVIDER_PRESETS } from "@/config/provider-presets.constants";
import { presetToProvider } from "./preset-to-curl.function";

/**
 * Resolves a provider for an API call by injecting the real API key
 * from OS keychain into the variables map at call time.
 *
 * This is the bridge between keychain storage and the existing
 * fetchAIResponse pipeline which expects API_KEY in variables.
 */
export async function resolveProviderForCall(
  providerId: string,
  allAiProviders: TYPE_PROVIDER[],
  providerConfigs: Record<string, Record<string, string>>
): Promise<{
  provider: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
}> {
  const provider = allAiProviders.find((p) => p.id === providerId);
  if (!provider) {
    throw new Error(`Provider "${providerId}" not found`);
  }

  // Start with existing config variables (MODEL, etc.)
  const configVars = providerConfigs[providerId] ?? {};
  const variables: Record<string, string> = { ...configVars };

  // Inject API key from keychain if not already in variables
  if (!variables.API_KEY || variables.API_KEY === "") {
    const keychainKey = await getApiKey(providerId);
    if (keychainKey) {
      variables.API_KEY = keychainKey;
    }
  }

  return {
    provider: { ...provider, variables },
    selectedProvider: { provider: providerId, variables },
  };
}

/**
 * Resolve a SavedProviderConfig into a hydrated TYPE_PROVIDER + variables.
 * Fetches API key from keychain using the config's UUID.
 */
export async function resolveFromSavedConfig(
  configId: string
): Promise<{
  provider: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
} | null> {
  const config = getSavedProviderById(configId);
  if (!config) {
    console.warn(`[provider-resolver] No SavedProviderConfig found for ID: ${configId}`);
    return null;
  }

  const preset = PROVIDER_PRESETS[config.presetId];
  if (!preset) {
    console.warn(`[provider-resolver] No preset found for presetId: ${config.presetId}`);
    return null;
  }

  // Fetch API key from keychain using the config UUID
  const apiKey = (await getApiKey(configId)) ?? "";
  if (!apiKey) {
    console.warn(`[provider-resolver] No API key in keychain for config: ${configId} (preset: ${config.presetId})`);
  }
  const variables: Record<string, string> = {
    model: config.model,
    MODEL: config.model,
    API_KEY: apiKey,
    api_key: apiKey,
  };

  const provider = presetToProvider(preset, variables);

  return {
    provider,
    selectedProvider: { provider: config.presetId, variables },
  };
}

/**
 * Lightweight version: just injects the keychain key into existing variables.
 * Use when you already have the provider object and just need the key.
 */
export async function injectKeychainKey(
  providerId: string,
  variables: Record<string, string>
): Promise<Record<string, string>> {
  // Check both cases — extractVariables() lowercases keys
  const existingKey = variables.API_KEY || variables.api_key || "";
  if (existingKey !== "") {
    console.debug(`[provider-resolver] Using existing key for ${providerId}`);
    return variables;
  }
  const keychainKey = await getApiKey(providerId);
  if (keychainKey) {
    console.debug(`[provider-resolver] Injected keychain key for ${providerId}`);
    return { ...variables, API_KEY: keychainKey, api_key: keychainKey };
  }
  console.warn(`[provider-resolver] NO KEY FOUND for ${providerId} — call will fail`);
  return variables;
}
