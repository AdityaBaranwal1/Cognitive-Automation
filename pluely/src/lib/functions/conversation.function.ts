import { ChatConversation } from "@/types/completion";

export function generateConversationMarkdown(
  conversation: ChatConversation
): string {
  let markdown = `# ${conversation.title}\n\n`;
  markdown += `**Created:** ${new Date(
    conversation.createdAt
  ).toLocaleString()}\n`;
  markdown += `**Updated:** ${new Date(
    conversation.updatedAt
  ).toLocaleString()}\n`;
  markdown += `**Messages:** ${conversation.messages.length}\n\n---\n\n`;

  conversation.messages.forEach((message, index) => {
    const roleLabel = message.role.toUpperCase();
    markdown += `## ${roleLabel}\n\n${message.content}\n\n`;

    if (index < conversation.messages.length - 1) {
      markdown += "---\n\n";
    }
  });

  return markdown;
}

export function generateFilename(title: string): string {
  const sanitizedTitle = title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  return `${sanitizedTitle.substring(0, 50)}.md`;
}
