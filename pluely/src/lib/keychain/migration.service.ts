import { saveApiKey } from "./keychain.service";

const MIGRATION_FLAG = "keychain_migration_v1_done";

/**
 * Migrate plaintext API keys from providerConfigs to OS keychain.
 * Runs once on first mount, guarded by a localStorage flag.
 *
 * Returns the cleaned providerConfigs with API_KEY values removed.
 */
export async function migrateKeysToKeychain(
  providerConfigs: Record<string, Record<string, string>>
): Promise<{
  migrated: boolean;
  cleanedConfigs: Record<string, Record<string, string>>;
}> {
  // Check if migration already done
  if (localStorage.getItem(MIGRATION_FLAG) === "true") {
    return { migrated: false, cleanedConfigs: providerConfigs };
  }

  const cleanedConfigs: Record<string, Record<string, string>> = {};
  let migratedCount = 0;

  for (const [providerId, vars] of Object.entries(providerConfigs)) {
    const cleanedVars = { ...vars };

    // Look for API key variants
    const keyFieldNames = ["API_KEY", "api_key", "apiKey"];
    for (const fieldName of keyFieldNames) {
      const keyValue = cleanedVars[fieldName];
      if (keyValue && keyValue.trim().length > 0) {
        try {
          await saveApiKey(providerId, keyValue.trim());
          cleanedVars[fieldName] = "";
          migratedCount++;
        } catch (err) {
          console.warn(
            `Failed to migrate key for ${providerId}:`,
            err
          );
          // Leave key in config as fallback
        }
      }
    }

    cleanedConfigs[providerId] = cleanedVars;
  }

  if (migratedCount > 0) {
    console.log(`Migrated ${migratedCount} API key(s) to OS keychain`);
  }

  localStorage.setItem(MIGRATION_FLAG, "true");
  return { migrated: migratedCount > 0, cleanedConfigs };
}
