import type { TYPE_PROVIDER } from "@/types/provider.type";
import {
    resolveFromSavedConfig,
    injectKeychainKey,
} from "@/lib/functions/provider-resolver.function";
import { FALLBACK_LM_STUDIO_PROVIDER } from "@/hooks/workflow/useWorkflowState";

export interface ResolvedProvider {
    provider: TYPE_PROVIDER;
    variables: Record<string, string>;
}

export interface ResolveProviderOptions {
    /** When true, returns the bundled LM Studio fallback if providerId is "lm-studio" and no legacy match exists. */
    fallbackToLmStudio?: boolean;
    /**
     * Optional pre-injected variables (e.g. the AI step's `model` selection).
     * These are merged below the keychain-resolved API_KEY.
     */
    seedVariables?: Record<string, string>;
}

/**
 * Canonical provider resolution path used by every AI call site.
 *
 * Order:
 *   1. SavedProviderConfig (UUID-based, fully hydrated incl. keychain API key)
 *   2. Legacy `allAiProviders.find(p => p.id === providerId)`
 *   3. Optional LM Studio fallback (only when providerId === "lm-studio")
 *
 * Always returns a TYPE_PROVIDER + variables ready for `fetchAIResponse`.
 *
 * Replaces the parallel implementations previously in:
 *   - useAIStep.ts:35-55
 *   - useCompletion.ts:160-180
 *   - useChatCompletion.ts:206-228
 *
 * Note: the prior unused `resolveProviderForCall` has been deleted as part of
 * this consolidation.
 */
export async function resolveProvider(
    providerId: string,
    allAiProviders: TYPE_PROVIDER[],
    opts: ResolveProviderOptions = {},
): Promise<ResolvedProvider> {
    const saved = await resolveFromSavedConfig(providerId);
    if (saved) {
        return {
            provider: saved.provider,
            variables: { ...opts.seedVariables, ...saved.selectedProvider.variables },
        };
    }

    const legacy = allAiProviders.find((p) => p.id === providerId);
    if (legacy) {
        const merged = await injectKeychainKey(providerId, {
            ...(opts.seedVariables ?? {}),
            ...(legacy.variables ?? {}),
        });
        return { provider: legacy, variables: merged };
    }

    if (opts.fallbackToLmStudio && providerId === "lm-studio") {
        const merged = await injectKeychainKey(providerId, {
            ...(opts.seedVariables ?? {}),
            ...(FALLBACK_LM_STUDIO_PROVIDER.variables ?? {}),
        });
        return { provider: FALLBACK_LM_STUDIO_PROVIDER, variables: merged };
    }

    throw new Error(`Provider "${providerId}" not found`);
}
