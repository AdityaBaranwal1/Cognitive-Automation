import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  PROVIDER_PRESETS,
  KEY_PREFIX_MAP,
  AMBIGUOUS_PROBE_PROVIDERS,
} from "@/config/provider-presets.constants";
import type { DetectionResult, ProviderPreset } from "@/types/provider-preset.type";

/**
 * Detect provider from API key prefix (instant, no network call).
 */
export function detectProviderFromKey(key: string): DetectionResult | null {
  const trimmed = key.trim();
  if (!trimmed) return null;

  for (const entry of KEY_PREFIX_MAP) {
    if (trimmed.startsWith(entry.prefix)) {
      return {
        providerId: entry.providerId,
        confidence: entry.confidence,
        needsProbe: entry.confidence < 100,
      };
    }
  }

  // Generic sk-* could be OpenAI, DeepSeek, or others
  if (trimmed.startsWith("sk-")) {
    return { providerId: "openai", confidence: 30, needsProbe: true };
  }

  return null;
}

/**
 * Probe a single provider endpoint to check if the key is valid.
 */
export async function probeProvider(
  preset: ProviderPreset,
  apiKey: string
): Promise<boolean> {
  const url = `${preset.baseUrl}${preset.modelsEndpoint}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (preset.authHeaderFormat === "bearer") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (preset.authHeaderFormat === "x-api-key") {
    headers["x-api-key"] = apiKey;
  }

  if (preset.extraHeaders) {
    Object.assign(headers, preset.extraHeaders);
  }

  try {
    const isLocal = url.startsWith("http://");
    const fetchFn = isLocal ? fetch : tauriFetch;
    const response = await fetchFn(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * For ambiguous keys (e.g. sk-*), probe multiple providers in parallel.
 * Returns the first matching provider ID, or null if none match.
 */
export async function resolveAmbiguousKey(
  key: string
): Promise<string | null> {
  const probes = AMBIGUOUS_PROBE_PROVIDERS.map(async (id) => {
    const preset = PROVIDER_PRESETS[id];
    if (!preset) return null;
    const valid = await probeProvider(preset, key);
    return valid ? id : null;
  });

  const results = await Promise.allSettled(probes);
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      return result.value;
    }
  }
  return null;
}

/**
 * Fetch available models from a provider's models endpoint.
 */
export async function fetchModelsForPreset(
  preset: ProviderPreset,
  apiKey: string
): Promise<string[]> {
  const url = `${preset.baseUrl}${preset.modelsEndpoint}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (preset.authHeaderFormat === "bearer") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (preset.authHeaderFormat === "x-api-key") {
    headers["x-api-key"] = apiKey;
  }

  if (preset.extraHeaders) {
    Object.assign(headers, preset.extraHeaders);
  }

  try {
    const isLocal = url.startsWith("http://");
    const fetchFn = isLocal ? fetch : tauriFetch;
    const response = await fetchFn(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const data = await response.json();

    // OpenAI format: { data: [{ id: "model-name" }] }
    if (data?.data && Array.isArray(data.data)) {
      return data.data
        .map((m: { id?: string }) => m.id)
        .filter(Boolean) as string[];
    }

    // Anthropic format: { models: [{ id: "model-name" }] }
    if (data?.models && Array.isArray(data.models)) {
      return data.models
        .map((m: { id?: string }) => m.id)
        .filter(Boolean) as string[];
    }

    return [];
  } catch {
    return [];
  }
}
