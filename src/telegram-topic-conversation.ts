export function parseTelegramTopicConversation(params: {
  conversationId: string;
  parentConversationId?: string | null;
}) {
  const conversation = normalizeTelegramTopicToken(params.conversationId);
  if (!conversation) {
    return null;
  }
  const directMatch = conversation.match(/^(-?\d+):topic:(\d+)$/i);
  if (directMatch?.[1] && directMatch[2]) {
    const canonicalConversationId = buildTelegramTopicConversationId({
      chatId: directMatch[1],
      topicId: directMatch[2],
    });
    if (!canonicalConversationId) {
      return null;
    }
    return {
      chatId: directMatch[1],
      topicId: directMatch[2],
      canonicalConversationId,
    };
  }
  if (!/^\d+$/.test(conversation)) {
    return null;
  }
  const parent = normalizeTelegramTopicToken(params.parentConversationId);
  if (!parent || !/^-?\d+$/.test(parent)) {
    return null;
  }
  const canonicalConversationId = buildTelegramTopicConversationId({
    chatId: parent,
    topicId: conversation,
  });
  if (!canonicalConversationId) {
    return null;
  }
  return {
    chatId: parent,
    topicId: conversation,
    canonicalConversationId,
  };
}

function buildTelegramTopicConversationId(params: {
  chatId: string;
  topicId: string;
}) {
  const chatId = normalizeTelegramTopicToken(params.chatId);
  const topicId = normalizeTelegramTopicToken(params.topicId);
  if (!/^-?\d+$/.test(chatId) || !/^\d+$/.test(topicId)) {
    return null;
  }
  return `${chatId}:topic:${topicId}`;
}

function normalizeTelegramTopicToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
