import { safeLocalStorage } from "@/lib";
import { ModelProfile } from "@/types/model-profiles";
import { DEFAULT_MODEL_PROFILES, getSuggestedProfileForModel } from "@/config";

const STORAGE_KEY = "model_profiles";
const MODEL_PROFILE_MAPPING_KEY = "model_profile_mapping";

/**
 * Get all available profiles (default + custom)
 */
export function getProfiles(): ModelProfile[] {
    const customProfilesJson = safeLocalStorage.getItem(STORAGE_KEY);
    const customProfiles: ModelProfile[] = customProfilesJson
        ? JSON.parse(customProfilesJson)
        : [];

    // Merge: defaults + custom (custom can override defaults by ID)
    const profileMap = new Map<string, ModelProfile>();

    for (const profile of DEFAULT_MODEL_PROFILES) {
        profileMap.set(profile.id, profile);
    }

    for (const profile of customProfiles) {
        profileMap.set(profile.id, profile);
    }

    return Array.from(profileMap.values());
}

/**
 * Get a specific profile by ID
 */
export function getProfileById(profileId: string): ModelProfile | undefined {
    return getProfiles().find(p => p.id === profileId);
}

/**
 * Save a custom profile (creates or updates)
 */
export function saveProfile(profile: ModelProfile): void {
    const customProfilesJson = safeLocalStorage.getItem(STORAGE_KEY);
    const customProfiles: ModelProfile[] = customProfilesJson
        ? JSON.parse(customProfilesJson)
        : [];

    // Update or add
    const existingIndex = customProfiles.findIndex(p => p.id === profile.id);
    if (existingIndex >= 0) {
        customProfiles[existingIndex] = profile;
    } else {
        customProfiles.push(profile);
    }

    safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(customProfiles));
}

/**
 * Delete a custom profile by ID
 * Cannot delete default profiles
 */
export function deleteProfile(profileId: string): boolean {
    // Check if it's a default profile
    const defaultProfile = DEFAULT_MODEL_PROFILES.find(p => p.id === profileId);
    if (defaultProfile) {
        console.warn("Cannot delete default profile:", profileId);
        return false;
    }

    const customProfilesJson = safeLocalStorage.getItem(STORAGE_KEY);
    const customProfiles: ModelProfile[] = customProfilesJson
        ? JSON.parse(customProfilesJson)
        : [];

    const filtered = customProfiles.filter(p => p.id !== profileId);
    safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
}

/**
 * Get the saved profile ID for a specific model, or suggest one based on patterns
 */
export function getProfileForModel(modelName: string): string {
    const mappingJson = safeLocalStorage.getItem(MODEL_PROFILE_MAPPING_KEY);
    const mapping: Record<string, string> = mappingJson
        ? JSON.parse(mappingJson)
        : {};

    // Return saved mapping if exists
    if (mapping[modelName]) {
        return mapping[modelName];
    }

    // Otherwise, suggest based on pattern matching
    return getSuggestedProfileForModel(modelName);
}

/**
 * Save a profile selection for a specific model
 */
export function setProfileForModel(modelName: string, profileId: string): void {
    const mappingJson = safeLocalStorage.getItem(MODEL_PROFILE_MAPPING_KEY);
    const mapping: Record<string, string> = mappingJson
        ? JSON.parse(mappingJson)
        : {};

    mapping[modelName] = profileId;
    safeLocalStorage.setItem(MODEL_PROFILE_MAPPING_KEY, JSON.stringify(mapping));
}

/**
 * Get all model-to-profile mappings
 */
export function getAllModelProfileMappings(): Record<string, string> {
    const mappingJson = safeLocalStorage.getItem(MODEL_PROFILE_MAPPING_KEY);
    return mappingJson ? JSON.parse(mappingJson) : {};
}

const GLOBAL_DEFAULT_KEY = "global_default_profile";

/**
 * Get the global default profile ID
 * Falls back to "vision-standard" if not set
 */
export function getGlobalDefaultProfileId(): string {
    return safeLocalStorage.getItem(GLOBAL_DEFAULT_KEY) || "vision-standard";
}

/**
 * Set the global default profile ID
 */
export function setGlobalDefaultProfileId(profileId: string): void {
    safeLocalStorage.setItem(GLOBAL_DEFAULT_KEY, profileId);
}

/**
 * Get the global default profile
 */
export function getGlobalDefaultProfile(): ModelProfile | undefined {
    const profileId = getGlobalDefaultProfileId();
    return getProfileById(profileId);
}
