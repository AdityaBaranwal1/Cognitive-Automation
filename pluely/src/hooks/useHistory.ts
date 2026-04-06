import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getAllConversationSummaries,
  deleteConversation,
  deleteAllConversations,
  DOWNLOAD_SUCCESS_DISPLAY_MS,
} from "@/lib";
import { ChatConversation, ConversationSummary } from "@/types/completion";
import { generateConversationMarkdown, generateFilename } from "@/lib/functions/conversation.function";

export type UseHistoryType = ReturnType<typeof useHistory>;

export interface UseHistoryReturn {
  // State
  conversations: ConversationSummary[];
  selectedConversationId: string | null;
  viewingConversation: ChatConversation | null;
  deleteConfirm: string | null;
  isDownloaded: boolean;
  isAttached: boolean;
  downloadError: string | null;

  // Actions
  handleViewConversation: (conversation: ChatConversation) => void;
  handleDeleteConfirm: (conversationId: string) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  clearAllConversations: () => Promise<void>;
  handleAttachToOverlay: (conversationId: string) => void;
  handleDownload: (
    conversation: ChatConversation | null,
    e: React.MouseEvent
  ) => void;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  // Utilities
  refreshConversations: () => void;
  isLoading: boolean;
}

export function useHistory(): UseHistoryReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [search, setSearch] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [viewingConversation, setViewingConversation] =
    useState<ChatConversation | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isAttached, setIsAttached] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Function to refresh conversations
  const refreshConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      const summaries = await getAllConversationSummaries();
      setConversations(summaries);
    } catch (error) {
      console.error("Failed to load conversations:", error);
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load conversations when component mounts or popover opens
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  const handleViewConversation = (conversation: ChatConversation) => {
    setViewingConversation(conversation);
  };

  const handleDownloadConversation = async (
    conversation: ChatConversation,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setDownloadError(null);

    const markdown = generateConversationMarkdown(conversation);
    const filename = generateFilename(conversation.title);

    // Try Rust file save first, fall back to clipboard
    try {
      await invoke("save_to_downloads", { filename, content: markdown });
      setIsDownloaded(true);
      setTimeout(() => setIsDownloaded(false), DOWNLOAD_SUCCESS_DISPLAY_MS);
    } catch (rustError) {
      console.warn("Rust save_to_downloads failed, falling back to clipboard:", rustError);
      try {
        await navigator.clipboard.writeText(markdown);
        setIsDownloaded(true);
        setTimeout(() => setIsDownloaded(false), DOWNLOAD_SUCCESS_DISPLAY_MS);
        setDownloadError("Saved to clipboard (file save unavailable)");
        setTimeout(() => setDownloadError(null), 3000);
      } catch (clipboardError) {
        console.error("Both download methods failed:", clipboardError);
        setDownloadError("Download failed: " + String(rustError));
        setTimeout(() => setDownloadError(null), 5000);
      }
    }
  };

  const handleDeleteConfirm = (conversationId: string) => {
    setDeleteConfirm(conversationId);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      setSelectedConversationId(null);
      setViewingConversation(null);
      await deleteConversation(deleteConfirm);
      setConversations((prev) => prev.filter((c) => c.id !== deleteConfirm));

      // Emit event to notify other components about deletion
      window.dispatchEvent(
        new CustomEvent("conversationDeleted", {
          detail: deleteConfirm,
        })
      );
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  // NEW: Clear all conversations (bulk delete)
  const clearAllConversations = async () => {
    try {
      await deleteAllConversations();
      setConversations([]);
      setSelectedConversationId(null);
      setViewingConversation(null);

      // Emit event to notify other components
      window.dispatchEvent(new CustomEvent("allConversationsDeleted"));
    } catch (error) {
      console.error("Failed to clear all conversations:", error);
    }
  };

  const handleAttachToOverlay = (conversationId: string) => {
    const data = JSON.stringify({ id: conversationId, timestamp: Date.now() });
    localStorage.setItem("app-conversation-selected", data);
    invoke("save_persistent_data", { key: "app-conversation-selected", data }).catch(console.error);
    setIsAttached(true);
    setTimeout(() => {
      setIsAttached(false);
    }, DOWNLOAD_SUCCESS_DISPLAY_MS);
  };

  const handleDownload = (
    conversation: ChatConversation | null,
    e: React.MouseEvent
  ) => {
    if (conversation) {
      handleDownloadConversation(conversation, e);
    }
  };

  return {
    // State
    conversations,
    selectedConversationId,
    viewingConversation,
    deleteConfirm,
    isDownloaded,
    isAttached,
    downloadError,

    // Actions
    handleViewConversation,
    handleDeleteConfirm,
    confirmDelete,
    cancelDelete,
    clearAllConversations,
    handleAttachToOverlay,
    handleDownload,
    // Utilities
    refreshConversations,
    search,
    setSearch,
    isLoading,
  };
}
