import type {
  TelegramDirectConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "openclaw/plugin-sdk/config-runtime";
import { firstDefined } from "./bot-access.js";

const HOST_CONTROL_TOPIC_SYSTEM_PROMPT = [
  "You are operating inside a dedicated host-control Telegram topic.",
  "Do not infer the work domain from the group title, conversation label, or other untrusted metadata.",
  "Do not describe yourself as helping with the group's subject matter unless the user explicitly asks for that and it is within host-control scope.",
  "Stay within host-control scope: host diagnostics, health, bridge and recovery status, allowed roots, file browsing, and explicit host actions.",
  "If a request is outside host-control scope, say so briefly instead of reframing it as general research or workspace assistance.",
].join(" ");

export function resolveTelegramGroupPromptSettings(params: {
  groupConfig?: TelegramGroupConfig | TelegramDirectConfig;
  topicConfig?: TelegramTopicConfig;
}): {
  skillFilter: string[] | undefined;
  groupSystemPrompt: string | undefined;
} {
  const skillFilter = firstDefined(params.topicConfig?.skills, params.groupConfig?.skills);
  const systemPromptParts = [
    params.groupConfig?.systemPrompt?.trim() || null,
    params.topicConfig?.systemPrompt?.trim() || null,
  ].filter((entry): entry is string => Boolean(entry));
  const groupSystemPrompt =
    systemPromptParts.length > 0 ? systemPromptParts.join("\n\n") : undefined;
  return { skillFilter, groupSystemPrompt };
}

export function appendHostControlTopicSystemPrompt(params: {
  groupSystemPrompt?: string;
  isGroup: boolean;
  resolvedThreadId?: number;
  agentId?: string;
}): string | undefined {
  const hostControlTopicPrompt =
    params.isGroup && params.resolvedThreadId != null && params.agentId === "host-control"
      ? HOST_CONTROL_TOPIC_SYSTEM_PROMPT
      : undefined;
  return [params.groupSystemPrompt, hostControlTopicPrompt]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n\n") || undefined;
}
