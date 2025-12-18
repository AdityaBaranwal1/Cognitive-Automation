// Model Profile types for capability configuration
export interface ModelProfile {
    id: string;
    name: string;
    supportsVision: boolean;
    contextWindow: number;
    isDefault?: boolean;  // Built-in profile (cannot be deleted)
}

// Mapping of model name patterns to profile IDs
export interface ModelProfileMapping {
    pattern: string;  // Regex pattern to match model names
    profileId: string;
}
