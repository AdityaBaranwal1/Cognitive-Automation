/**
 * Single source for "parse curl → derive /models URL → fetch model list"
 * — a recipe previously duplicated across 6 call sites:
 *   - workflows/index.tsx:176-266
 *   - chats/components/ModelSwitcher.tsx:87-166
 *   - dev/components/ai-configs/ModelManager.tsx:86-157
 *   - context/index.tsx:106-176
 *   - dev/components/ai-configs/Providers.tsx:50-133
 *   - hooks/useModelTester.ts:41-107 (related but post-only)
 *
 * Also exposes the keychain-resolution chain so callers can be thin wrappers.
 */

import curl2Json from "@bany/curl-to-json";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { TYPE_PROVIDER } from "@/types/provider.type";
import { getSavedProviderById } from "@/lib/storage/saved-providers.storage";

export interface ProviderEndpoint {
    baseUrl: string;
    modelsUrl: string;
    chatUrl: string;
}

/**
 * Derive `{ baseUrl, modelsUrl, chatUrl }` from a provider's curl string.
 * Handles `/chat/completions` and `/completions` suffixes; falls back to
 * `<protocol>//<host>/v1` if no recognized suffix is present.
 */
export function resolveProviderEndpoint(provider: TYPE_PROVIDER): ProviderEndpoint {
    const curlJson = curl2Json(provider.curl);
    const url: string = (curlJson as { url?: string }).url ?? "";
    if (!url) {
        throw new Error("Provider curl has no URL");
    }
    let baseUrl: string;
    if (url.includes("/chat/completions")) {
        baseUrl = url.split("/chat/completions")[0];
    } else if (url.includes("/completions")) {
        baseUrl = url.split("/completions")[0];
    } else {
        const urlObj = new URL(url);
        baseUrl = `${urlObj.protocol}//${urlObj.host}/v1`;
    }
    return {
        baseUrl,
        modelsUrl: `${baseUrl}/models`,
        chatUrl: url,
    };
}

/**
 * Multi-stage API key lookup:
 *   1. provider.variables.API_KEY
 *   2. provider.variables.api_key (legacy lowercase)
 *   3. keychain by providerId
 *   4. keychain via SavedProviderConfig.presetId (only when providerId is a UUID)
 *   5. hardcoded `Authorization: Bearer <key>` in the curl (last resort)
 */
export async function resolveApiKey(
    providerId: string,
    provider: TYPE_PROVIDER,
): Promise<string> {
    if (provider.variables?.API_KEY) return provider.variables.API_KEY;
    if (provider.variables?.api_key) return provider.variables.api_key;

    const { getApiKey } = await import("@/lib/keychain");
    const direct = await getApiKey(providerId);
    if (direct) return direct;

    const saved = getSavedProviderById(providerId);
    if (saved?.presetId) {
        const viaPreset = await getApiKey(saved.presetId);
        if (viaPreset) return viaPreset;
    }

    try {
        const curlJson = curl2Json(provider.curl);
        const auth = (curlJson as { header?: Record<string, string> }).header?.Authorization;
        if (auth?.startsWith("Bearer ")) {
            const candidate = auth.slice("Bearer ".length).trim();
            if (candidate && !candidate.includes("{{")) return candidate;
        }
    } catch {
        // ignore curl parse errors here
    }

    return "";
}

export function buildAuthHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey && !apiKey.includes("{{")) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
}

/**
 * Pick the appropriate fetch implementation: native for localhost,
 * Tauri HTTP plugin otherwise (so we get capability scoping + CORS bypass).
 */
export function pickFetchFn(url: string): typeof fetch {
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    return (isLocal ? fetch : tauriFetch) as typeof fetch;
}

/**
 * List models for a provider. Returns `[]` on any error — callers may
 * supply their own fallback list if needed.
 */
export async function listModels(
    providerId: string,
    provider: TYPE_PROVIDER,
): Promise<string[]> {
    let endpoint: ProviderEndpoint;
    try {
        endpoint = resolveProviderEndpoint(provider);
    } catch (e) {
        console.warn("[model-discovery] Could not derive endpoint for", providerId, e);
        return [];
    }
    const apiKey = await resolveApiKey(providerId, provider);
    const headers = buildAuthHeaders(apiKey);
    const fetchFn = pickFetchFn(endpoint.modelsUrl);
    try {
        const response = await fetchFn(endpoint.modelsUrl, { method: "GET", headers });
        if (!response.ok) {
            console.warn("[model-discovery] non-OK response", response.status);
            return [];
        }
        const data = (await response.json()) as { data?: Array<{ id: string }> };
        return data.data?.map((m) => m.id) ?? [];
    } catch (e) {
        console.warn("[model-discovery] fetch failed", e);
        return [];
    }
}

/**
 * Human-readable name for a provider — useful for UI labels when the provider
 * object has only an id (e.g. saved configs referencing a built-in preset).
 */
export function getProviderDisplayName(
    providerId: string,
    allAiProviders: TYPE_PROVIDER[],
): string {
    const provider = allAiProviders.find((p) => p.id === providerId);
    if (provider) return provider.name || providerId;
    try {
        const saved = getSavedProviderById(providerId);
        if (saved?.name) return saved.name;
    } catch {
        // fallthrough
    }
    return providerId;
}
