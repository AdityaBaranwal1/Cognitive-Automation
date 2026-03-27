// Completion-related types
export interface AttachedFile {
  id: string;
  name: string;
  type: string;
  base64: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
  metadata?: {
    type?: 'model_switch';
    fromModel?: string;
    toModel?: string;
    fromProvider?: string;
    toProvider?: string;
    profileId?: string;
    checkpoint?: string;
  };
}


export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  providerId?: string;  // Provider ID used to create this conversation (hybrid: falls back to global if not set)
  model?: string;       // Model used to create this conversation
}

export interface CompletionState {
  input: string;
  response: string;
  isLoading: boolean;
  error: string | null;
  attachedFiles: AttachedFile[];
  currentConversationId: string | null;
  conversationHistory: ChatMessage[];
}

// Provider-related types
export interface Message {
  role: "system" | "user" | "assistant";
  content:
  | string
  | Array<{
    type: string;
    text?: string;
    image_url?: { url: string };
    source?: any;
    inline_data?: any;
  }>;
}
