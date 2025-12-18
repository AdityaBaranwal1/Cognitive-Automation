import { ModelProfile } from "@/types/model-profiles";

/**
 * Default model profiles shipped with the app.
 * Users can create custom profiles that override these.
 */
export const DEFAULT_MODEL_PROFILES: ModelProfile[] = [
    {
        id: "vision-large",
        name: "Cloud Large (128K + Vision)",
        supportsVision: true,
        contextWindow: 128000,
        isDefault: true,
    },
    {
        id: "vision-standard",
        name: "Cloud Standard (32K + Vision)",
        supportsVision: true,
        contextWindow: 32000,
        isDefault: true,
    },
    {
        id: "text-only",
        name: "Text Only (8K)",
        supportsVision: false,
        contextWindow: 8192,
        isDefault: true,
    },
    {
        id: "local-conservative",
        name: "Local Safe (4K)",
        supportsVision: false,
        contextWindow: 4096,
        isDefault: true,
    },
];

/**
 * Default profile ID to use when no specific profile is selected.
 * Using "vision-standard" as a balanced default.
 */
export const DEFAULT_PROFILE_ID = "vision-standard";

/**
 * Pattern matching rules to auto-suggest profiles based on model name.
 * First match wins.
 */
export const MODEL_PROFILE_PATTERNS: Array<{ pattern: RegExp; profileId: string }> = [
    // Large vision models
    { pattern: /gpt-4o(?!-mini)/i, profileId: "vision-large" },
    { pattern: /claude-3-opus/i, profileId: "vision-large" },
    { pattern: /gemini-1\.5-pro/i, profileId: "vision-large" },
    { pattern: /gemini-pro/i, profileId: "vision-large" },

    // Standard vision models
    { pattern: /gpt-4o-mini/i, profileId: "vision-standard" },
    { pattern: /claude-3-sonnet/i, profileId: "vision-standard" },
    { pattern: /claude-3-haiku/i, profileId: "vision-standard" },
    { pattern: /gemini-1\.5-flash/i, profileId: "vision-standard" },

    // Text-only models
    { pattern: /gpt-3\.5/i, profileId: "text-only" },
    { pattern: /gpt-4(?!o)/i, profileId: "text-only" },  // gpt-4 without 'o' suffix

    // Local models (conservative defaults)
    { pattern: /llama/i, profileId: "local-conservative" },
    { pattern: /mistral/i, profileId: "local-conservative" },
    { pattern: /codellama/i, profileId: "local-conservative" },
    { pattern: /phi/i, profileId: "local-conservative" },
    { pattern: /qwen/i, profileId: "local-conservative" },
];

/**
 * Get suggested profile ID for a model name based on pattern matching.
 * Returns DEFAULT_PROFILE_ID if no pattern matches.
 */
export function getSuggestedProfileForModel(modelName: string): string {
    for (const { pattern, profileId } of MODEL_PROFILE_PATTERNS) {
        if (pattern.test(modelName)) {
            return profileId;
        }
    }
    return DEFAULT_PROFILE_ID;
}

/**
 * Layer B: Provider-level defaults
 * Used as instant, free fallback when no profile is configured.
 */
export const PROVIDER_DEFAULTS: Record<string, { vision: boolean; context: number }> = {
    openai: { vision: true, context: 128000 },
    claude: { vision: true, context: 200000 },
    gemini: { vision: true, context: 128000 },
    grok: { vision: true, context: 128000 },
    groq: { vision: true, context: 128000 },
    mistral: { vision: false, context: 32000 },
    cohere: { vision: false, context: 128000 },
    perplexity: { vision: false, context: 128000 },
    openrouter: { vision: true, context: 128000 },
    ollama: { vision: false, context: 32000 },
    "lm-studio": { vision: false, context: 32000 },
    default: { vision: false, context: 8192 },
};

/**
 * Get provider defaults by provider ID.
 * For custom providers, uses a more generous default (32k) since they're often local models.
 * Falls back to conservative defaults for truly unknown providers.
 */
export function getProviderDefaults(providerId: string): { vision: boolean; context: number } {
    // Direct match
    if (PROVIDER_DEFAULTS[providerId]) {
        return PROVIDER_DEFAULTS[providerId];
    }

    // Check for partial matches (e.g., "custom-openai" should match "openai")
    const providerLower = providerId.toLowerCase();
    for (const [key, value] of Object.entries(PROVIDER_DEFAULTS)) {
        if (key !== 'default' && providerLower.includes(key)) {
            return value;
        }
    }

    // Custom providers (starting with "custom-") get more generous defaults
    // since they're typically local models with higher context
    if (providerLower.startsWith('custom')) {
        return { vision: false, context: 32000 };
    }

    return PROVIDER_DEFAULTS.default;
}

/**
 * Common context window sizes for smart testing.
 * Test these breakpoints instead of blind binary search.
 */
export const COMMON_CONTEXT_SIZES = [
    4096,    // Older models, very conservative local
    8192,    // GPT-3.5, Llama 2, default fallback
    32000,   // Claude 2, many local models
    128000,  // GPT-4o, Claude 3, Gemini
    200000,  // Claude 4, o3
    1000000, // Gemini 2.0 (experimental)
];
