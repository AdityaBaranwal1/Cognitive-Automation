export interface KeyPrefixRule {
  prefix: string;
  confidence: number; // 0-100
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  modelsEndpoint: string;
  chatEndpoint: string;
  authHeaderFormat: "bearer" | "x-api-key" | "none";
  responseContentPath: string;
  streaming: boolean;
  keyPrefixes: KeyPrefixRule[];
  isOpenAICompatible: boolean;
  bodyFormat?: "openai" | "anthropic" | "cohere";
  supportsVision?: boolean;
  extraHeaders?: Record<string, string>;
}

export type ProviderTier = "quick" | "standard" | "advanced";

export interface KeyPrefixMapEntry {
  prefix: string;
  providerId: string;
  confidence: number;
}

export interface DetectionResult {
  providerId: string;
  confidence: number;
  needsProbe: boolean;
}

export interface ProviderSetupState {
  tier: ProviderTier;
  detectedProviderId: string | null;
  apiKey: string;
  model: string;
  isValidating: boolean;
  validationError: string | null;
  availableModels: string[];
}

/**
 * A user-created provider configuration.
 * Each entry represents a fully configured provider+model combo
 * with its API key stored in OS keychain under `autovision_{id}`.
 */
export interface SavedProviderConfig {
  id: string;
  name: string;
  presetId: string;
  model: string;
  isDefault: boolean;
  createdAt: number;
}
