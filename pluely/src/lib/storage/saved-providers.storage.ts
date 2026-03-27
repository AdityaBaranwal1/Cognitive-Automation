import type { SavedProviderConfig } from "@/types/provider-preset.type";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "saved_provider_configs";

function generateId(): string {
  return crypto.randomUUID();
}

export function getSavedProviders(): SavedProviderConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist(configs: SavedProviderConfig[]): void {
  const data = JSON.stringify(configs);
  localStorage.setItem(STORAGE_KEY, data);
  invoke("save_persistent_data", { key: STORAGE_KEY, data }).catch(() => {});
}

export function addSavedProvider(
  config: Omit<SavedProviderConfig, "id" | "createdAt">
): SavedProviderConfig {
  const configs = getSavedProviders();
  const newConfig: SavedProviderConfig = {
    ...config,
    id: generateId(),
    createdAt: Date.now(),
  };

  // If this is the first config or marked as default, ensure only one default
  if (newConfig.isDefault || configs.length === 0) {
    newConfig.isDefault = true;
    for (const c of configs) c.isDefault = false;
  }

  configs.push(newConfig);
  persist(configs);
  return newConfig;
}

export function removeSavedProvider(id: string): void {
  let configs = getSavedProviders().filter((c) => c.id !== id);
  // If we removed the default, make the first one default
  if (configs.length > 0 && !configs.some((c) => c.isDefault)) {
    configs[0].isDefault = true;
  }
  persist(configs);
}

export function updateSavedProvider(
  id: string,
  updates: Partial<SavedProviderConfig>
): void {
  const configs = getSavedProviders();
  const idx = configs.findIndex((c) => c.id === id);
  if (idx === -1) return;
  configs[idx] = { ...configs[idx], ...updates, id };
  persist(configs);
}

export function getDefaultProvider(): SavedProviderConfig | null {
  const configs = getSavedProviders();
  return configs.find((c) => c.isDefault) ?? configs[0] ?? null;
}

export function setDefaultProvider(id: string): void {
  const configs = getSavedProviders();
  for (const c of configs) {
    c.isDefault = c.id === id;
  }
  persist(configs);
}

export function getSavedProviderById(
  id: string
): SavedProviderConfig | null {
  return getSavedProviders().find((c) => c.id === id) ?? null;
}
