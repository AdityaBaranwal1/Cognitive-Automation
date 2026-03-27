import {
    AI_PROVIDERS,
    DEFAULT_SYSTEM_PROMPT,
    SPEECH_TO_TEXT_PROVIDERS,
    STORAGE_KEYS,
} from "@/config";
import { getPlatform, safeLocalStorage } from "@/lib";
import { migrateKeysToKeychain } from "@/lib/keychain/migration.service";
import { PROVIDER_PRESETS } from "@/config/provider-presets.constants";
import { presetToProvider } from "@/lib/functions/preset-to-curl.function";
import { getSavedProviders } from "@/lib/storage/saved-providers.storage";
import type { SavedProviderConfig } from "@/types/provider-preset.type";

import {
    getCustomizableState,
    setCustomizableState,
    updateAppIconVisibility,
    updateAlwaysOnTop,
    updateAutostart,
    CustomizableState,
    DEFAULT_CUSTOMIZABLE_STATE,
    CursorType,
    updateCursorType,
} from "@/lib/storage";
import { IConfigContextType, ScreenshotConfig, TYPE_PROVIDER } from "@/types";
import curl2Json from "@bany/curl-to-json";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable } from "@tauri-apps/plugin-autostart";
import {
    ReactNode,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

const validateAndProcessCurlProviders = (
    providersJson: string,
    providerType: "AI" | "STT"
): TYPE_PROVIDER[] => {
    try {
        const parsed = JSON.parse(providersJson);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .filter((p) => {
                try {
                    curl2Json(p.curl);
                    return true;
                } catch (e) {
                    return false;
                }

                return true;
            })
            .map((p) => {
                const provider = { ...p, isCustom: true };
                if (providerType === "STT" && provider.curl) {
                    provider.curl = provider.curl.replace(/AUDIO_BASE64/g, "AUDIO");
                }
                return provider;
            });
    } catch (e) {
        console.warn(`Failed to parse custom ${providerType} providers`, e);
        return [];
    }
};

// Create the context
const ConfigContext = createContext<IConfigContextType | undefined>(undefined);

// Create the provider component
export const ConfigProvider = ({ children }: { children: ReactNode }) => {
    const [systemPrompt, setSystemPrompt] = useState<string>(
        safeLocalStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT) ||
        DEFAULT_SYSTEM_PROMPT
    );

    // AI Providers
    const [customAiProviders, setCustomAiProviders] = useState<TYPE_PROVIDER[]>(
        []
    );
    const [selectedAIProvider, setSelectedAIProvider] = useState<{
        provider: string;
        variables: Record<string, string>;
    }>({
        provider: "",
        variables: {},
    });

    // Provider Config Store (Persisted variables for all providers)
    const [providerConfigs, setProviderConfigs] = useState<
        Record<string, Record<string, string>>
    >({});

    // Saved Provider Configurations (named configs with keys in keychain)
    const [savedProviders, setSavedProviders] = useState<SavedProviderConfig[]>([]);

    // STT Providers
    const [customSttProviders, setCustomSttProviders] = useState<TYPE_PROVIDER[]>(
        []
    );
    const [selectedSttProvider, setSelectedSttProvider] = useState<{
        provider: string;
        variables: Record<string, string>;
    }>({
        provider: "",
        variables: {},
    });

    const [screenshotConfiguration, setScreenshotConfiguration] =
        useState<ScreenshotConfig>({
            mode: "manual",
            autoPrompt: "Analyze this screenshot and provide insights",
            enabled: true,
        });

    // Unified Customizable State
    const [customizable, setCustomizable] = useState<CustomizableState>(
        DEFAULT_CUSTOMIZABLE_STATE
    );

    // Mount-skip refs: prevent sync effects from firing on initial load
    const isInitialMountAI = useRef(true);
    const isInitialMountSTT = useRef(true);
    const isInitialMountConfigs = useRef(true);

    // Self-echo guard: skip data-updated events for keys this window just wrote
    const recentlyWrittenKeys = useRef<Set<string>>(new Set());

    // Function to load AI, STT, system prompt and screenshot config data from storage
    const loadData = () => {
        // Load system prompt
        const savedSystemPrompt = safeLocalStorage.getItem(
            STORAGE_KEYS.SYSTEM_PROMPT
        );
        if (savedSystemPrompt) {
            setSystemPrompt(savedSystemPrompt || DEFAULT_SYSTEM_PROMPT);
        }

        // Load screenshot configuration
        const savedScreenshotConfig = safeLocalStorage.getItem(
            STORAGE_KEYS.SCREENSHOT_CONFIG
        );
        if (savedScreenshotConfig) {
            try {
                const parsed = JSON.parse(savedScreenshotConfig);
                if (typeof parsed === "object" && parsed !== null) {
                    setScreenshotConfiguration({
                        mode: parsed.mode || "manual",
                        autoPrompt:
                            parsed.autoPrompt ||
                            "Analyze this screenshot and provide insights",
                        enabled: parsed.enabled !== undefined ? parsed.enabled : false,
                    });
                }
            } catch {
                console.warn("Failed to parse screenshot configuration");
            }
        }

        // Load custom AI providers
        const savedAi = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOM_AI_PROVIDERS);
        let aiList: TYPE_PROVIDER[] = [];
        if (savedAi) {
            aiList = validateAndProcessCurlProviders(savedAi, "AI");
        }
        setCustomAiProviders(aiList);

        // Load custom STT providers
        const savedStt = safeLocalStorage.getItem(
            STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS
        );
        let sttList: TYPE_PROVIDER[] = [];
        if (savedStt) {
            sttList = validateAndProcessCurlProviders(savedStt, "STT");
        }
        setCustomSttProviders(sttList);

        // Load selected AI provider
        const savedSelectedAi = safeLocalStorage.getItem(
            STORAGE_KEYS.SELECTED_AI_PROVIDER
        );
        if (savedSelectedAi) {
            setSelectedAIProvider(JSON.parse(savedSelectedAi));
        }

        // Load selected STT provider
        const savedSelectedStt = safeLocalStorage.getItem(
            STORAGE_KEYS.SELECTED_STT_PROVIDER
        );
        if (savedSelectedStt) {
            setSelectedSttProvider(JSON.parse(savedSelectedStt));
        }

        // Load provider configs
        const savedProviderConfigs = safeLocalStorage.getItem(
            STORAGE_KEYS.PROVIDER_CONFIGS
        );
        if (savedProviderConfigs) {
            try {
                setProviderConfigs(JSON.parse(savedProviderConfigs));
            } catch (e) {
                console.warn("Failed to parse provider configs", e);
            }
        }

        // Load saved provider configurations
        setSavedProviders(getSavedProviders());

        // Load customizable state
        const customizableState = getCustomizableState();
        setCustomizable(customizableState);

        updateCursor(customizableState.cursor.type || "invisible");

        const stored = safeLocalStorage.getItem(STORAGE_KEYS.CUSTOMIZABLE);
        if (!stored) {
            // save the default state
            setCustomizableState(customizableState);
        } else {
            // check if we need to update the schema
            try {
                const parsed = JSON.parse(stored);
                if (!parsed.autostart) {
                    // save the merged state with new autostart property
                    setCustomizableState(customizableState);
                    updateCursor(customizableState.cursor.type || "invisible");
                }
            } catch (error) {
                console.debug("Failed to check customizable state schema:", error);
            }
        }
    };

    const updateCursor = (type: CursorType | undefined) => {
        try {
            const currentWindow = getCurrentWindow();
            const platform = getPlatform();
            // For Linux, always use default cursor
            if (platform === "linux") {
                document.documentElement.style.setProperty("--cursor-type", "default");
                return;
            }
            const windowLabel = currentWindow.label;

            if (windowLabel === "dashboard") {
                // For dashboard, always use default cursor
                document.documentElement.style.setProperty("--cursor-type", "default");
                return;
            }

            // For overlay windows (main, capture-overlay-*)
            const safeType = type || "invisible";
            const cursorValue = type === "invisible" ? "none" : safeType;
            document.documentElement.style.setProperty("--cursor-type", cursorValue);
        } catch (error) {
            document.documentElement.style.setProperty("--cursor-type", "default");
        }
    };

    // Load data on mount
    useEffect(() => {
        // Initialize auto-configs on first run
        const autoConfigsEnabled = localStorage.getItem("auto-configs-enabled");
        if (!autoConfigsEnabled) {
            setScreenshotConfiguration({
                mode: "auto",
                autoPrompt: "Analyze the screenshot and provide insights",
                enabled: false,
            });
            localStorage.setItem("auto-configs-enabled", "true");
        }

        // Load data
        loadData();

        // Migrate plaintext API keys to OS keychain (runs once)
        const savedConfigs = safeLocalStorage.getItem(STORAGE_KEYS.PROVIDER_CONFIGS);
        if (savedConfigs) {
            try {
                const configs = JSON.parse(savedConfigs);
                (async () => {
                    const { migrated, cleanedConfigs } = await migrateKeysToKeychain(configs);
                    if (migrated) {
                        setProviderConfigs(cleanedConfigs);
                        safeLocalStorage.setItem(
                            STORAGE_KEYS.PROVIDER_CONFIGS,
                            JSON.stringify(cleanedConfigs)
                        );
                    }
                })();
            } catch { /* ignore parse errors */ }
        }

        // Apply stealth mode (content protection) on startup for ALL windows
        const stealthSaved = safeLocalStorage.getItem("stealth_mode_enabled");
        const stealthEnabled = stealthSaved === null ? true : stealthSaved === "true"; // Default ON
        invoke("set_content_protection", { enabled: stealthEnabled }).catch((err) =>
            console.error("Failed to apply stealth mode on startup:", err)
        );
    }, []);

    // Handle customizable settings on state changes
    useEffect(() => {
        const applyCustomizableSettings = async () => {
            try {
                await Promise.all([
                    invoke("set_app_icon_visibility", {
                        visible: customizable.appIcon.isVisible,
                    }),
                    invoke("set_always_on_top", {
                        enabled: customizable.alwaysOnTop.isEnabled,
                    }),
                ]);
            } catch (error) {
                console.error("Failed to apply customizable settings:", error);
            }
        };

        applyCustomizableSettings();
    }, [customizable]);

    useEffect(() => {
        const initializeAutostart = async () => {
            try {
                const autostartInitialized = safeLocalStorage.getItem(
                    STORAGE_KEYS.AUTOSTART_INITIALIZED
                );

                // Only apply autostart on the very first launch
                if (!autostartInitialized) {
                    const autostartEnabled = customizable?.autostart?.isEnabled ?? true;

                    if (autostartEnabled) {
                        await enable();
                    } else {
                        await disable();
                    }

                    // Mark as initialized so this never runs again
                    safeLocalStorage.setItem(STORAGE_KEYS.AUTOSTART_INITIALIZED, "true");
                }
            } catch (error) {
                console.debug("Autostart initialization skipped:", error);
            }
        };

        initializeAutostart();
    }, []);

    // Listen for app icon hide/show events when window is toggled
    useEffect(() => {
        const handleAppIconVisibility = async (isVisible: boolean) => {
            try {
                await invoke("set_app_icon_visibility", { visible: isVisible });
            } catch (error) {
                console.error("Failed to set app icon visibility:", error);
            }
        };

        const unlistenHide = listen("handle-app-icon-on-hide", async () => {
            const currentState = getCustomizableState();
            // Only hide app icon if user has set it to hide mode
            if (!currentState.appIcon.isVisible) {
                await handleAppIconVisibility(false);
            }
        });

        const unlistenShow = listen("handle-app-icon-on-show", async () => {
            // Always show app icon when window is shown, regardless of user setting
            await handleAppIconVisibility(true);
        });

        return () => {
            unlistenHide.then((fn) => fn());
            unlistenShow.then((fn) => fn());
        };
    }, []);

    // --- SINGLE SOURCE OF TRUTH: Tauri push-based cross-window sync ---
    // Replaces the old `window.addEventListener("storage")` which had TOCTOU races.
    // The Rust backend emits "data-updated" after every persistent write, so both
    // windows reload deterministically without localStorage race conditions.
    useEffect(() => {
        const unlisten = listen<string>("data-updated", (event) => {
            const key = event.payload;
            // Skip self-echo: ignore events for keys this window just wrote
            if (recentlyWrittenKeys.current.has(key)) return;
            if (
                key === STORAGE_KEYS.CUSTOM_AI_PROVIDERS ||
                key === STORAGE_KEYS.SELECTED_AI_PROVIDER ||
                key === STORAGE_KEYS.CUSTOM_SPEECH_PROVIDERS ||
                key === STORAGE_KEYS.SELECTED_STT_PROVIDER ||
                key === STORAGE_KEYS.SYSTEM_PROMPT ||
                key === STORAGE_KEYS.SCREENSHOT_CONFIG ||
                key === STORAGE_KEYS.CUSTOMIZABLE ||
                key === STORAGE_KEYS.PROVIDER_CONFIGS ||
                key === "saved_provider_configs"
            ) {
                loadData();
            }
        });
        return () => {
            unlisten.then((fn) => fn());
        };
    }, []);

    // Sync selected AI to localStorage + cross-window push
    useEffect(() => {
        if (isInitialMountAI.current) { isInitialMountAI.current = false; return; }
        if (selectedAIProvider.provider) {
            const data = JSON.stringify(selectedAIProvider);
            safeLocalStorage.setItem(STORAGE_KEYS.SELECTED_AI_PROVIDER, data);
            recentlyWrittenKeys.current.add(STORAGE_KEYS.SELECTED_AI_PROVIDER);
            invoke("save_persistent_data", { key: STORAGE_KEYS.SELECTED_AI_PROVIDER, data }).catch(console.error);
            setTimeout(() => recentlyWrittenKeys.current.delete(STORAGE_KEYS.SELECTED_AI_PROVIDER), 500);
        }
    }, [selectedAIProvider]);

    // Sync selected STT to localStorage + cross-window push
    useEffect(() => {
        if (isInitialMountSTT.current) { isInitialMountSTT.current = false; return; }
        if (selectedSttProvider.provider) {
            const data = JSON.stringify(selectedSttProvider);
            safeLocalStorage.setItem(STORAGE_KEYS.SELECTED_STT_PROVIDER, data);
            recentlyWrittenKeys.current.add(STORAGE_KEYS.SELECTED_STT_PROVIDER);
            invoke("save_persistent_data", { key: STORAGE_KEYS.SELECTED_STT_PROVIDER, data }).catch(console.error);
            setTimeout(() => recentlyWrittenKeys.current.delete(STORAGE_KEYS.SELECTED_STT_PROVIDER), 500);
        }
    }, [selectedSttProvider]);

    // Sync provider configs to localStorage + cross-window push
    useEffect(() => {
        if (isInitialMountConfigs.current) { isInitialMountConfigs.current = false; return; }
        const data = JSON.stringify(providerConfigs);
        safeLocalStorage.setItem(STORAGE_KEYS.PROVIDER_CONFIGS, data);
        recentlyWrittenKeys.current.add(STORAGE_KEYS.PROVIDER_CONFIGS);
        invoke("save_persistent_data", { key: STORAGE_KEYS.PROVIDER_CONFIGS, data }).catch(console.error);
        setTimeout(() => recentlyWrittenKeys.current.delete(STORAGE_KEYS.PROVIDER_CONFIGS), 500);
    }, [providerConfigs]);

    // Computed all AI providers (memoized to prevent cascading re-renders)
    // Includes: built-in presets, custom curl providers, AND saved provider configs
    const allAiProviders = useMemo<TYPE_PROVIDER[]>(() => {
        // Built-in + custom providers (legacy)
        const legacyProviders = [
            ...AI_PROVIDERS,
            ...customAiProviders,
        ].map((provider) => {
            const savedVars = providerConfigs[provider.id || ""] || {};
            return {
                ...provider,
                variables: {
                    ...(provider.variables || {}),
                    ...savedVars,
                },
            };
        });

        // Saved provider configs → TYPE_PROVIDER entries
        const savedConfigProviders = savedProviders
            .map((config) => {
                const preset = PROVIDER_PRESETS[config.presetId];
                if (!preset) return null;
                return presetToProvider(preset, {
                    model: config.model,
                    MODEL: config.model,
                });
            })
            .filter((p): p is TYPE_PROVIDER => p !== null)
            .map((p, i) => ({ ...p, id: savedProviders[i].id, name: savedProviders[i].name }));

        return [...savedConfigProviders, ...legacyProviders];
    }, [customAiProviders, providerConfigs, savedProviders]);

    // Computed all STT providers (memoized)
    const allSttProviders = useMemo<TYPE_PROVIDER[]>(() => [
        ...SPEECH_TO_TEXT_PROVIDERS,
        ...customSttProviders,
    ], [customSttProviders]);

    const onSetSelectedAIProvider = ({
        provider,
        variables,
    }: {
        provider: string;
        variables: Record<string, string>;
    }) => {
        // Refresh saved providers first — caller may have just added one
        const freshSaved = getSavedProviders();
        setSavedProviders(freshSaved);

        // Check both current allAiProviders and freshly-loaded saved configs
        const knownInLegacy = allAiProviders.some((p) => p.id === provider);
        const knownInSaved = freshSaved.some((c) => c.id === provider);
        if (provider && !knownInLegacy && !knownInSaved) {
            console.warn(`Invalid AI provider ID: ${provider}`);
            return;
        }

        setSelectedAIProvider((prev) => ({
            ...prev,
            provider,
            variables,
        }));

        // Strip sensitive keys before persisting to localStorage
        const safeVars = { ...variables };
        delete safeVars.API_KEY;
        delete safeVars.api_key;
        delete safeVars.apiKey;

        setProviderConfigs((prev) => ({
            ...prev,
            [provider]: safeVars,
        }));
    };

    // Setter for selected STT with validation
    const onSetSelectedSttProvider = ({
        provider,
        variables,
    }: {
        provider: string;
        variables: Record<string, string>;
    }) => {
        if (provider && !allSttProviders.some((p) => p.id === provider)) {
            console.warn(`Invalid STT provider ID: ${provider}`);
            return;
        }

        setSelectedSttProvider((prev) => ({ ...prev, provider, variables }));
    };

    // Toggle handlers
    const toggleAppIconVisibility = async (isVisible: boolean) => {
        const newState = updateAppIconVisibility(isVisible);
        setCustomizable(newState);
        try {
            await invoke("set_app_icon_visibility", { visible: isVisible });
        } catch (error) {
            console.error("Failed to toggle app icon visibility:", error);
        }
    };

    const toggleAlwaysOnTop = async (isEnabled: boolean) => {
        const newState = updateAlwaysOnTop(isEnabled);
        setCustomizable(newState);
        try {
            await invoke("set_always_on_top", { enabled: isEnabled });
        } catch (error) {
            console.error("Failed to toggle always on top:", error);
        }
    };

    const toggleAutostart = async (isEnabled: boolean) => {
        const newState = updateAutostart(isEnabled);
        setCustomizable(newState);
        try {
            await invoke("set_always_on_top", { enabled: isEnabled });
        } catch (error) {
            console.error("Failed to toggle autostart:", error);
            const revertedState = updateAutostart(!isEnabled);
            setCustomizable(revertedState);
        }
    };

    const setCursorType = (type: CursorType) => {
        setCustomizable((prev) => ({ ...prev, cursor: { type } }));
        updateCursor(type);
        updateCursorType(type);
    };

    const value: IConfigContextType = {
        systemPrompt,
        setSystemPrompt,
        allAiProviders,
        customAiProviders,
        selectedAIProvider,
        onSetSelectedAIProvider,
        allSttProviders,
        customSttProviders,
        selectedSttProvider,
        onSetSelectedSttProvider,
        screenshotConfiguration,
        setScreenshotConfiguration,
        customizable,
        toggleAppIconVisibility,
        toggleAlwaysOnTop,
        toggleAutostart,
        loadData,
        setCursorType,
    };

    return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
};

// Create a hook to access the context
export const useConfig = () => {
    const context = useContext(ConfigContext);

    if (!context) {
        throw new Error("useConfig must be used within a ConfigProvider");
    }

    return context;
};
