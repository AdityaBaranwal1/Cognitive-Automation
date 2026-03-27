import { getItem, saveItem, removeItem } from "tauri-plugin-keychain";

const KEYCHAIN_PREFIX = "autovision_";
const KEYCHAIN_INDEX_KEY = "keychain_provider_index";

// Fallback flag: if OS keychain fails, we degrade to localStorage
let keychainAvailable: boolean | null = null;

function getKeychainKey(providerId: string): string {
  return `${KEYCHAIN_PREFIX}${providerId}`;
}

function getIndex(): string[] {
  try {
    const raw = localStorage.getItem(KEYCHAIN_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setIndex(ids: string[]): void {
  localStorage.setItem(KEYCHAIN_INDEX_KEY, JSON.stringify(ids));
}

async function isKeychainAvailable(): Promise<boolean> {
  if (keychainAvailable !== null) return keychainAvailable;
  try {
    // Test with a dummy write/read/delete cycle
    const testKey = `${KEYCHAIN_PREFIX}_test`;
    await saveItem(testKey, "test");
    await removeItem(testKey);
    keychainAvailable = true;
  } catch {
    console.warn("OS Keychain unavailable, falling back to localStorage");
    keychainAvailable = false;
  }
  return keychainAvailable;
}

// Fallback localStorage keys for when keychain is unavailable
const FALLBACK_PREFIX = "autovision_key_fallback_";

export async function saveApiKey(
  providerId: string,
  key: string
): Promise<void> {
  const available = await isKeychainAvailable();
  if (available) {
    await saveItem(getKeychainKey(providerId), key);
  } else {
    localStorage.setItem(`${FALLBACK_PREFIX}${providerId}`, key);
  }
  // Update index
  const index = getIndex();
  if (!index.includes(providerId)) {
    index.push(providerId);
    setIndex(index);
  }
}

export async function getApiKey(
  providerId: string
): Promise<string | null> {
  const available = await isKeychainAvailable();
  if (available) {
    return await getItem(getKeychainKey(providerId));
  }
  return localStorage.getItem(`${FALLBACK_PREFIX}${providerId}`);
}

export async function deleteApiKey(providerId: string): Promise<void> {
  const available = await isKeychainAvailable();
  if (available) {
    await removeItem(getKeychainKey(providerId));
  } else {
    localStorage.removeItem(`${FALLBACK_PREFIX}${providerId}`);
  }
  const index = getIndex().filter((id) => id !== providerId);
  setIndex(index);
}

export async function hasApiKey(providerId: string): Promise<boolean> {
  const key = await getApiKey(providerId);
  return key !== null && key.length > 0;
}

export function getStoredProviderIds(): string[] {
  return getIndex();
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  const prefix = key.slice(0, 4);
  const suffix = key.slice(-4);
  return `${prefix}${"•".repeat(Math.min(key.length - 8, 20))}${suffix}`;
}
