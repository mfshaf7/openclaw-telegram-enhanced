export type {
  OpenClawConfig,
  TelegramAccountConfig,
  TelegramActionConfig,
  TelegramNetworkConfig,
} from "openclaw/plugin-sdk/config-runtime";
export type { ChannelMessageActionAdapter } from "openclaw/plugin-sdk/channel-contract";
export type { ChannelPlugin, PluginRuntime } from "openclaw/plugin-sdk/core";
export type { TelegramApiOverride } from "./src/send.js";
export type {
  AcpRuntime,
  AcpRuntimeCapabilities,
  AcpRuntimeDoctorReport,
  AcpRuntimeEnsureInput,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeStatus,
  AcpRuntimeTurnInput,
  AcpRuntimeErrorCode,
  AcpSessionUpdateTag,
} from "openclaw/plugin-sdk/acp-runtime";

export { AcpRuntimeError } from "openclaw/plugin-sdk/acp-runtime";
export {
  buildChannelConfigSchema,
  clearAccountEntryFields,
  DEFAULT_ACCOUNT_ID,
  getChatChannelMeta,
  jsonResult,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "openclaw/plugin-sdk/core";
export {
  readReactionParams,
  readStringOrNumberParam,
  resolvePollMaxSelections,
} from "openclaw/plugin-sdk/channel-actions";
export {
  buildTokenChannelStatusSummary,
  projectCredentialSnapshotFields,
  resolveConfiguredFromCredentialStatuses,
} from "openclaw/plugin-sdk/channel-status";
export { TelegramConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

export type { TelegramProbe } from "./src/probe.js";
export { auditTelegramGroupMembership, collectTelegramUnmentionedGroupIds } from "./src/audit.js";
export { telegramMessageActions } from "./src/channel-actions.js";
export { monitorTelegramProvider } from "./src/monitor.js";
export { probeTelegram } from "./src/probe.js";
export {
  createForumTopicTelegram,
  deleteMessageTelegram,
  editForumTopicTelegram,
  editMessageReplyMarkupTelegram,
  editMessageTelegram,
  pinMessageTelegram,
  reactMessageTelegram,
  renameForumTopicTelegram,
  sendMessageTelegram,
  sendPollTelegram,
  sendStickerTelegram,
  sendTypingTelegram,
  unpinMessageTelegram,
} from "./src/send.js";
export {
  createTelegramThreadBindingManager,
  getTelegramThreadBindingManager,
  setTelegramThreadBindingIdleTimeoutBySessionKey,
  setTelegramThreadBindingMaxAgeBySessionKey,
} from "./src/thread-bindings.js";
export { resolveTelegramToken } from "./src/token.js";

export { parseTelegramTopicConversation } from "./src/telegram-topic-conversation.ts";


export function resolveTelegramPollVisibility(params: {
  pollAnonymous?: boolean;
  pollPublic?: boolean;
}): boolean | undefined {
  if (params.pollAnonymous && params.pollPublic) {
    throw new Error("pollAnonymous and pollPublic are mutually exclusive");
  }
  if (params.pollAnonymous) {
    return true;
  }
  if (params.pollPublic) {
    return false;
  }
  return undefined;
}
