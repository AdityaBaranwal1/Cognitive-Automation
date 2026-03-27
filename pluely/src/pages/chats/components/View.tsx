import {
  Badge,
  Card,
  Empty,
  Button,
  Markdown,
  Textarea,
} from "@/components";
import { getConversationById } from "@/lib";
import { ChatConversation } from "@/types";
import {
  Download,
  MessageCircleIcon,
  MessageCircleReplyIcon,
  Trash2,
  SparklesIcon,
  UserIcon,
  SendIcon,
  Check,
  Loader2,
} from "lucide-react";
import { useState, useEffect } from "react";
import moment from "moment";
import { useParams, useNavigate } from "react-router-dom";
import { PageLayout } from "@/layouts";
import { useHistory, useChatCompletion } from "@/hooks";
import {
  DeleteConfirmationDialog,
  ChatAudio,
  ChatScreenshot,
  ChatFiles,
  AudioRecorder,
  ModelSwitcher,
} from ".";
import { ArrowRightIcon } from "lucide-react";
import { saveConversation, generateMessageId } from "@/lib";
import { getSavedProviderById } from "@/lib/storage/saved-providers.storage";
import { PROVIDER_PRESETS } from "@/config/provider-presets.constants";

function resolveProviderDisplayName(providerId?: string): string {
  if (!providerId) return "Unknown";
  const saved = getSavedProviderById(providerId);
  if (saved) {
    const preset = PROVIDER_PRESETS[saved.presetId];
    return preset?.name || saved.name;
  }
  const preset = PROVIDER_PRESETS[providerId];
  if (preset) return preset.name;
  return providerId;
}

const View = () => {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatConversation | null>(null);

  const {
    handleDeleteConfirm,
    confirmDelete,
    cancelDelete,
    deleteConfirm,
    handleAttachToOverlay,
    handleDownload,
    isDownloaded,
    isAttached,
  } = useHistory();

  const completion = useChatCompletion(
    conversationId as string,
    messages,
    setMessages
  );

  useEffect(() => {
    const getMessages = async () => {
      const conversation = await getConversationById(conversationId as string);
      setMessages(conversation || null);
    };
    getMessages();
  }, [conversationId]);

  useEffect(() => {
    // Scroll to bottom when messages load
    if (messages?.messages.length) {
      setTimeout(() => {
        completion.messagesEndRef.current?.scrollIntoView({
          behavior: "smooth",
        });
      }, 100);
    }
  }, [messages?.messages.length]);

  const handleDelete = async () => {
    await confirmDelete();
    navigate(-1);
  };

  // Handle model switch - creates visual divider and updates conversation
  const handleModelSwitch = async (newProviderId: string, newModel: string, newProfileId?: string) => {
    if (!messages || !conversationId) return;

    const currentProviderId = messages.providerId;
    const currentModel = messages.model;

    // Don't switch if same model
    if (currentProviderId === newProviderId && currentModel === newModel) return;

    // Generate checkpoint summary for token optimization
    const nonSwitchMessages = messages.messages.filter((m) => m.metadata?.type !== "model_switch");
    const checkpointContent = nonSwitchMessages.length > 4
      ? `[Context checkpoint - ${nonSwitchMessages.length} previous messages about: ${messages.title}]`
      : "";

    // Create model switch message with metadata
    const timestamp = Date.now();
    const switchMessage = {
      id: generateMessageId("system", timestamp),
      role: "system" as const,
      content: "",  // Empty content - rendered as visual divider
      timestamp,
      metadata: {
        type: "model_switch" as const,
        fromProvider: currentProviderId,
        fromModel: currentModel,
        toProvider: newProviderId,
        toModel: newModel,
        profileId: newProfileId,
        checkpoint: checkpointContent || undefined,
      },
    };

    // Update conversation with new provider/model and add switch message
    const updatedConversation = {
      ...messages,
      providerId: newProviderId,
      model: newModel,
      messages: [...messages.messages, switchMessage],
      updatedAt: timestamp,
    };

    // Update UI immediately
    setMessages(updatedConversation);

    // Save to database
    try {
      await saveConversation(updatedConversation);
    } catch (error) {
      console.error("Failed to save model switch:", error);
    }
  };

  return (
    <PageLayout
      isMainTitle={false}
      allowBackButton={true}
      title={messages?.title || ""}
      description={`${messages?.messages.length} messages in this conversation`}
      rightSlot={
        <div className="flex flex-row items-center gap-2">
          <ModelSwitcher
            currentProviderId={messages?.providerId}
            currentModel={messages?.model}
            onSwitch={handleModelSwitch}
          />
          <Button
            variant="outline"
            title="Open this conversation in overlay"
            className="text-[10px] lg:text-sm h-6 lg:h-8"
            onClick={() =>
              conversationId && handleAttachToOverlay(conversationId)
            }
            disabled={isAttached}
          >
            {isAttached ? (
              <>
                <Check className="size-3 lg:size-4 text-green-600" />
                Attached
              </>
            ) : (
              <>
                Open in Overlay{" "}
                <MessageCircleReplyIcon className="size-3 lg:size-4" />
              </>
            )}
          </Button>
          <Button
            variant={"outline"}
            title="Download conversation as markdown"
            className="text-[10px] lg:text-sm h-6 lg:h-8"
            onClick={(e) => handleDownload(messages, e)}
            disabled={isDownloaded}
          >
            {isDownloaded ? (
              <>
                <Check className="size-3 lg:size-4 text-green-600" />
                Downloaded
              </>
            ) : (
              <>
                Download <Download className="size-3 lg:size-4" />
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            title="Delete conversation"
            onClick={() =>
              conversationId && handleDeleteConfirm(conversationId)
            }
            className="text-[10px] lg:text-sm h-6 lg:h-8"
          >
            Delete <Trash2 className="size-3 lg:size-4" />
          </Button>
        </div>
      }
    >
      {messages?.messages.length === 0 ? (
        <Empty
          isLoading={false}
          icon={MessageCircleIcon}
          title="No messages found"
          description="Start a new message to get started"
        />
      ) : (
        <div className="flex flex-col gap-4 pb-24 px-2">
          {messages?.messages.map((message, index, array) => {
            const isUser = message.role === "user";
            const showDate =
              index === 0 ||
              moment(message.timestamp).format("YYYY-MM-DD") !==
              moment(array[index - 1]?.timestamp).format("YYYY-MM-DD");

            // Check if this is a model switch message
            const isModelSwitch = message.metadata?.type === "model_switch";

            return (
              <div key={message.id}>
                {/* Date separator */}
                {showDate && (
                  <Badge
                    variant={"outline"}
                    className="flex items-center justify-center my-4 w-fit mx-auto"
                  >
                    {moment(message.timestamp).format("ddd, MMM D")}
                  </Badge>
                )}

                {/* Model Switch Visual Divider */}
                {isModelSwitch && (
                  <div className="flex items-center justify-center gap-2 my-4 px-4">
                    <div className="flex-1 h-px bg-border" />
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted/50 border border-border text-xs text-muted-foreground">
                      <span className="font-medium">
                        {resolveProviderDisplayName(message.metadata?.fromProvider)}
                        {message.metadata?.fromModel && ` / ${message.metadata.fromModel}`}
                      </span>
                      <ArrowRightIcon className="size-3" />
                      <span className="font-medium text-primary">
                        {resolveProviderDisplayName(message.metadata?.toProvider)}
                        {message.metadata?.toModel && ` / ${message.metadata.toModel}`}
                      </span>
                    </div>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}

                {/* Message - Skip rendering for model_switch messages (they only show divider) */}
                {!isModelSwitch && (
                  <div
                    className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"
                      }`}
                  >
                    {/* Avatar - Left side for bot */}
                    {!isUser && (
                      <div className="flex-shrink-0">
                        <div className="size-7 lg:size-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <SparklesIcon className="size-3 lg:size-4 text-primary" />
                        </div>
                      </div>
                    )}

                    {/* Message content */}
                    <div
                      className={`flex flex-col gap-1 max-w-[70%] ${isUser ? "items-end" : "items-start"
                        }`}
                    >
                      <Card
                        className={`px-4 text-xs lg:text-sm py-0 transition-all select-none shadow-none ${isUser
                          ? "!bg-primary text-primary-foreground !border-primary rounded-tr-sm"
                          : "!bg-muted/50 dark:!bg-muted/30 rounded-tl-sm"
                          }`}
                      >
                        <Markdown>{message.content}</Markdown>
                        {/* Attachments */}
                        {message.attachedFiles && message.attachedFiles.length > 0 && (
                          <div className="flex flex-col gap-2 mt-2">
                            {message.attachedFiles.map((file, i) => (
                              <div key={i} className="rounded-md overflow-hidden">
                                {file.type.startsWith("image/") ? (
                                  <img
                                    src={`data:${file.type};base64,${file.base64}`}
                                    alt={file.name}
                                    className="max-w-full h-auto max-h-[200px] object-cover rounded-md"
                                  />
                                ) : file.type.startsWith("audio/") ? (
                                  <audio
                                    controls
                                    src={`data:${file.type};base64,${file.base64}`}
                                    className="w-full"
                                  />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                      <Badge
                        variant="outline"
                        className={`text-[10px] lg:text-xs bg-transparent border-none ${isUser ? "-mr-1" : "-ml-1"
                          }`}
                      >
                        {moment(message.timestamp).format("hh:mm A")}
                      </Badge>
                    </div>

                    {/* Avatar - Right side for user */}
                    {isUser && (
                      <div className="flex-shrink-0">
                        <div className="size-7 lg:size-8 rounded-full bg-primary flex items-center justify-center">
                          <UserIcon className="size-3 lg:size-4 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={completion.messagesEndRef} />
        </div>
      )}

      {/* Sticky Footer Input */}
      <div className="absolute bottom-0 left-0 right-0 bg-background/10 backdrop-blur">
        {completion.error && (
          <div className="px-4 pt-3 pb-0">
            <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
              <strong>Error:</strong> {completion.error}
            </div>
          </div>
        )}

        <div className="relative flex items-start gap-2 p-4">

          <div className="flex-1 relative">
            {completion.isRecording ? (
              <AudioRecorder
                onTranscriptionComplete={(text) => {
                  completion.setIsRecording(false);
                  completion.submit(text);
                }}
                onCancel={() => completion.setIsRecording(false)}
              />
            ) : (
              <>
                <div className="absolute bottom-2 left-2 flex items-center gap-1 z-10">
                  <ChatFiles
                    attachedFiles={completion.attachedFiles}
                    handleFileSelect={completion.handleFileSelect}
                    removeFile={completion.removeFile}
                    onRemoveAllFiles={completion.onRemoveAllFiles}
                    isLoading={completion.isLoading}
                    isFilesPopoverOpen={completion.isFilesPopoverOpen}
                    setIsFilesPopoverOpen={completion.setIsFilesPopoverOpen}
                    disabled={false}
                  />
                  <ChatAudio
                    micOpen={completion.micOpen}
                    setMicOpen={completion.setMicOpen}
                    isRecording={completion.isRecording}
                    setIsRecording={completion.setIsRecording}
                    disabled={false}
                  />
                  <ChatScreenshot
                    screenshotConfiguration={completion.screenshotConfiguration}
                    attachedFiles={completion.attachedFiles}
                    isLoading={completion.isLoading}
                    captureScreenshot={completion.captureScreenshot}
                    isScreenshotLoading={completion.isScreenshotLoading}
                    disabled={false}
                  />
                </div>

                <Textarea
                  ref={completion.inputRef}
                  placeholder="Type a message..."
                  className="pr-12 pl-2 resize-none pb-12 pt-3"
                  rows={2}
                  value={completion.input}
                  onChange={(e) => completion.setInput(e.target.value)}
                  onKeyDown={completion.handleKeyPress}
                  onPaste={completion.handlePaste}
                  disabled={completion.isLoading}
                />
                <Button
                  size="icon"
                  className="size-7 lg:size-9 rounded-lg lg:rounded-xl absolute right-2 bottom-2"
                  title="Send message"
                  onClick={() => completion.submit()}
                  disabled={
                    completion.isLoading ||
                    !completion.input.trim()
                  }
                >
                  {completion.isLoading ? (
                    <Loader2 className="size-3 lg:size-4 animate-spin" />
                  ) : (
                    <SendIcon className="size-3 lg:size-4" />
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        deleteConfirm={deleteConfirm}
        cancelDelete={cancelDelete}
        confirmDelete={handleDelete}
      />
    </PageLayout>
  );
};

export default View;
