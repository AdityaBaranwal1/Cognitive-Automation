import { useState, useCallback } from "react";
import { useApp } from "@/contexts";
import { COMMON_CONTEXT_SIZES, getProviderDefaults } from "@/config";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import curl2Json from "@bany/curl-to-json";

export interface TestResult {
    supportsVision: boolean;
    contextWindow: number;
    testedAt: number;
    isEstimate: boolean;  // true if using defaults, false if actually tested
}

export interface ModelTesterState {
    isTestingVision: boolean;
    isTestingContext: boolean;
    testProgress: string;
    error: string | null;
    result: TestResult | null;
}

/**
 * Hook for testing model capabilities (vision support, context window).
 * Uses smart testing with common breakpoints instead of blind binary search.
 */
export const useModelTester = () => {
    const { allAiProviders, selectedAIProvider } = useApp();

    const [state, setState] = useState<ModelTesterState>({
        isTestingVision: false,
        isTestingContext: false,
        testProgress: "",
        error: null,
        result: null,
    });

    /**
     * Send a test request to the model.
     * Returns true if successful, false if failed.
     */
    const sendTestRequest = useCallback(async (
        providerId: string,
        model: string,
        payload: any,
    ): Promise<{ success: boolean; error?: string }> => {
        try {
            const provider = allAiProviders?.find((p) => p?.id === providerId);
            if (!provider) return { success: false, error: "Provider not found" };

            // Parse cURL to get URL and headers
            const curlJson = curl2Json(provider.curl);
            const url = curlJson.url;

            // Get API key from provider variables
            const apiKey = selectedAIProvider?.variables?.API_KEY ||
                selectedAIProvider?.variables?.api_key || "";

            // Build headers
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };

            // Add authorization if available
            if (apiKey && !apiKey.includes("{{")) {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

            // Copy other headers from cURL
            if (curlJson.header) {
                for (const [key, value] of Object.entries(curlJson.header)) {
                    if (key.toLowerCase() !== "content-type" && !value.includes("{{")) {
                        headers[key] = value as string;
                    }
                }
            }

            // Replace model in payload
            payload.model = model;

            const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
            const fetchFn = isLocal ? fetch : tauriFetch;

            const response = await fetchFn(url, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { success: false, error: errorText };
            }

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }, [allAiProviders, selectedAIProvider]);

    /**
     * Test if the model supports vision (image input).
     */
    const testVision = useCallback(async (
        providerId: string,
        model: string,
    ): Promise<boolean> => {
        setState(prev => ({ ...prev, isTestingVision: true, testProgress: "Testing vision..." }));

        try {
            // Send a minimal image test (1x1 red pixel PNG in base64)
            const tinyImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

            const payload = {
                model,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "What color is this? Reply with one word." },
                            {
                                type: "image_url",
                                image_url: { url: `data:image/png;base64,${tinyImage}` }
                            },
                        ],
                    },
                ],
                max_tokens: 10,
            };

            const result = await sendTestRequest(providerId, model, payload);

            // If request succeeded, vision is supported
            // If it failed with specific image-related errors, vision is not supported
            if (!result.success) {
                const errorLower = result.error?.toLowerCase() || "";
                if (
                    errorLower.includes("image") ||
                    errorLower.includes("vision") ||
                    errorLower.includes("multimodal") ||
                    errorLower.includes("unsupported")
                ) {
                    return false;
                }
            }

            return result.success;
        } finally {
            setState(prev => ({ ...prev, isTestingVision: false }));
        }
    }, [sendTestRequest]);

    /**
     * Test the model's context window size.
     * Uses smart testing with common breakpoints.
     * @param delaySeconds - Delay between tests to avoid rate limits
     */
    const testContextWindow = useCallback(async (
        providerId: string,
        model: string,
        delaySeconds: number = 0,
    ): Promise<number> => {
        setState(prev => ({ ...prev, isTestingContext: true }));

        // Helper for delay
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        try {
            let confirmedLimit = COMMON_CONTEXT_SIZES[0]; // Start with smallest (4096)
            let lastSuccessfulSize = COMMON_CONTEXT_SIZES[0];
            let isFirstTest = true;

            // Test each breakpoint from small to large
            for (const size of COMMON_CONTEXT_SIZES) {
                // Add delay between tests (not before first test)
                if (!isFirstTest && delaySeconds > 0) {
                    setState(prev => ({
                        ...prev,
                        testProgress: `Waiting ${delaySeconds}s before next test...`
                    }));
                    await delay(delaySeconds * 1000);
                }
                isFirstTest = false;

                setState(prev => ({
                    ...prev,
                    testProgress: `Testing context: ${size.toLocaleString()} tokens...`
                }));


                // Generate test content that actually uses the target token count
                // Roughly 4 chars per token, so we need size * 4 characters to get 'size' tokens
                // Use 90% of target to leave room for system overhead
                const targetTokens = Math.floor(size * 0.9);
                const targetChars = targetTokens * 4; // 4 chars ≈ 1 token
                const testContent = "word ".repeat(Math.ceil(targetChars / 5));

                const payload = {
                    model,
                    messages: [
                        { role: "user", content: testContent },
                    ],
                    max_tokens: 10,
                };

                const estimatedTokens = Math.ceil(testContent.length / 4);
                console.log(`[Context Test] Testing ${size} tokens: sending ${testContent.length} chars (≈${estimatedTokens} tokens)...`);

                const result = await sendTestRequest(providerId, model, payload);

                if (!result.success) {
                    const errorLower = result.error?.toLowerCase() || "";
                    console.log(`[Context Test] Failed at ${size}: ${result.error}`);

                    // Check if it's a context/token limit error
                    if (
                        errorLower.includes("context") ||
                        errorLower.includes("token") ||
                        errorLower.includes("length") ||
                        errorLower.includes("limit") ||
                        errorLower.includes("too long") ||
                        errorLower.includes("maximum") ||
                        errorLower.includes("exceed")
                    ) {
                        // Previous size was the max
                        console.log(`[Context Test] Context limit found: ${lastSuccessfulSize}`);
                        break;
                    }
                    // If it's a different error (network, auth, etc.), stop testing
                    console.log(`[Context Test] Non-context error, stopping`);
                    break;
                }

                // This size worked, update confirmed limit
                console.log(`[Context Test] ${size} tokens succeeded`);
                lastSuccessfulSize = size;
                confirmedLimit = size;

                // Continue testing until we hit an actual limit
                // (removed: early stop at provider default - allows discovering true limits)
            }

            return confirmedLimit;
        } finally {
            setState(prev => ({ ...prev, isTestingContext: false, testProgress: "" }));
        }
    }, [sendTestRequest]);

    /**
     * Run full capability test (vision + context).
     * @param delaySeconds - Delay between context tests to avoid rate limits
     */
    const runFullTest = useCallback(async (
        providerId: string,
        model: string,
        delaySeconds: number = 0,
    ): Promise<TestResult | null> => {
        setState(prev => ({
            ...prev,
            error: null,
            result: null,
            testProgress: "Starting tests..."
        }));

        try {
            // Test vision first (faster)
            const supportsVision = await testVision(providerId, model);

            // Then test context window (with delay between tests)
            const contextWindow = await testContextWindow(providerId, model, delaySeconds);

            const result: TestResult = {
                supportsVision,
                contextWindow,
                testedAt: Date.now(),
                isEstimate: false,
            };

            setState(prev => ({ ...prev, result, testProgress: "Tests complete!" }));
            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            setState(prev => ({ ...prev, error: errorMsg, testProgress: "" }));
            return null;
        }
    }, [testVision, testContextWindow]);

    /**
     * Get estimated capabilities using provider defaults (no API calls).
     */
    const getEstimate = useCallback((providerId: string): TestResult => {
        const defaults = getProviderDefaults(providerId);
        return {
            supportsVision: defaults.vision,
            contextWindow: defaults.context,
            testedAt: Date.now(),
            isEstimate: true,
        };
    }, []);

    /**
     * Reset state.
     */
    const reset = useCallback(() => {
        setState({
            isTestingVision: false,
            isTestingContext: false,
            testProgress: "",
            error: null,
            result: null,
        });
    }, []);

    return {
        ...state,
        isLoading: state.isTestingVision || state.isTestingContext,
        testVision,
        testContextWindow,
        runFullTest,
        getEstimate,
        reset,
    };
};
