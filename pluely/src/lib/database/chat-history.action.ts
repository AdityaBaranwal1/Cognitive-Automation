import { getDatabase } from "./config";
import { ChatConversation, ConversationSummary } from "@/types";
import { safeLocalStorage } from "@/lib";

// Legacy localStorage key for migration purposes
const LEGACY_CHAT_HISTORY_KEY = "chat_history";

/**
 * Database conversation type (flattened for SQL)
 */
interface DbConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  provider_id: string | null;
  model: string | null;
}

/**
 * Database message type (flattened for SQL)
 */
interface DbMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attached_files: string | null; // JSON string
  metadata: string | null; // JSON string
}

/**
 * Safely parse JSON with error handling
 */
function safeJsonParse<T>(jsonString: string | null, fallback: T): T {
  if (!jsonString) return fallback;
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error("Failed to parse JSON:", error);
    return fallback;
  }
}

/**
 * Validate conversation data
 */
function validateConversation(conversation: ChatConversation): boolean {
  if (!conversation.id || typeof conversation.id !== "string") {
    console.error("Invalid conversation: missing or invalid id");
    return false;
  }
  if (!conversation.title || typeof conversation.title !== "string") {
    console.error("Invalid conversation: missing or invalid title");
    return false;
  }
  if (!Array.isArray(conversation.messages)) {
    console.error("Invalid conversation: messages is not an array");
    return false;
  }
  return true;
}

/**
 * Validate message data
 */
function validateMessage(message: any): boolean {
  if (!message.id || typeof message.id !== "string") {
    console.error("Invalid message: missing or invalid id");
    return false;
  }
  if (
    !message.role ||
    !["user", "assistant", "system"].includes(message.role)
  ) {
    console.error("Invalid message: missing or invalid role");
    return false;
  }
  if (typeof message.content !== "string") {
    console.error("Invalid message: content must be a string");
    return false;
  }
  if (typeof message.timestamp !== "number" || message.timestamp < 0) {
    console.error("Invalid message: invalid timestamp");
    return false;
  }
  return true;
}

/**
 * Insert a single message row into the database
 */
async function insertMessage(
  db: Awaited<ReturnType<typeof getDatabase>>,
  message: any,
  conversationId: string
): Promise<void> {
  const attachedFilesJson = message.attachedFiles
    ? JSON.stringify(message.attachedFiles)
    : null;
  const metadataJson = message.metadata
    ? JSON.stringify(message.metadata)
    : null;

  await db.execute(
    "INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      message.id,
      conversationId,
      message.role,
      message.content,
      message.timestamp || Date.now(),
      attachedFilesJson,
      metadataJson,
    ]
  );
}

/**
 * Map a database message row to a ChatMessage object
 */
function mapDbMessage(msg: DbMessage) {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    attachedFiles: safeJsonParse(msg.attached_files, undefined),
    metadata: safeJsonParse(msg.metadata, undefined),
  };
}

/**
 * Create a new conversation with transaction safety
 */
export async function createConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  const db = await getDatabase();

  try {
    // Insert conversation
    await db.execute(
      "INSERT INTO conversations (id, title, created_at, updated_at, provider_id, model) VALUES (?, ?, ?, ?, ?, ?)",
      [
        conversation.id,
        conversation.title,
        conversation.createdAt || Date.now(),
        conversation.updatedAt || Date.now(),
        conversation.providerId || null,
        conversation.model || null,
      ]
    );

    // Insert all messages
    for (const message of conversation.messages) {
      if (!validateMessage(message)) {
        console.warn("Skipping invalid message in conversation creation");
        continue;
      }
      await insertMessage(db, message, conversation.id);
    }

    return conversation;
  } catch (error) {
    console.error("Failed to create conversation:", error);
    // Rollback: delete conversation if message insertion failed
    await db
      .execute("DELETE FROM conversations WHERE id = ?", [conversation.id])
      .catch(() => { });
    throw error;
  }
}

/**
 * Get all conversations with messages in a single optimized query
 */
export async function getAllConversations(): Promise<ChatConversation[]> {
  const db = await getDatabase();

  try {
    // Get all conversations
    const conversations = await db.select<DbConversation[]>(
      "SELECT * FROM conversations ORDER BY updated_at DESC"
    );

    if (conversations.length === 0) {
      return [];
    }

    // Get all messages for these conversations in one query
    const conversationIds = conversations.map((c) => c.id);
    const placeholders = conversationIds.map(() => "?").join(",");
    const allMessages = await db.select<DbMessage[]>(
      `SELECT * FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, timestamp ASC`,
      conversationIds
    );

    // Group messages by conversation_id
    const messagesByConversation = new Map<string, DbMessage[]>();
    for (const msg of allMessages) {
      if (!messagesByConversation.has(msg.conversation_id)) {
        messagesByConversation.set(msg.conversation_id, []);
      }
      messagesByConversation.get(msg.conversation_id)!.push(msg);
    }

    // Build result
    return conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      providerId: conv.provider_id || undefined,
      model: conv.model || undefined,
      messages:
        messagesByConversation.get(conv.id)?.map(mapDbMessage) || [],
    }));
  } catch (error) {
    console.error("Failed to get all conversations:", error);
    throw error;
  }
}

/**
 * Get conversation summaries for list view (no message content loaded)
 */
export async function getAllConversationSummaries(): Promise<ConversationSummary[]> {
  const db = await getDatabase();

  try {
    const rows = await db.select<Array<{
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
      provider_id: string | null;
      model: string | null;
      message_count: number;
    }>>(
      `SELECT c.id, c.title, c.created_at, c.updated_at, c.provider_id, c.model,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
       FROM conversations c
       ORDER BY c.updated_at DESC`
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      messageCount: row.message_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      providerId: row.provider_id || undefined,
      model: row.model || undefined,
    }));
  } catch (error) {
    console.error("Failed to get conversation summaries:", error);
    throw error;
  }
}

/**
 * Get a single conversation by ID
 */
export async function getConversationById(
  id: string
): Promise<ChatConversation | null> {
  if (!id || typeof id !== "string") {
    console.error("Invalid conversation id");
    return null;
  }

  const db = await getDatabase();

  try {
    // Get conversation
    const conversations = await db.select<DbConversation[]>(
      "SELECT * FROM conversations WHERE id = ?",
      [id]
    );

    if (conversations.length === 0) {
      return null;
    }

    const conv = conversations[0];

    // Get messages
    const messages = await db.select<DbMessage[]>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
      [id]
    );

    return {
      id: conv.id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      providerId: conv.provider_id || undefined,
      model: conv.model || undefined,
      messages: messages.map(mapDbMessage),
    };
  } catch (error) {
    console.error(`Failed to get conversation ${id}:`, error);
    return null;
  }
}

/**
 * Update a conversation with transaction safety
 */
export async function updateConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  const db = await getDatabase();

  try {
    // Update conversation (also update provider/model if provided)
    const updateResult = await db.execute(
      "UPDATE conversations SET title = ?, updated_at = ?, provider_id = COALESCE(?, provider_id), model = COALESCE(?, model) WHERE id = ?",
      [conversation.title, conversation.updatedAt, conversation.providerId || null, conversation.model || null, conversation.id]
    );

    if (updateResult.rowsAffected === 0) {
      throw new Error("Conversation not found");
    }

    // Get existing messages for backup
    const existingMessages = await db.select<DbMessage[]>(
      "SELECT * FROM messages WHERE conversation_id = ?",
      [conversation.id]
    );

    // Delete existing messages
    await db.execute("DELETE FROM messages WHERE conversation_id = ?", [
      conversation.id,
    ]);

    // Insert updated messages
    try {
      for (const message of conversation.messages) {
        if (!validateMessage(message)) {
          console.warn("Skipping invalid message in conversation update");
          continue;
        }
        await insertMessage(db, message, conversation.id);
      }
    } catch (messageError) {
      // Rollback: restore original messages
      console.error(
        "Failed to insert new messages, restoring backup:",
        messageError
      );
      for (const msg of existingMessages) {
        await db
          .execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp, attached_files, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              msg.id,
              msg.conversation_id,
              msg.role,
              msg.content,
              msg.timestamp,
              msg.attached_files,
              msg.metadata,
            ]
          )
          .catch(() => { });
      }
      throw messageError;
    }

    return conversation;
  } catch (error) {
    console.error("Failed to update conversation:", error);
    throw error;
  }
}

/**
 * Save or update a conversation (upsert operation)
 */
export async function saveConversation(
  conversation: ChatConversation
): Promise<ChatConversation> {
  if (!validateConversation(conversation)) {
    throw new Error("Invalid conversation data");
  }

  const db = await getDatabase();

  try {
    // Upsert conversation in a single query
    await db.execute(
      `INSERT INTO conversations (id, title, created_at, updated_at, provider_id, model)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at,
         provider_id = COALESCE(excluded.provider_id, conversations.provider_id),
         model = COALESCE(excluded.model, conversations.model)`,
      [
        conversation.id,
        conversation.title,
        conversation.createdAt || Date.now(),
        conversation.updatedAt || Date.now(),
        conversation.providerId || null,
        conversation.model || null,
      ]
    );

    // Replace all messages
    await db.execute("DELETE FROM messages WHERE conversation_id = ?", [
      conversation.id,
    ]);

    for (const message of conversation.messages) {
      if (!validateMessage(message)) {
        console.warn("Skipping invalid message in conversation save");
        continue;
      }
      await insertMessage(db, message, conversation.id);
    }

    return conversation;
  } catch (error) {
    console.error("Failed to save conversation:", error);
    throw error;
  }
}

/**
 * Delete a conversation and all its messages
 */
export async function deleteConversation(id: string): Promise<boolean> {
  if (!id || typeof id !== "string") {
    console.error("Invalid conversation id");
    return false;
  }

  const db = await getDatabase();

  try {
    const result = await db.execute("DELETE FROM conversations WHERE id = ?", [
      id,
    ]);

    return result.rowsAffected > 0;
  } catch (error) {
    console.error(`Failed to delete conversation ${id}:`, error);
    throw error;
  }
}

/**
 * Delete all conversations and messages
 */
export async function deleteAllConversations(): Promise<void> {
  const db = await getDatabase();

  try {
    // Delete in correct order (messages first due to foreign key)
    await db.execute("DELETE FROM messages");
    await db.execute("DELETE FROM conversations");
  } catch (error) {
    console.error("Failed to delete all conversations:", error);
    throw error;
  }
}

/**
 * Return the user message as the conversation title
 */
export function generateConversationTitle(userMessage: string): string {
  return userMessage.trim();
}

/**
 * Migrate chat history from localStorage to SQLite
 * This function safely moves all existing localStorage chat history to the database
 */
export async function migrateLocalStorageToSQLite(): Promise<{
  success: boolean;
  migratedCount: number;
  error?: string;
}> {
  const migrationKey = "chat_history_migrated_to_sqlite";

  try {
    // Check if migration has already been done
    if (safeLocalStorage.getItem(migrationKey) === "true") {
      return { success: true, migratedCount: 0 };
    }

    // Get existing localStorage data
    const existingData = safeLocalStorage.getItem(LEGACY_CHAT_HISTORY_KEY);
    if (!existingData) {
      // No data to migrate
      safeLocalStorage.setItem(migrationKey, "true");
      return { success: true, migratedCount: 0 };
    }

    // Parse localStorage conversations
    let conversations: ChatConversation[] = [];
    try {
      const parsed = JSON.parse(existingData);
      conversations = Array.isArray(parsed) ? parsed : [];
    } catch (parseError) {
      console.error("Failed to parse localStorage chat history:", parseError);
      // Mark as migrated anyway to prevent repeated failures
      safeLocalStorage.setItem(migrationKey, "true");
      return {
        success: false,
        migratedCount: 0,
        error: "Failed to parse localStorage data",
      };
    }

    if (conversations.length === 0) {
      // No valid data to migrate
      safeLocalStorage.setItem(migrationKey, "true");
      return { success: true, migratedCount: 0 };
    }

    // Get database instance
    const db = await getDatabase();

    // Migrate each conversation
    let migratedCount = 0;
    let errorCount = 0;

    for (const conversation of conversations) {
      try {
        // Validate conversation data
        if (!conversation?.id || !conversation?.title) {
          console.warn("Skipping invalid conversation:", conversation);
          errorCount++;
          continue;
        }

        // Check if conversation already exists in database
        const existing = await getConversationById(conversation.id);
        if (existing) {
          console.log(
            `Conversation ${conversation.id} already exists, skipping`
          );
          continue;
        }

        // Insert conversation
        await db.execute(
          "INSERT INTO conversations (id, title, created_at, updated_at, provider_id, model) VALUES (?, ?, ?, ?, ?, ?)",
          [
            conversation.id,
            conversation.title,
            conversation.createdAt || Date.now(),
            conversation.updatedAt || Date.now(),
            conversation.providerId || null,
            conversation.model || null,
          ]
        );

        // Insert messages
        if (
          Array.isArray(conversation.messages) &&
          conversation.messages.length > 0
        ) {
          for (const message of conversation.messages) {
            if (!validateMessage(message)) {
              console.warn(
                `Skipping invalid message in conversation ${conversation.id}:`,
                message
              );
              continue;
            }
            await insertMessage(db, message, conversation.id);
          }
        }

        migratedCount++;
      } catch (convError) {
        console.error(
          `Failed to migrate conversation ${conversation?.id}:`,
          convError
        );
        errorCount++;
        // Clean up partially migrated conversation
        await db
          .execute("DELETE FROM conversations WHERE id = ?", [conversation?.id])
          .catch(() => { });
      }
    }

    // Mark migration as complete even if some failed
    safeLocalStorage.setItem(migrationKey, "true");

    // Clear localStorage chat history after migration attempt
    safeLocalStorage.removeItem(LEGACY_CHAT_HISTORY_KEY);

    const message =
      errorCount > 0
        ? `Migrated ${migratedCount}/${conversations.length} conversations (${errorCount} failed)`
        : `Successfully migrated ${migratedCount} conversations`;

    console.log(message);

    return {
      success: migratedCount > 0 || errorCount === 0,
      migratedCount,
      error:
        errorCount > 0
          ? `${errorCount} conversations failed to migrate`
          : undefined,
    };
  } catch (error) {
    console.error("Migration failed:", error);
    // Mark as attempted to prevent infinite retry loops
    safeLocalStorage.setItem(migrationKey, "true");
    return {
      success: false,
      migratedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
