import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useConfig, useAudio } from "@/contexts";
import { MAX_FILES } from "@/config";
import {
  fetchAIResponse,
  saveConversation,
  generateConversationTitle,
  MESSAGE_ID_OFFSET,
  generateMessageId,
  generateRequestId,
  setProfileForModel,
  getProfileForModel,
  saveProfile,
  getProfileById,
} from "@/lib";
import { AttachedFile, ChatMessage, ChatConversation } from "@/types";
import { injectKeychainKey, resolveFromSavedConfig } from "@/lib/functions/provider-resolver.function";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTauriEvent } from "@/lib/tauri/use-event";
import { ensureScreenRecordingPermission } from "@/lib/platform/screen-permission";

interface ChatCompletionState {
  input: string;
  isLoading: boolean;
  error: string | null;
  attachedFiles: AttachedFile[];
}

export const useChatCompletion = (
  conversationId: string,
  messages: ChatConversation | null,
  setMessages: (messages: ChatConversation | null) => void
) => {
  const {
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    screenshotConfiguration,
    setScreenshotConfiguration,
    selectedSttProvider,
    allSttProviders,
  } = useConfig();
  const { selectedAudioDevices } = useAudio();

  const [state, setState] = useState<ChatCompletionState>({
    input: "",
    isLoading: false,
    error: null,
    attachedFiles: [],
  });

  const [micOpen, setMicOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isFilesPopoverOpen, setIsFilesPopoverOpen] = useState(false);
  const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const isProcessingScreenshotRef = useRef(false);
  const screenshotConfigRef = useRef(screenshotConfiguration);
  const hasCheckedPermissionRef = useRef(false);
  const screenshotInitiatedByThisContext = useRef(false);

  useEffect(() => {
    screenshotConfigRef.current = screenshotConfiguration;
  }, [screenshotConfiguration]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const setInput = useCallback((value: string) => {
    setState((prev) => ({ ...prev, input: value }));
  }, []);

  const addFile = useCallback(async (file: File) => {
    try {
      const base64 = await fileToBase64(file);
      const attachedFile: AttachedFile = {
        id: Date.now().toString(),
        name: file.name,
        type: file.type,
        base64,
        size: file.size,
      };

      setState((prev) => ({
        ...prev,
        attachedFiles: [...prev.attachedFiles, attachedFile],
      }));
    } catch (error) {
      console.error("Failed to process file:", error);
    }
  }, []);

  const removeFile = useCallback((fileId: string) => {
    setState((prev) => ({
      ...prev,
      attachedFiles: prev.attachedFiles.filter((f) => f.id !== fileId),
    }));
  }, []);

  const clearFiles = useCallback(() => {
    setState((prev) => ({ ...prev, attachedFiles: [] }));
  }, []);

  const submit = useCallback(
    async (speechText?: string) => {
      const input = speechText || state.input;

      if (!input.trim()) {
        return;
      }

      if (speechText) {
        setState((prev) => ({
          ...prev,
          input: speechText,
        }));
      }

      // Generate unique request ID
      const requestId = generateRequestId();
      currentRequestIdRef.current = requestId;

      // Cancel any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        // HYBRID PROVIDER LOGIC: Use conversation's stored provider if available, otherwise fall back to global
        const effectiveProviderId = messages?.providerId || selectedAIProvider.provider;
        const effectiveModel = messages?.model || selectedAIProvider.variables?.model;

        // GET PROFILE FOR THIS MODEL - This is the key fix!
        const profileId = effectiveModel ? getProfileForModel(effectiveModel) : "vision-standard";
        const profile = getProfileById(profileId);
        const supportsVision = profile?.supportsVision ?? true;

        // Find the most recent model_switch with a checkpoint for token optimization
        const allMsgs = messages?.messages || [];
        const lastSwitchIndex = allMsgs
          .map((msg, i) => ({ msg, i }))
          .filter(({ msg }) => msg.metadata?.type === "model_switch" && msg.metadata?.checkpoint)
          .pop()?.i ?? -1;

        // Only send messages AFTER the last checkpoint
        const relevantMessages = lastSwitchIndex >= 0
          ? allMsgs.slice(lastSwitchIndex + 1)
          : allMsgs;

        // Prepare message history: filter model_switch messages and sanitize images
        const messageHistory = relevantMessages
          .filter((msg) => msg.metadata?.type !== "model_switch")
          .map((msg) => {
            // Strip images from history if current model doesn't support vision
            if (!supportsVision && Array.isArray(msg.content)) {
              const textParts = (msg.content as any[])
                .filter((part: any) => part.type === "text")
                .map((part: any) => part.text || "")
                .join("\n");
              return { role: msg.role, content: textParts || "[Image content removed - text-only model]" };
            }
            return { role: msg.role, content: msg.content };
          });

        // Prepend checkpoint summary if available
        if (lastSwitchIndex >= 0) {
          const checkpoint = allMsgs[lastSwitchIndex]?.metadata?.checkpoint;
          if (checkpoint) {
            messageHistory.unshift({ role: "system" as const, content: checkpoint });
          }
        }

        console.log(`[Chat] Using profile "${profile?.name}" for model "${effectiveModel}" (vision: ${supportsVision})`);

        // Handle image attachments - ONLY if profile supports vision
        const imagesBase64: string[] = [];
        if (supportsVision && state.attachedFiles.length > 0) {
          state.attachedFiles.forEach((file) => {
            if (file.type.startsWith("image/")) {
              imagesBase64.push(file.base64);
            }
          });
          console.log(`[Chat] Sending ${imagesBase64.length} image(s) to AI`);
        } else if (!supportsVision && state.attachedFiles.length > 0) {
          console.warn(`[Chat] Profile "${profile?.name}" does not support vision - images will not be sent`);
        }

        // Check if AI provider is configured
        if (!effectiveProviderId) {
          setState((prev) => ({
            ...prev,
            error: "Please select an AI provider in settings",
          }));
          return;
        }

        // Resolve provider: try SavedProviderConfig first, then legacy allAiProviders
        const pid = effectiveProviderId || selectedAIProvider.provider;
        const savedRes = await resolveFromSavedConfig(pid);
        let resolvedProvider: typeof allAiProviders[0];
        let resolvedVars: Record<string, string>;

        if (savedRes) {
          resolvedProvider = savedRes.provider;
          resolvedVars = savedRes.selectedProvider.variables;
        } else {
          const legacyProvider = allAiProviders.find(
            (p) => p.id === effectiveProviderId
          );
          if (!legacyProvider) {
            setState((prev) => ({
              ...prev,
              error: "Invalid provider selected",
            }));
            return;
          }
          resolvedProvider = legacyProvider;
          resolvedVars = await injectKeychainKey(pid,
            { ...selectedAIProvider.variables, model: effectiveModel || selectedAIProvider.variables?.model }
          );
        }

        // Add user message to UI immediately
        const timestamp = Date.now();
        const userMsg: ChatMessage = {
          id: generateMessageId("user", timestamp),
          role: "user",
          content: input,
          timestamp,
        };

        const updatedMessages = {
          ...messages!,
          messages: [...(messages?.messages || []), userMsg],
        };
        setMessages(updatedMessages);

        // Clear input and set loading state
        setState((prev) => ({
          ...prev,
          input: "",
          isLoading: true,
          error: null,
          attachedFiles: [],
        }));

        // Scroll to bottom after adding user message
        setTimeout(scrollToBottom, 100);

        let fullResponse = "";

        try {

          // Use the fetchAIResponse function with signal
          for await (const chunk of fetchAIResponse({
            provider: resolvedProvider,
            selectedProvider: {
              provider: pid,
              variables: resolvedVars
            },
            systemPrompt: systemPrompt || undefined,
            history: messageHistory,
            userMessage: input,
            imagesBase64,
            signal,
          })) {
            // Only update if this is still the current request
            if (currentRequestIdRef.current !== requestId) {
              return; // Request was superseded, stop processing
            }

            // Check if request was aborted
            if (signal.aborted) {
              return; // Request was cancelled, stop processing
            }

            fullResponse += chunk;

            // Update the assistant's response in real-time
            const assistantMsg: ChatMessage = {
              id: generateMessageId("assistant", timestamp + MESSAGE_ID_OFFSET),
              role: "assistant",
              content: fullResponse,
              timestamp: timestamp + MESSAGE_ID_OFFSET,
            };

            setMessages({
              ...updatedMessages,
              messages: [...updatedMessages.messages, assistantMsg],
            });

            // Auto-scroll during streaming
            scrollToBottom();
          }
        } catch (e: any) {
          // Only show error if this is still the current request and not aborted
          if (currentRequestIdRef.current === requestId && !signal.aborted) {
            const errorMsg = (e.message || "An error occurred").toLowerCase();

            // Layer C: Self-healing for context overflow errors
            const isContextOverflow =
              errorMsg.includes("context") ||
              errorMsg.includes("token") ||
              errorMsg.includes("length") ||
              errorMsg.includes("limit") ||
              errorMsg.includes("too long") ||
              errorMsg.includes("maximum");

            if (isContextOverflow && effectiveModel) {
              // Try to auto-adjust the context limit for this model
              try {
                const currentProfileId = getProfileForModel(effectiveModel);
                const currentProfile = getProfileById(currentProfileId);

                if (currentProfile && currentProfile.contextWindow > 4096) {
                  // Halve the context limit
                  const newLimit = Math.floor(currentProfile.contextWindow / 2);
                  console.log(`[Self-Healing] Context overflow detected for ${effectiveModel}. Adjusting from ${currentProfile.contextWindow} to ${newLimit}`);

                  // Create new profile with adjusted limit
                  const adjustedProfile = {
                    ...currentProfile,
                    id: `auto-adjusted-${Date.now()}`,
                    name: `${currentProfile.name} (Adjusted)`,
                    contextWindow: newLimit,
                  };
                  saveProfile(adjustedProfile);
                  setProfileForModel(effectiveModel, adjustedProfile.id);

                  // Show helpful error message
                  setState((prev) => ({
                    ...prev,
                    isLoading: false,
                    error: `Context limit exceeded. Automatically adjusted to ${newLimit.toLocaleString()} tokens. Please try again.`,
                  }));
                  return;
                }
              } catch (healingError) {
                console.error("[Self-Healing] Failed to adjust context:", healingError);
              }
            }

            setState((prev) => ({
              ...prev,
              isLoading: false,
              error: e.message || "An error occurred",
            }));
          }
          return;
        }

        // Only proceed if this is still the current request
        if (currentRequestIdRef.current !== requestId || signal.aborted) {
          return;
        }

        setState((prev) => ({ ...prev, isLoading: false }));

        // Focus input after AI response is complete
        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);

        // Save the conversation after successful completion
        if (fullResponse) {
          const assistantMsg: ChatMessage = {
            id: generateMessageId("assistant", timestamp + MESSAGE_ID_OFFSET),
            role: "assistant",
            content: fullResponse,
            timestamp: timestamp + MESSAGE_ID_OFFSET,
          };

          const newMessages = [
            ...(messages?.messages || []),
            userMsg,
            assistantMsg,
          ];

          const title =
            messages?.title ||
            generateConversationTitle(input);

          const conversation: ChatConversation = {
            id: conversationId,
            title,
            messages: newMessages,
            createdAt: messages?.createdAt || timestamp,
            updatedAt: timestamp,
            providerId: messages?.providerId,
            model: messages?.model,
          };

          try {
            await saveConversation(conversation);
            setMessages(conversation);
          } catch (error) {
            console.error("Failed to save conversation:", error);
            setState((prev) => ({
              ...prev,
              error: "Failed to save conversation. Please try again.",
            }));
          }
        }
      } catch (error) {
        // Only show error if not aborted
        if (!signal?.aborted && currentRequestIdRef.current === requestId) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "An error occurred",
            isLoading: false,
          }));
        }
      }
    },
    [
      state.input,
      state.attachedFiles,
      selectedAIProvider,
      allAiProviders,
      systemPrompt,
      messages,
      conversationId,
      setMessages,
    ]
  );

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    currentRequestIdRef.current = null;
    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

  // Helper function to convert file to base64
  const fileToBase64 = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string)?.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
    });
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    files.forEach((file) => {
      if (
        file.type.startsWith("image/") &&
        state.attachedFiles.length < MAX_FILES
      ) {
        addFile(file);
      }
    });

    // Reset input so same file can be selected again
    e.target.value = "";
  };

  const handleScreenshotSubmit = useCallback(
    async (base64: string, prompt?: string) => {
      if (state.attachedFiles.length >= MAX_FILES) {
        setState((prev) => ({
          ...prev,
          error: `You can only upload ${MAX_FILES} files`,
        }));
        return;
      }

      try {
        if (prompt) {
          // Auto mode: Submit directly to AI with screenshot
          const attachedFile: AttachedFile = {
            id: Date.now().toString(),
            name: `screenshot_${Date.now()}.png`,
            type: "image/png",
            base64: base64,
            size: base64.length,
          };

          // Store files temporarily and submit
          setState((prev) => ({
            ...prev,
            attachedFiles: [...prev.attachedFiles, attachedFile],
            input: prompt,
          }));

          // Submit with the prompt and screenshot
          setTimeout(() => submit(prompt), 100);
        } else {
          // Manual mode: Add to attached files
          const attachedFile: AttachedFile = {
            id: Date.now().toString(),
            name: `screenshot_${Date.now()}.png`,
            type: "image/png",
            base64: base64,
            size: base64.length,
          };

          setState((prev) => ({
            ...prev,
            attachedFiles: [...prev.attachedFiles, attachedFile],
          }));
        }
      } catch (error) {
        console.error("Failed to process screenshot:", error);
        setState((prev) => ({
          ...prev,
          error:
            error instanceof Error
              ? error.message
              : "An error occurred processing screenshot",
          isLoading: false,
        }));
      }
    },
    [state.attachedFiles.length, submit]
  );

  const onRemoveAllFiles = () => {
    clearFiles();
    setIsFilesPopoverOpen(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!state.isLoading && state.input.trim()) {
        submit();
      }
    }
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      // Check if clipboard contains images
      const items = e.clipboardData?.items;
      if (!items) return;

      const hasImages = Array.from(items).some((item) =>
        item.type.startsWith("image/")
      );

      // If we have images, prevent default text pasting and process images
      if (hasImages) {
        e.preventDefault();

        const processedFiles: File[] = [];

        Array.from(items).forEach((item) => {
          if (
            item.type.startsWith("image/") &&
            state.attachedFiles.length + processedFiles.length < MAX_FILES
          ) {
            const file = item.getAsFile();
            if (file) {
              processedFiles.push(file);
            }
          }
        });

        // Process all files
        await Promise.all(processedFiles.map((file) => addFile(file)));
      }
    },
    [state.attachedFiles.length, addFile]
  );

  const captureScreenshot = useCallback(async () => {
    if (!handleScreenshotSubmit) return;

    const config = screenshotConfigRef.current;

    // Mark that this context initiated the screenshot
    screenshotInitiatedByThisContext.current = true;

    setIsScreenshotLoading(true);

    try {
      // Check screen recording permission on macOS (no-op elsewhere)
      if (!hasCheckedPermissionRef.current) {
        const perm = await ensureScreenRecordingPermission();
        if (!perm.granted) {
          setState((prev) => ({ ...prev, error: perm.userFacingError }));
          setIsScreenshotLoading(false);
          screenshotInitiatedByThisContext.current = false;
          return;
        }
        hasCheckedPermissionRef.current = true;
      }

      if (config.enabled) {
        const base64 = await invoke("capture_to_base64");

        if (config.mode === "auto") {
          // Auto mode: Submit directly to AI with the configured prompt
          await handleScreenshotSubmit(base64 as string, config.autoPrompt);
        } else if (config.mode === "manual") {
          // Manual mode: Add to attached files without prompt
          await handleScreenshotSubmit(base64 as string);
        }
        // Reset flag after processing
        screenshotInitiatedByThisContext.current = false;
      } else {
        // Selection Mode: Open overlay to select an area

        isProcessingScreenshotRef.current = false;
        await invoke("start_screen_capture");
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: "Failed to capture screenshot. Please try again.",
      }));
      isProcessingScreenshotRef.current = false;
      screenshotInitiatedByThisContext.current = false;
    } finally {
      if (config.enabled) {
        setIsScreenshotLoading(false);
      }
    }
  }, [handleScreenshotSubmit]);

  useEffect(() => {
    const unlistenRef = { current: null as (() => void) | null };

    listen("captured-selection", async (event: any) => {
      if (!screenshotInitiatedByThisContext.current) {
        return;
      }

      if (isProcessingScreenshotRef.current) {
        return;
      }

      isProcessingScreenshotRef.current = true;
      const base64 = event.payload;
      const config = screenshotConfigRef.current;

      try {
        if (config.mode === "auto") {
          await handleScreenshotSubmit(base64 as string, config.autoPrompt);
        } else if (config.mode === "manual") {
          await handleScreenshotSubmit(base64 as string);
        }
      } catch (error) {
        console.error("Error processing selection:", error);
      } finally {
        setIsScreenshotLoading(false);
        screenshotInitiatedByThisContext.current = false;
        setTimeout(() => {
          isProcessingScreenshotRef.current = false;
        }, 100);
      }
    }).then((fn) => { unlistenRef.current = fn; });

    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, [handleScreenshotSubmit]);

  useTauriEvent("capture-closed", () => {
    setIsScreenshotLoading(false);
    isProcessingScreenshotRef.current = false;
    screenshotInitiatedByThisContext.current = false;
  });

  // Expose whether current model supports vision so UI can hide image attach
  const currentSupportsVision = useMemo(() => {
    const effectiveModel = messages?.model || selectedAIProvider.variables?.model;
    const pid = effectiveModel ? getProfileForModel(effectiveModel) : "vision-standard";
    const p = getProfileById(pid);
    return p?.supportsVision ?? true;
  }, [messages?.model, selectedAIProvider.variables?.model]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      currentRequestIdRef.current = null;
    };
  }, []);

  return {
    input: state.input,
    setInput,
    isLoading: state.isLoading,
    error: state.error,
    attachedFiles: state.attachedFiles,
    addFile,
    removeFile,
    clearFiles,
    submit,
    cancel,
    setState,
    isRecording,
    setIsRecording,
    micOpen,
    setMicOpen,
    screenshotConfiguration,
    setScreenshotConfiguration,
    handleScreenshotSubmit,
    handleFileSelect,
    handleKeyPress,
    handlePaste,
    isFilesPopoverOpen,
    setIsFilesPopoverOpen,
    onRemoveAllFiles,
    inputRef,
    captureScreenshot,
    isScreenshotLoading,
    messagesEndRef,
    selectedSttProvider,
    allSttProviders,
    selectedAudioDevices,
    currentSupportsVision,
  };
};
