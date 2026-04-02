import type { Bot } from "grammy";
import { resolveAgentDir } from "openclaw/plugin-sdk/agent-runtime";
import {
  findModelInCatalog,
  loadModelCatalog,
  modelSupportsVision,
} from "openclaw/plugin-sdk/agent-runtime";
import { resolveDefaultModelForAgent } from "openclaw/plugin-sdk/agent-runtime";
import {
  logAckFailure,
  logTypingFailure,
  removeAckReactionAfterReply,
} from "openclaw/plugin-sdk/channel-feedback";
import { createChannelReplyPipeline } from "openclaw/plugin-sdk/channel-reply-pipeline";
import { resolveMarkdownTableMode } from "openclaw/plugin-sdk/config-runtime";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  resolveStorePath,
} from "openclaw/plugin-sdk/config-runtime";
import type { OpenClawConfig, ReplyToMode, TelegramAccountConfig, TelegramDirectConfig } from "openclaw/plugin-sdk/config-runtime";
import { getAgentScopedMediaLocalRoots } from "openclaw/plugin-sdk/media-runtime";
import { clearHistoryEntriesIfEnabled } from "openclaw/plugin-sdk/reply-history";
import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import { resolveChunkMode } from "openclaw/plugin-sdk/reply-runtime";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { resolveAutoTopicLabelConfig, generateTopicLabel } from "openclaw/plugin-sdk/reply-runtime";
import { danger, logVerbose } from "openclaw/plugin-sdk/runtime-env";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { defaultTelegramBotDeps, type TelegramBotDeps } from "./bot-deps.js";
import type { TelegramMessageContext } from "./bot-message-context.js";
import type { TelegramBotOptions } from "./bot.js";
import { deliverReplies, emitInternalMessageSentHook } from "./bot/delivery.js";
import type { TelegramStreamMode } from "./bot/types.js";
import type { TelegramInlineButtons } from "./button-types.js";
import { createTelegramDraftStream } from "./draft-stream.js";
import { shouldSuppressLocalTelegramExecApprovalPrompt } from "./exec-approvals.js";
import { looksLikeTelegramExecApprovalFallbackText } from "./exec-approvals.js";
import { renderTelegramHtmlText } from "./format.js";
import {
  type ArchivedPreview,
  createLaneDeliveryStateTracker,
  createLaneTextDeliverer,
  type DraftLaneState,
  type LaneDeliveryResult,
  type LaneName,
  type LanePreviewLifecycle,
} from "./lane-delivery.js";
import {
  createTelegramReasoningStepState,
  splitTelegramReasoningText,
} from "./reasoning-lane-coordinator.js";
import { editMessageTelegram } from "./send.js";
import { cacheSticker, describeStickerImage } from "./sticker-cache.js";
import {
  tryHandleForcedHostControlReadTelegram,
  tryHandleForcedHostControlScreenshotTelegram,
} from "./bot-message-dispatch.host-control.js";

const EMPTY_RESPONSE_FALLBACK = "No response generated. Please try again.";
const SECURITY_ARCHITECTURE_AGENT_ID = "security-architecture";
const SECURITY_EVIDENCE_AGENT_ID = "security-evidence";
const SECURITY_EVIDENCE_COLLECTION_FAILED =
  "Evidence collection failed because the evidence agent did not return a valid structured evidence bundle.";
const DEFAULT_HOST_CONTROL_AUTH_TOKEN_ENV = "OPENCLAW_HOST_BRIDGE_TOKEN";

/** Minimum chars before sending first streaming message (improves push notification UX) */
const DRAFT_MIN_INITIAL_CHARS = 30;

async function resolveStickerVisionSupport(cfg: OpenClawConfig, agentId: string) {
  try {
    const catalog = await loadModelCatalog({ config: cfg });
    const defaultModel = resolveDefaultModelForAgent({ cfg, agentId });
    const entry = findModelInCatalog(catalog, defaultModel.provider, defaultModel.model);
    if (!entry) {
      return false;
    }
    return modelSupportsVision(entry);
  } catch {
    return false;
  }
}

export function pruneStickerMediaFromContext(
  ctxPayload: {
    MediaPath?: string;
    MediaUrl?: string;
    MediaType?: string;
    MediaPaths?: string[];
    MediaUrls?: string[];
    MediaTypes?: string[];
  },
  opts?: { stickerMediaIncluded?: boolean },
) {
  if (opts?.stickerMediaIncluded === false) {
    return;
  }
  const nextMediaPaths = Array.isArray(ctxPayload.MediaPaths)
    ? ctxPayload.MediaPaths.slice(1)
    : undefined;
  const nextMediaUrls = Array.isArray(ctxPayload.MediaUrls)
    ? ctxPayload.MediaUrls.slice(1)
    : undefined;
  const nextMediaTypes = Array.isArray(ctxPayload.MediaTypes)
    ? ctxPayload.MediaTypes.slice(1)
    : undefined;
  ctxPayload.MediaPaths = nextMediaPaths && nextMediaPaths.length > 0 ? nextMediaPaths : undefined;
  ctxPayload.MediaUrls = nextMediaUrls && nextMediaUrls.length > 0 ? nextMediaUrls : undefined;
  ctxPayload.MediaTypes = nextMediaTypes && nextMediaTypes.length > 0 ? nextMediaTypes : undefined;
  ctxPayload.MediaPath = ctxPayload.MediaPaths?.[0];
  ctxPayload.MediaUrl = ctxPayload.MediaUrls?.[0] ?? ctxPayload.MediaPath;
  ctxPayload.MediaType = ctxPayload.MediaTypes?.[0];
}

type DispatchTelegramMessageParams = {
  context: TelegramMessageContext;
  bot: Bot;
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  replyToMode: ReplyToMode;
  streamMode: TelegramStreamMode;
  textLimit: number;
  telegramCfg: TelegramAccountConfig;
  telegramDeps?: TelegramBotDeps;
  opts: Pick<TelegramBotOptions, "token">;
};

type TelegramReasoningLevel = "off" | "on" | "stream";

type TelegramThreadSpec = {
  id?: number;
  scope?: string;
};

type SecurityEvidenceBundle = {
  type: "EVIDENCE_BUNDLE";
  question: string;
  verified_facts: string[];
  inferences: string[];
  unknowns: string[];
  confidence: string;
  recommended_next_check: string[];
};

type SecurityBridgeConfig = {
  bridgeUrl: string;
  authToken: string;
  authTokenEnv: string;
};

function extractTelegramBodyText(ctxPayload: {
  RawBody?: string;
  Body?: string;
  BodyForAgent?: string;
}): string {
  return ctxPayload.RawBody ?? ctxPayload.BodyForAgent ?? ctxPayload.Body ?? "";
}

function pushFact(facts: string[], key: string, value: string): void {
  facts.push(`${key}: ${value}`);
}

function resolveSecurityBridgeConfig(cfg: OpenClawConfig): SecurityBridgeConfig | null {
  const pluginEntry = cfg.plugins?.entries?.["host-control"];
  const pluginCfg =
    pluginEntry?.config && typeof pluginEntry.config === "object" && !Array.isArray(pluginEntry.config)
      ? pluginEntry.config
      : {};
  const bridgeUrl = typeof pluginCfg.bridgeUrl === "string" ? pluginCfg.bridgeUrl.trim() : "";
  if (!bridgeUrl) {
    return null;
  }
  const authTokenEnv =
    typeof pluginCfg.authTokenEnv === "string" && pluginCfg.authTokenEnv.trim()
      ? pluginCfg.authTokenEnv.trim()
      : DEFAULT_HOST_CONTROL_AUTH_TOKEN_ENV;
  const authToken = process.env[authTokenEnv]?.trim() ?? "";
  if (!authToken) {
    return null;
  }
  return {
    bridgeUrl: bridgeUrl.replace(/\/+$/, ""),
    authToken,
    authTokenEnv,
  };
}

async function callSecurityBridgeHealth(
  config: SecurityBridgeConfig,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${config.bridgeUrl}/v1/bridge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.authToken}`,
      },
      body: JSON.stringify({
        request_id: `telegram-security-evidence-health-${Date.now()}`,
        operation: "health.check",
        arguments: {},
        actor: {
          channel: "telegram",
          session_key: "security-evidence-orchestrator",
          sender_id: "system",
        },
      }),
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || json?.ok !== true) {
      return null;
    }
    return (json.result as Record<string, unknown> | undefined) ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeTelegramBindings(cfg: OpenClawConfig, chatId: string): string[] {
  const summaries: string[] = [];
  const telegramCfg = cfg.channels?.telegram;
  const groupCfg =
    telegramCfg && typeof telegramCfg === "object" && !Array.isArray(telegramCfg)
      ? (telegramCfg as { groups?: Record<string, unknown> }).groups
      : undefined;
  const targetGroup =
    groupCfg && typeof groupCfg === "object" && !Array.isArray(groupCfg)
      ? groupCfg[chatId]
      : undefined;
  if (targetGroup && typeof targetGroup === "object" && !Array.isArray(targetGroup)) {
    const topics = (targetGroup as { topics?: Record<string, unknown> }).topics;
    if (topics && typeof topics === "object" && !Array.isArray(topics)) {
      for (const [topicId, topicValue] of Object.entries(topics)) {
        if (!topicValue || typeof topicValue !== "object" || Array.isArray(topicValue)) {
          continue;
        }
        const topic = topicValue as { agentId?: unknown; enabled?: unknown };
        if (topic.enabled === false || typeof topic.agentId !== "string" || !topic.agentId) {
          continue;
        }
        pushFact(summaries, `telegram.topic.${topicId}.agent`, topic.agentId);
      }
    }
  }
  return summaries;
}

function summarizeAgentExposure(cfg: OpenClawConfig): string[] {
  const facts: string[] = [];
  const agentList = cfg.agents?.list ?? [];
  for (const agent of agentList) {
    if (!agent?.id) {
      continue;
    }
    if (agent.id === SECURITY_EVIDENCE_AGENT_ID) {
      const allow = Array.isArray(agent.tools?.allow) ? agent.tools.allow.join(", ") : "";
      const deny = Array.isArray(agent.tools?.deny) ? agent.tools.deny.join(", ") : "";
      if (allow) {
        pushFact(facts, `${SECURITY_EVIDENCE_AGENT_ID}.tools.allow`, allow);
      }
      if (deny) {
        pushFact(facts, `${SECURITY_EVIDENCE_AGENT_ID}.tools.deny`, deny);
      }
    }
    if (agent.id === SECURITY_ARCHITECTURE_AGENT_ID) {
      const deny = Array.isArray(agent.tools?.deny) ? agent.tools.deny.join(", ") : "none";
      pushFact(facts, `${SECURITY_ARCHITECTURE_AGENT_ID}.tools.deny`, deny);
    }
  }
  return facts;
}

async function buildDeterministicSecurityEvidenceBundle(params: {
  cfg: OpenClawConfig;
  chatId: string;
  originalText: string;
}): Promise<SecurityEvidenceBundle> {
  const verifiedFacts: string[] = [];
  const inferences: string[] = [];
  const unknowns: string[] = [];
  const recommendedNextCheck: string[] = [];

  verifiedFacts.push(...summarizeTelegramBindings(params.cfg, params.chatId));
  verifiedFacts.push(...summarizeAgentExposure(params.cfg));

  const bridgeConfig = resolveSecurityBridgeConfig(params.cfg);
  if (bridgeConfig) {
    pushFact(verifiedFacts, "host-control.bridge.url", bridgeConfig.bridgeUrl);
    pushFact(verifiedFacts, "host-control.bridge.authTokenEnv", bridgeConfig.authTokenEnv);
    const health = await callSecurityBridgeHealth(bridgeConfig).catch(() => null);
    const components =
      health && typeof health.components === "object" && !Array.isArray(health.components)
        ? (health.components as Record<string, unknown>)
        : null;
    const bridge = components?.bridge;
    const integrations = components?.integrations;
    const storage = components?.storage;
    if (bridge && typeof bridge === "object" && !Array.isArray(bridge)) {
      const bridgeOk = (bridge as Record<string, unknown>).ok === true;
      const mode = (bridge as Record<string, unknown>).mode;
      pushFact(verifiedFacts, "bridge.health.ok", String(bridgeOk));
      if (typeof mode === "string" && mode) {
        pushFact(verifiedFacts, "bridge.mode", mode);
      }
    } else {
      unknowns.push("Bridge health facts could not be read from the current bridge response.");
    }
    if (integrations && typeof integrations === "object" && !Array.isArray(integrations)) {
      const gateway = (integrations as Record<string, unknown>).gateway;
      const wsl = (integrations as Record<string, unknown>).wsl;
      if (gateway && typeof gateway === "object" && !Array.isArray(gateway)) {
        const gatewayOk = (gateway as Record<string, unknown>).ok === true;
        const gatewayHealth = (gateway as Record<string, unknown>).health;
        pushFact(verifiedFacts, "gateway.health.ok", String(gatewayOk));
        if (typeof gatewayHealth === "string" && gatewayHealth) {
          pushFact(verifiedFacts, "gateway.health.status", gatewayHealth);
        }
      }
      if (wsl && typeof wsl === "object" && !Array.isArray(wsl)) {
        const detected = (wsl as Record<string, unknown>).detected === true;
        const ok = (wsl as Record<string, unknown>).ok === true;
        pushFact(verifiedFacts, "wsl.detected", String(detected));
        pushFact(verifiedFacts, "wsl.ok", String(ok));
      }
    }
    if (storage && typeof storage === "object" && !Array.isArray(storage)) {
      const allowedRoots = (storage as Record<string, unknown>).allowedRoots;
      if (Array.isArray(allowedRoots)) {
        pushFact(verifiedFacts, "storage.allowedRoots.count", String(allowedRoots.length));
      }
    }
  } else {
    unknowns.push("The current runtime did not expose a usable OpenClaw host bridge configuration for evidence collection.");
  }

  pushFact(inferences, "routing.separation", "architecture and evidence are separated by topic");
  pushFact(inferences, "host-ops.path", "telegram host-facing actions are mediated by host-control bridge");
  pushFact(unknowns, "unknown", "remaining allowed tool surface on security-architecture is not yet validated as the right long-term boundary");
  pushFact(unknowns, "unknown", "host firewall, MFA, and external network hardening are not proven by this evidence bundle");
  pushFact(recommendedNextCheck, "next", "review whether remaining allowed tools on security-architecture are justified for a discussion-first agent");
  pushFact(recommendedNextCheck, "next", "add a deterministic runtime verifier for telegram topic bindings and exposed agent tools");

  return {
    type: "EVIDENCE_BUNDLE",
    question: params.originalText,
    verified_facts: verifiedFacts,
    inferences,
    unknowns,
    confidence: bridgeConfig ? "medium" : "low",
    recommended_next_check: recommendedNextCheck,
  };
}

function shouldRunSecurityEvidenceOrchestration(params: {
  agentId: string;
  text: string;
}): boolean {
  if (params.agentId !== SECURITY_ARCHITECTURE_AGENT_ID) {
    return false;
  }
  const text = params.text.toLowerCase();
  const explicitEvidenceRequest =
    /\buse evidence\b/.test(text) ||
    /\bwith evidence\b/.test(text) ||
    /\bevidence if needed\b/.test(text) ||
    /\bverify\b/.test(text);
  if (explicitEvidenceRequest) {
    return true;
  }
  const looksLikeCurrentSetupQuestion =
    /\b(current|this)\b/.test(text) &&
    /\b(setup|deployment|architecture|system)\b/.test(text) &&
    /\b(security|secure|sound|risk|trust boundary|good enough|ok)\b/.test(text);
  const looksLikeArchitectureJudgmentQuestion =
    /\b(architecture|trust boundary|design|deployment)\b/.test(text) &&
    /\b(sound|secure|security|risky|wrong|acceptable|good enough|ok)\b/.test(text);
  return looksLikeCurrentSetupQuestion || looksLikeArchitectureJudgmentQuestion;
}

function resolveSecurityEvidenceTopicBinding(params: {
  cfg: OpenClawConfig;
  chatId: string;
}): { sessionKey: string; threadSpec: TelegramThreadSpec; accountId?: string } | null {
  const telegramCfg = params.cfg.channels?.telegram;
  const groupCfg =
    telegramCfg && typeof telegramCfg === "object" && !Array.isArray(telegramCfg)
      ? (telegramCfg as { groups?: Record<string, unknown> }).groups
      : undefined;
  const targetGroup =
    groupCfg && typeof groupCfg === "object" && !Array.isArray(groupCfg)
      ? groupCfg[params.chatId]
      : undefined;
  if (targetGroup && typeof targetGroup === "object" && !Array.isArray(targetGroup)) {
    const topics = (targetGroup as { topics?: Record<string, unknown> }).topics;
    if (topics && typeof topics === "object" && !Array.isArray(topics)) {
      for (const [topicId, topicValue] of Object.entries(topics)) {
        if (!topicValue || typeof topicValue !== "object" || Array.isArray(topicValue)) {
          continue;
        }
        const topic = topicValue as { agentId?: unknown; enabled?: unknown };
        if (topic.enabled === false || topic.agentId !== SECURITY_EVIDENCE_AGENT_ID) {
          continue;
        }
        const parsedTopicId = Number.parseInt(topicId, 10);
        if (!Number.isFinite(parsedTopicId)) {
          continue;
        }
        return {
          sessionKey: `agent:${SECURITY_EVIDENCE_AGENT_ID}:telegram:group:${params.chatId}:topic:${parsedTopicId}`,
          threadSpec: { id: parsedTopicId, scope: "group" },
        };
      }
    }
  }
  for (const binding of params.cfg.bindings ?? []) {
    if (binding?.agentId !== SECURITY_EVIDENCE_AGENT_ID) {
      continue;
    }
    const peerId = binding?.match?.peer?.id;
    if (typeof peerId !== "string") {
      continue;
    }
    const match = new RegExp(`^${params.chatId}:topic:(\\d+)$`).exec(peerId);
    if (!match) {
      continue;
    }
    const topicId = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(topicId)) {
      continue;
    }
    return {
      sessionKey: `agent:${SECURITY_EVIDENCE_AGENT_ID}:telegram:group:${params.chatId}:topic:${topicId}`,
      threadSpec: { id: topicId, scope: "group" },
      accountId: binding?.match?.accountId,
    };
  }
  return null;
}

async function runTelegramAgentTextPass(params: {
  agentId: string;
  sessionKey: string;
  body: string;
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  accountId?: string;
  chatId: string;
  threadSpec?: TelegramThreadSpec;
  bot: Bot;
  telegramDeps: TelegramBotDeps;
  textLimit: number;
  replyToMode: ReplyToMode;
  silent?: boolean;
  deliverToTelegram: boolean;
}): Promise<{ text: string; delivered: boolean }> {
  const { onModelSelected, ...replyPipeline } = createChannelReplyPipeline({
    cfg: params.cfg,
    agentId: params.agentId,
    channel: "telegram",
    accountId: params.accountId,
  });

  const mediaLocalRoots = getAgentScopedMediaLocalRoots(params.cfg, params.agentId);
  const parts: string[] = [];
  let delivered = false;

  await params.telegramDeps.dispatchReplyWithBufferedBlockDispatcher({
    ctx: {
      Body: params.body,
      BodyForAgent: params.body,
      RawBody: params.body,
      SessionKey: params.sessionKey,
    },
    cfg: params.cfg,
    dispatcherOptions: {
      ...replyPipeline,
      deliver: async (payload, info) => {
        if (info.kind !== "final") {
          return;
        }
        if (typeof payload.text === "string" && payload.text.trim().length > 0) {
          parts.push(payload.text);
        }
        if (!params.deliverToTelegram) {
          return;
        }
        const result = await (params.telegramDeps.deliverReplies ?? deliverReplies)({
          replies: [payload],
          chatId: params.chatId,
          accountId: params.accountId,
          sessionKeyForInternalHooks: params.sessionKey,
          mirrorIsGroup: true,
          mirrorGroupId: params.chatId,
          bot: params.bot,
          runtime: params.runtime,
          mediaLocalRoots,
          replyToMode: params.replyToMode,
          textLimit: params.textLimit,
          thread: params.threadSpec,
          silent: params.silent,
          mediaLoader: params.telegramDeps.loadWebMedia,
        });
        delivered = delivered || result.delivered;
      },
      onSkip: () => undefined,
      onError: (err, info) => {
        params.runtime.error?.(
          danger(`telegram orchestrated ${params.agentId} ${info.kind} reply failed: ${String(err)}`),
        );
      },
    },
    replyOptions: {
      disableBlockStreaming: true,
      onModelSelected,
    },
  });

  return {
    text: parts.filter((part) => part.trim().length > 0).join("\n\n"),
    delivered,
  };
}

async function deliverTelegramText(params: {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  bot: Bot;
  telegramDeps: TelegramBotDeps;
  agentId: string;
  accountId?: string;
  sessionKey: string;
  chatId: string;
  threadSpec?: TelegramThreadSpec;
  replyToMode: ReplyToMode;
  textLimit: number;
  text: string;
  silent?: boolean;
}): Promise<boolean> {
  const mediaLocalRoots = getAgentScopedMediaLocalRoots(params.cfg, params.agentId);
  const result = await (params.telegramDeps.deliverReplies ?? deliverReplies)({
    replies: [{ text: params.text }],
    chatId: params.chatId,
    accountId: params.accountId,
    sessionKeyForInternalHooks: params.sessionKey,
    mirrorIsGroup: true,
    mirrorGroupId: params.chatId,
    bot: params.bot,
    runtime: params.runtime,
    mediaLocalRoots,
    replyToMode: params.replyToMode,
    textLimit: params.textLimit,
    thread: params.threadSpec,
    silent: params.silent,
    mediaLoader: params.telegramDeps.loadWebMedia,
  });
  return result.delivered;
}

async function tryHandleSecurityArchitectureEvidenceOrchestration(params: {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  bot: Bot;
  route: { agentId: string; accountId?: string };
  chatId: string;
  ctxPayload: {
    SessionKey?: string;
    RawBody?: string;
    Body?: string;
    BodyForAgent?: string;
  };
  threadSpec?: TelegramThreadSpec;
  telegramDeps: TelegramBotDeps;
  textLimit: number;
  replyToMode: ReplyToMode;
}): Promise<boolean> {
  const originalText = extractTelegramBodyText(params.ctxPayload).trim();
  if (
    !params.ctxPayload.SessionKey ||
    !shouldRunSecurityEvidenceOrchestration({
      agentId: params.route.agentId,
      text: originalText,
    })
  ) {
    return false;
  }

  const evidenceTarget = resolveSecurityEvidenceTopicBinding({
    cfg: params.cfg,
    chatId: params.chatId,
  });
  if (!evidenceTarget) {
    return false;
  }

  const evidenceBundle = await buildDeterministicSecurityEvidenceBundle({
    cfg: params.cfg,
    chatId: params.chatId,
    originalText,
  }).catch((err) => {
    params.runtime.error?.(danger(`telegram deterministic evidence collection failed: ${String(err)}`));
    return null;
  });
  if (!evidenceBundle) {
    await deliverTelegramText({
      cfg: params.cfg,
      runtime: params.runtime,
      bot: params.bot,
      telegramDeps: params.telegramDeps,
      agentId: SECURITY_ARCHITECTURE_AGENT_ID,
      accountId: params.route.accountId,
      sessionKey: params.ctxPayload.SessionKey,
      chatId: params.chatId,
      threadSpec: params.threadSpec,
      replyToMode: params.replyToMode,
      textLimit: params.textLimit,
      text: SECURITY_EVIDENCE_COLLECTION_FAILED,
    });
    return true;
  }

  await deliverTelegramText({
    cfg: params.cfg,
    runtime: params.runtime,
    bot: params.bot,
    telegramDeps: params.telegramDeps,
    agentId: SECURITY_EVIDENCE_AGENT_ID,
    accountId: evidenceTarget.accountId ?? params.route.accountId,
    sessionKey: evidenceTarget.sessionKey,
    chatId: params.chatId,
    threadSpec: evidenceTarget.threadSpec,
    replyToMode: "off",
    textLimit: params.textLimit,
    text: JSON.stringify(evidenceBundle, null, 2),
  });

  const finalArchitecturePrompt = [
    "Answer as the security-architecture agent.",
    "Use the evidence below to provide the final architecture judgment.",
    "Ground the answer in the evidence bundle and the known OpenClaw deployment context only.",
    "Do not invent controls, policies, MFA, encryption, authenticated URLs, or security gates that are not explicitly present in the evidence bundle.",
    "Do not suggest commands, tool calls, or file paths.",
    "Do not restate a fact as a stronger claim than it appears in the evidence bundle.",
    "Name the weakest trust boundary first.",
    "State clearly whether this is a sound target design or mostly layered mitigations.",
    "Keep the answer compact and specific to this deployment.",
    "Use this exact structure: Judgment, Evidence Used, Unknowns, Preferred Path.",
    `Original question:\n${originalText}`,
    `Evidence bundle:\n${JSON.stringify(evidenceBundle, null, 2)}`,
  ].join("\n\n");

  await runTelegramAgentTextPass({
    agentId: SECURITY_ARCHITECTURE_AGENT_ID,
    sessionKey: params.ctxPayload.SessionKey,
    body: finalArchitecturePrompt,
    cfg: params.cfg,
    runtime: params.runtime,
    accountId: params.route.accountId,
    chatId: params.chatId,
    threadSpec: params.threadSpec,
    bot: params.bot,
    telegramDeps: params.telegramDeps,
    textLimit: params.textLimit,
    replyToMode: params.replyToMode,
    deliverToTelegram: true,
  });

  return true;
}

function resolveTelegramReasoningLevel(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  agentId: string;
  telegramDeps: TelegramBotDeps;
}): TelegramReasoningLevel {
  const { cfg, sessionKey, agentId, telegramDeps } = params;
  if (!sessionKey) {
    return "off";
  }
  try {
    const storePath = telegramDeps.resolveStorePath(cfg.session?.store, { agentId });
    const store = (telegramDeps.loadSessionStore ?? loadSessionStore)(storePath, {
      skipCache: true,
    });
    const entry = resolveSessionStoreEntry({ store, sessionKey }).existing;
    const level = entry?.reasoningLevel;
    if (level === "on" || level === "stream") {
      return level;
    }
  } catch {
    // Fall through to default.
  }
  return "off";
}

export const dispatchTelegramMessage = async ({
  context,
  bot,
  cfg,
  runtime,
  replyToMode,
  streamMode,
  textLimit,
  telegramCfg,
  telegramDeps = defaultTelegramBotDeps,
  opts,
}: DispatchTelegramMessageParams) => {
  const {
    ctxPayload,
    msg,
    chatId,
    isGroup,
    groupConfig,
    threadSpec,
    historyKey,
    historyLimit,
    groupHistories,
    route,
    skillFilter,
    sendTyping,
    sendRecordVoice,
    ackReactionPromise,
    reactionApi,
    removeAckAfterReply,
    statusReactionController,
  } = context;

  const draftMaxChars = Math.min(textLimit, 4096);
  const tableMode = resolveMarkdownTableMode({
    cfg,
    channel: "telegram",
    accountId: route.accountId,
  });
  const renderDraftPreview = (text: string) => ({
    text: renderTelegramHtmlText(text, { tableMode }),
    parseMode: "HTML" as const,
  });
  const accountBlockStreamingEnabled =
    typeof telegramCfg.blockStreaming === "boolean"
      ? telegramCfg.blockStreaming
      : cfg.agents?.defaults?.blockStreamingDefault === "on";
  const resolvedReasoningLevel = resolveTelegramReasoningLevel({
    cfg,
    sessionKey: ctxPayload.SessionKey,
    agentId: route.agentId,
    telegramDeps,
  });
  const forceBlockStreamingForReasoning = resolvedReasoningLevel === "on";
  const streamReasoningDraft = resolvedReasoningLevel === "stream";
  const previewStreamingEnabled = streamMode !== "off";
  const canStreamAnswerDraft =
    previewStreamingEnabled && !accountBlockStreamingEnabled && !forceBlockStreamingForReasoning;
  const canStreamReasoningDraft = canStreamAnswerDraft || streamReasoningDraft;
  const draftReplyToMessageId =
    replyToMode !== "off" && typeof msg.message_id === "number" ? msg.message_id : undefined;
  const draftMinInitialChars = DRAFT_MIN_INITIAL_CHARS;
  // Keep DM preview lanes on real message transport. Native draft previews still
  // require a draft->message materialize hop, and that overlap keeps reintroducing
  // a visible duplicate flash at finalize time.
  const useMessagePreviewTransportForDm = threadSpec?.scope === "dm" && canStreamAnswerDraft;
  const mediaLocalRoots = getAgentScopedMediaLocalRoots(cfg, route.agentId);
  const archivedAnswerPreviews: ArchivedPreview[] = [];
  const archivedReasoningPreviewIds: number[] = [];
  const createDraftLane = (laneName: LaneName, enabled: boolean): DraftLaneState => {
    const stream = enabled
      ? (telegramDeps.createTelegramDraftStream ?? createTelegramDraftStream)({
          api: bot.api,
          chatId,
          maxChars: draftMaxChars,
          thread: threadSpec,
          previewTransport: useMessagePreviewTransportForDm ? "message" : "auto",
          replyToMessageId: draftReplyToMessageId,
          minInitialChars: draftMinInitialChars,
          renderText: renderDraftPreview,
          onSupersededPreview:
            laneName === "answer" || laneName === "reasoning"
              ? (preview) => {
                  if (laneName === "reasoning") {
                    if (!archivedReasoningPreviewIds.includes(preview.messageId)) {
                      archivedReasoningPreviewIds.push(preview.messageId);
                    }
                    return;
                  }
                  archivedAnswerPreviews.push({
                    messageId: preview.messageId,
                    textSnapshot: preview.textSnapshot,
                    deleteIfUnused: true,
                  });
                }
              : undefined,
          log: logVerbose,
          warn: logVerbose,
        })
      : undefined;
    return {
      stream,
      lastPartialText: "",
      hasStreamedMessage: false,
    };
  };
  const lanes: Record<LaneName, DraftLaneState> = {
    answer: createDraftLane("answer", canStreamAnswerDraft),
    reasoning: createDraftLane("reasoning", canStreamReasoningDraft),
  };
  // Active preview lifecycle answers "can this current preview still be
  // finalized?" Cleanup retention is separate so archived-preview decisions do
  // not poison the active lane.
  const activePreviewLifecycleByLane: Record<LaneName, LanePreviewLifecycle> = {
    answer: "transient",
    reasoning: "transient",
  };
  const retainPreviewOnCleanupByLane: Record<LaneName, boolean> = {
    answer: false,
    reasoning: false,
  };
  const answerLane = lanes.answer;
  const reasoningLane = lanes.reasoning;
  let splitReasoningOnNextStream = false;
  let skipNextAnswerMessageStartRotation = false;
  let draftLaneEventQueue = Promise.resolve();
  const reasoningStepState = createTelegramReasoningStepState();
  const enqueueDraftLaneEvent = (task: () => Promise<void>): Promise<void> => {
    const next = draftLaneEventQueue.then(task);
    draftLaneEventQueue = next.catch((err) => {
      logVerbose(`telegram: draft lane callback failed: ${String(err)}`);
    });
    return draftLaneEventQueue;
  };
  type SplitLaneSegment = { lane: LaneName; text: string };
  type SplitLaneSegmentsResult = {
    segments: SplitLaneSegment[];
    suppressedReasoningOnly: boolean;
  };
  const splitTextIntoLaneSegments = (text?: string): SplitLaneSegmentsResult => {
    const split = splitTelegramReasoningText(text);
    const segments: SplitLaneSegment[] = [];
    const suppressReasoning = resolvedReasoningLevel === "off";
    if (split.reasoningText && !suppressReasoning) {
      segments.push({ lane: "reasoning", text: split.reasoningText });
    }
    if (split.answerText) {
      segments.push({ lane: "answer", text: split.answerText });
    }
    return {
      segments,
      suppressedReasoningOnly:
        Boolean(split.reasoningText) && suppressReasoning && !split.answerText,
    };
  };
  const resetDraftLaneState = (lane: DraftLaneState) => {
    lane.lastPartialText = "";
    lane.hasStreamedMessage = false;
  };
  const rotateAnswerLaneForNewAssistantMessage = async () => {
    let didForceNewMessage = false;
    if (answerLane.hasStreamedMessage) {
      // Materialize the current streamed draft into a permanent message
      // so it remains visible across tool boundaries.
      const materializedId = await answerLane.stream?.materialize?.();
      const previewMessageId = materializedId ?? answerLane.stream?.messageId();
      if (
        typeof previewMessageId === "number" &&
        activePreviewLifecycleByLane.answer === "transient"
      ) {
        archivedAnswerPreviews.push({
          messageId: previewMessageId,
          textSnapshot: answerLane.lastPartialText,
          deleteIfUnused: false,
        });
      }
      answerLane.stream?.forceNewMessage();
      didForceNewMessage = true;
    }
    resetDraftLaneState(answerLane);
    if (didForceNewMessage) {
      // New assistant message boundary: this lane now tracks a fresh preview lifecycle.
      activePreviewLifecycleByLane.answer = "transient";
      retainPreviewOnCleanupByLane.answer = false;
    }
    return didForceNewMessage;
  };
  const updateDraftFromPartial = (lane: DraftLaneState, text: string | undefined) => {
    const laneStream = lane.stream;
    if (!laneStream || !text) {
      return;
    }
    if (text === lane.lastPartialText) {
      return;
    }
    // Mark that we've received streaming content (for forceNewMessage decision).
    lane.hasStreamedMessage = true;
    // Some providers briefly emit a shorter prefix snapshot (for example
    // "Sure." -> "Sure" -> "Sure."). Keep the longer preview to avoid
    // visible punctuation flicker.
    if (
      lane.lastPartialText &&
      lane.lastPartialText.startsWith(text) &&
      text.length < lane.lastPartialText.length
    ) {
      return;
    }
    lane.lastPartialText = text;
    laneStream.update(text);
  };
  const ingestDraftLaneSegments = async (text: string | undefined) => {
    const split = splitTextIntoLaneSegments(text);
    const hasAnswerSegment = split.segments.some((segment) => segment.lane === "answer");
    if (hasAnswerSegment && activePreviewLifecycleByLane.answer !== "transient") {
      // Some providers can emit the first partial of a new assistant message before
      // onAssistantMessageStart() arrives. Rotate preemptively so we do not edit
      // the previously finalized preview message with the next message's text.
      skipNextAnswerMessageStartRotation = await rotateAnswerLaneForNewAssistantMessage();
    }
    for (const segment of split.segments) {
      if (segment.lane === "reasoning") {
        reasoningStepState.noteReasoningHint();
        reasoningStepState.noteReasoningDelivered();
      }
      updateDraftFromPartial(lanes[segment.lane], segment.text);
    }
  };
  const flushDraftLane = async (lane: DraftLaneState) => {
    if (!lane.stream) {
      return;
    }
    await lane.stream.flush();
  };

  const disableBlockStreaming = !previewStreamingEnabled
    ? true
    : forceBlockStreamingForReasoning
      ? false
      : typeof telegramCfg.blockStreaming === "boolean"
        ? !telegramCfg.blockStreaming
        : canStreamAnswerDraft
          ? true
          : undefined;

  const chunkMode = resolveChunkMode(cfg, "telegram", route.accountId);

  // Handle uncached stickers: get a dedicated vision description before dispatch
  // This ensures we cache a raw description rather than a conversational response
  const sticker = ctxPayload.Sticker;
  if (sticker?.fileId && sticker.fileUniqueId && ctxPayload.MediaPath) {
    const agentDir = resolveAgentDir(cfg, route.agentId);
    const stickerSupportsVision = await resolveStickerVisionSupport(cfg, route.agentId);
    let description = sticker.cachedDescription ?? null;
    if (!description) {
      description = await describeStickerImage({
        imagePath: ctxPayload.MediaPath,
        cfg,
        agentDir,
        agentId: route.agentId,
      });
    }
    if (description) {
      // Format the description with sticker context
      const stickerContext = [sticker.emoji, sticker.setName ? `from "${sticker.setName}"` : null]
        .filter(Boolean)
        .join(" ");
      const formattedDesc = `[Sticker${stickerContext ? ` ${stickerContext}` : ""}] ${description}`;

      sticker.cachedDescription = description;
      if (!stickerSupportsVision) {
        // Update context to use description instead of image
        ctxPayload.Body = formattedDesc;
        ctxPayload.BodyForAgent = formattedDesc;
        // Drop only the sticker attachment; keep replied media context if present.
        pruneStickerMediaFromContext(ctxPayload, {
          stickerMediaIncluded: ctxPayload.StickerMediaIncluded,
        });
      }

      // Cache the description for future encounters
      if (sticker.fileId) {
        cacheSticker({
          fileId: sticker.fileId,
          fileUniqueId: sticker.fileUniqueId,
          emoji: sticker.emoji,
          setName: sticker.setName,
          description,
          cachedAt: new Date().toISOString(),
          receivedFrom: ctxPayload.From,
        });
        logVerbose(`telegram: cached sticker description for ${sticker.fileUniqueId}`);
      } else {
        logVerbose(`telegram: skipped sticker cache (missing fileId)`);
      }
    }
  }

  const replyQuoteText =
    ctxPayload.ReplyToIsQuote && ctxPayload.ReplyToBody
      ? ctxPayload.ReplyToBody.trim() || undefined
      : undefined;
  const deliveryState = createLaneDeliveryStateTracker();
  const clearGroupHistory = () => {
    if (isGroup && historyKey) {
      clearHistoryEntriesIfEnabled({ historyMap: groupHistories, historyKey, limit: historyLimit });
    }
  };
  const deliveryBaseOptions = {
    chatId: String(chatId),
    accountId: route.accountId,
    sessionKeyForInternalHooks: ctxPayload.SessionKey,
    mirrorIsGroup: isGroup,
    mirrorGroupId: isGroup ? String(chatId) : undefined,
    token: opts.token,
    runtime,
    bot,
    mediaLocalRoots,
    replyToMode,
    textLimit,
    thread: threadSpec,
    tableMode,
    chunkMode,
    linkPreview: telegramCfg.linkPreview,
    replyQuoteText,
  };
  if (
    await tryHandleSecurityArchitectureEvidenceOrchestration({
      cfg,
      runtime,
      bot,
      route,
      chatId: String(chatId),
      ctxPayload,
      threadSpec,
      telegramDeps,
      textLimit,
      replyToMode,
    })
  ) {
    clearGroupHistory();
    return;
  }
  if (
    await tryHandleForcedHostControlScreenshotTelegram({
      cfg,
      runtime,
      isGroup,
      chatId,
      msg: {
        message_id: msg.message_id,
        text: (msg as { text?: unknown }).text,
        caption: (msg as { caption?: unknown }).caption,
      },
      ctxPayload,
      deliveryBaseOptions,
      statusReactionController,
      sendTyping,
      clearGroupHistory,
      removeAckAfterReply,
      ackReactionPromise,
      reactionApi,
    })
  ) {
    return;
  }
  if (
    await tryHandleForcedHostControlReadTelegram({
      cfg,
      runtime,
      isGroup,
      chatId,
      msg: {
        message_id: msg.message_id,
        text: (msg as { text?: unknown }).text,
        caption: (msg as { caption?: unknown }).caption,
      },
      ctxPayload,
      deliveryBaseOptions,
      statusReactionController,
      sendTyping,
      clearGroupHistory,
      removeAckAfterReply,
      ackReactionPromise,
      reactionApi,
    })
  ) {
    return;
  }
  const silentErrorReplies = telegramCfg.silentErrorReplies === true;
  const applyTextToPayload = (payload: ReplyPayload, text: string): ReplyPayload => {
    if (payload.text === text) {
      return payload;
    }
    return { ...payload, text };
  };
  const sendPayload = async (payload: ReplyPayload) => {
    const result = await (telegramDeps.deliverReplies ?? deliverReplies)({
      ...deliveryBaseOptions,
      replies: [payload],
      onVoiceRecording: sendRecordVoice,
      silent: silentErrorReplies && payload.isError === true,
      mediaLoader: telegramDeps.loadWebMedia,
    });
    if (result.delivered) {
      deliveryState.markDelivered();
    }
    return result.delivered;
  };
  const emitPreviewFinalizedHook = (result: LaneDeliveryResult) => {
    if (result.kind !== "preview-finalized") {
      return;
    }
    (telegramDeps.emitInternalMessageSentHook ?? emitInternalMessageSentHook)({
      sessionKeyForInternalHooks: deliveryBaseOptions.sessionKeyForInternalHooks,
      chatId: deliveryBaseOptions.chatId,
      accountId: deliveryBaseOptions.accountId,
      content: result.delivery.content,
      success: true,
      messageId: result.delivery.messageId,
      isGroup: deliveryBaseOptions.mirrorIsGroup,
      groupId: deliveryBaseOptions.mirrorGroupId,
    });
  };
  const deliverLaneText = createLaneTextDeliverer({
    lanes,
    archivedAnswerPreviews,
    activePreviewLifecycleByLane,
    retainPreviewOnCleanupByLane,
    draftMaxChars,
    applyTextToPayload,
    sendPayload,
    flushDraftLane,
    stopDraftLane: async (lane) => {
      await lane.stream?.stop();
    },
    editPreview: async ({ messageId, text, previewButtons }) => {
      await (telegramDeps.editMessageTelegram ?? editMessageTelegram)(chatId, messageId, text, {
        api: bot.api,
        cfg,
        accountId: route.accountId,
        linkPreview: telegramCfg.linkPreview,
        buttons: previewButtons,
      });
    },
    deletePreviewMessage: async (messageId) => {
      await bot.api.deleteMessage(chatId, messageId);
    },
    log: logVerbose,
    markDelivered: () => {
      deliveryState.markDelivered();
    },
  });

  let queuedFinal = false;
  let deliveredFinalReply = false;
  let hadErrorReplyFailureOrSkip = false;
  let sawSuppressedExecApprovalPrompt = false;

  // Determine if this is the first turn in session (for auto-topic-label).
  const isDmTopic = !isGroup && threadSpec.scope === "dm" && threadSpec.id != null;

  let isFirstTurnInSession = false;
  if (isDmTopic) {
    try {
      const storePath = telegramDeps.resolveStorePath(cfg.session?.store, {
        agentId: route.agentId,
      });
      const store = (telegramDeps.loadSessionStore ?? loadSessionStore)(storePath, {
        skipCache: true,
      });
      const sessionKey = ctxPayload.SessionKey;
      if (sessionKey) {
        const entry = resolveSessionStoreEntry({ store, sessionKey }).existing;
        isFirstTurnInSession = !entry?.systemSent;
      } else {
        logVerbose("auto-topic-label: SessionKey is absent, skipping first-turn detection");
      }
    } catch (err) {
      logVerbose(
        `auto-topic-label: session store error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (statusReactionController) {
    void statusReactionController.setThinking();
  }

  const { onModelSelected, ...replyPipeline } = createChannelReplyPipeline({
    cfg,
    agentId: route.agentId,
    channel: "telegram",
    accountId: route.accountId,
    typing: {
      start: sendTyping,
      onStartError: (err) => {
        logTypingFailure({
          log: logVerbose,
          channel: "telegram",
          target: String(chatId),
          error: err,
        });
      },
    },
  });

  let dispatchError: unknown;
  try {
    ({ queuedFinal } = await telegramDeps.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        ...replyPipeline,
        deliver: async (payload, info) => {
          if (payload.isError === true) {
            hadErrorReplyFailureOrSkip = true;
          }
          if (info.kind === "final") {
            // Assistant callbacks are fire-and-forget; ensure queued boundary
            // rotations/partials are applied before final delivery mapping.
            await enqueueDraftLaneEvent(async () => {});
          }
          if (
            shouldSuppressLocalTelegramExecApprovalPrompt({
              cfg,
              accountId: route.accountId,
              to: String(chatId),
              payload,
            })
          ) {
            sawSuppressedExecApprovalPrompt = true;
            queuedFinal = true;
            return;
          }
          if (
            sawSuppressedExecApprovalPrompt &&
            looksLikeTelegramExecApprovalFallbackText(payload.text ?? "")
          ) {
            queuedFinal = true;
            return;
          }
          const previewButtons = (
            payload.channelData?.telegram as { buttons?: TelegramInlineButtons } | undefined
          )?.buttons;
          const split = splitTextIntoLaneSegments(payload.text);
          const segments = split.segments;
          const reply = resolveSendableOutboundReplyParts(payload);
          const hasMedia = reply.hasMedia;

          const flushBufferedFinalAnswer = async () => {
            const buffered = reasoningStepState.takeBufferedFinalAnswer();
            if (!buffered) {
              return;
            }
            const bufferedButtons = (
              buffered.payload.channelData?.telegram as
                | { buttons?: TelegramInlineButtons }
                | undefined
            )?.buttons;
            await deliverLaneText({
              laneName: "answer",
              text: buffered.text,
              payload: buffered.payload,
              infoKind: "final",
              previewButtons: bufferedButtons,
            });
            reasoningStepState.resetForNextStep();
          };

          for (const segment of segments) {
            if (
              segment.lane === "answer" &&
              info.kind === "final" &&
              reasoningStepState.shouldBufferFinalAnswer()
            ) {
              reasoningStepState.bufferFinalAnswer({
                payload,
                text: segment.text,
              });
              continue;
            }
            if (segment.lane === "reasoning") {
              reasoningStepState.noteReasoningHint();
            }
            const result = await deliverLaneText({
              laneName: segment.lane,
              text: segment.text,
              payload,
              infoKind: info.kind,
              previewButtons,
              allowPreviewUpdateForNonFinal: segment.lane === "reasoning",
            });
            if (info.kind === "final" && result.kind !== "skipped") {
              emitPreviewFinalizedHook(result);
              deliveredFinalReply = true;
            }
            if (segment.lane === "reasoning") {
              if (result.kind !== "skipped") {
                reasoningStepState.noteReasoningDelivered();
                await flushBufferedFinalAnswer();
              }
              continue;
            }
            if (info.kind === "final") {
              if (reasoningLane.hasStreamedMessage) {
                activePreviewLifecycleByLane.reasoning = "complete";
                retainPreviewOnCleanupByLane.reasoning = true;
              }
              reasoningStepState.resetForNextStep();
            }
          }
          if (segments.length > 0) {
            return;
          }
          if (split.suppressedReasoningOnly) {
            if (reply.hasMedia) {
              const payloadWithoutSuppressedReasoning =
                typeof payload.text === "string" ? { ...payload, text: "" } : payload;
              const delivered = await sendPayload(payloadWithoutSuppressedReasoning);
              if (info.kind === "final" && delivered) {
                deliveredFinalReply = true;
              }
            }
            if (info.kind === "final") {
              await flushBufferedFinalAnswer();
            }
            return;
          }

          if (info.kind === "final") {
            await answerLane.stream?.stop();
            await reasoningLane.stream?.stop();
            reasoningStepState.resetForNextStep();
          }
          const canSendAsIs = reply.hasMedia || reply.text.length > 0;
          if (!canSendAsIs) {
            if (info.kind === "final") {
              await flushBufferedFinalAnswer();
            }
            return;
          }
          const delivered = await sendPayload(payload);
          if (info.kind === "final" && delivered) {
            deliveredFinalReply = true;
          }
          if (info.kind === "final") {
            await flushBufferedFinalAnswer();
          }
        },
        onSkip: (payload, info) => {
          if (payload.isError === true) {
            hadErrorReplyFailureOrSkip = true;
          }
          if (info.reason !== "silent") {
            deliveryState.markNonSilentSkip();
          }
        },
        onError: (err, info) => {
          deliveryState.markNonSilentFailure();
          runtime.error?.(danger(`telegram ${info.kind} reply failed: ${String(err)}`));
        },
      },
      replyOptions: {
        skillFilter,
        disableBlockStreaming,
        onPartialReply:
          answerLane.stream || reasoningLane.stream
            ? (payload) =>
                enqueueDraftLaneEvent(async () => {
                  await ingestDraftLaneSegments(payload.text);
                })
            : undefined,
        onReasoningStream: reasoningLane.stream
          ? (payload) =>
              enqueueDraftLaneEvent(async () => {
                // Split between reasoning blocks only when the next reasoning
                // stream starts. Splitting at reasoning-end can orphan the active
                // preview and cause duplicate reasoning sends on reasoning final.
                if (splitReasoningOnNextStream) {
                  reasoningLane.stream?.forceNewMessage();
                  resetDraftLaneState(reasoningLane);
                  splitReasoningOnNextStream = false;
                }
                await ingestDraftLaneSegments(payload.text);
              })
          : undefined,
        onAssistantMessageStart: answerLane.stream
          ? () =>
              enqueueDraftLaneEvent(async () => {
                reasoningStepState.resetForNextStep();
                if (skipNextAnswerMessageStartRotation) {
                  skipNextAnswerMessageStartRotation = false;
                  activePreviewLifecycleByLane.answer = "transient";
                  retainPreviewOnCleanupByLane.answer = false;
                  return;
                }
                await rotateAnswerLaneForNewAssistantMessage();
                // Message-start is an explicit assistant-message boundary.
                // Even when no forceNewMessage happened (e.g. prior answer had no
                // streamed partials), the next partial belongs to a fresh lifecycle
                // and must not trigger late pre-rotation mid-message.
                activePreviewLifecycleByLane.answer = "transient";
                retainPreviewOnCleanupByLane.answer = false;
              })
          : undefined,
        onReasoningEnd: reasoningLane.stream
          ? () =>
              enqueueDraftLaneEvent(async () => {
                // Split when/if a later reasoning block begins.
                splitReasoningOnNextStream = reasoningLane.hasStreamedMessage;
              })
          : undefined,
        onToolStart: statusReactionController
          ? async (payload) => {
              await statusReactionController.setTool(payload.name);
            }
          : undefined,
        onCompactionStart: statusReactionController
          ? () => statusReactionController.setCompacting()
          : undefined,
        onCompactionEnd: statusReactionController
          ? async () => {
              statusReactionController.cancelPending();
              await statusReactionController.setThinking();
            }
          : undefined,
        onModelSelected,
      },
    }));
  } catch (err) {
    dispatchError = err;
    runtime.error?.(danger(`telegram dispatch failed: ${String(err)}`));
  } finally {
    // Upstream assistant callbacks are fire-and-forget; drain queued lane work
    // before stream cleanup so boundary rotations/materialization complete first.
    await draftLaneEventQueue;
    // Must stop() first to flush debounced content before clear() wipes state.
    const streamCleanupStates = new Map<
      NonNullable<DraftLaneState["stream"]>,
      { shouldClear: boolean }
    >();
    const lanesToCleanup: Array<{ laneName: LaneName; lane: DraftLaneState }> = [
      { laneName: "answer", lane: answerLane },
      { laneName: "reasoning", lane: reasoningLane },
    ];
    for (const laneState of lanesToCleanup) {
      const stream = laneState.lane.stream;
      if (!stream) {
        continue;
      }
      // Don't clear (delete) the stream if: (a) it was finalized, or
      // (b) the active stream message is itself a boundary-finalized archive.
      const activePreviewMessageId = stream.messageId();
      const hasBoundaryFinalizedActivePreview =
        laneState.laneName === "answer" &&
        typeof activePreviewMessageId === "number" &&
        archivedAnswerPreviews.some(
          (p) => p.deleteIfUnused === false && p.messageId === activePreviewMessageId,
        );
      const shouldClear =
        !retainPreviewOnCleanupByLane[laneState.laneName] && !hasBoundaryFinalizedActivePreview;
      const existing = streamCleanupStates.get(stream);
      if (!existing) {
        streamCleanupStates.set(stream, { shouldClear });
        continue;
      }
      existing.shouldClear = existing.shouldClear && shouldClear;
    }
    for (const [stream, cleanupState] of streamCleanupStates) {
      await stream.stop();
      if (cleanupState.shouldClear) {
        await stream.clear();
      }
    }
    for (const archivedPreview of archivedAnswerPreviews) {
      if (archivedPreview.deleteIfUnused === false) {
        continue;
      }
      try {
        await bot.api.deleteMessage(chatId, archivedPreview.messageId);
      } catch (err) {
        logVerbose(
          `telegram: archived answer preview cleanup failed (${archivedPreview.messageId}): ${String(err)}`,
        );
      }
    }
    for (const messageId of archivedReasoningPreviewIds) {
      try {
        await bot.api.deleteMessage(chatId, messageId);
      } catch (err) {
        logVerbose(
          `telegram: archived reasoning preview cleanup failed (${messageId}): ${String(err)}`,
        );
      }
    }
  }
  let sentFallback = false;
  const deliverySummary = deliveryState.snapshot();
  const partialAnswerFallbackText = answerLane.lastPartialText.trim();
  if (
    dispatchError ||
    (!deliveredFinalReply &&
      (deliverySummary.skippedNonSilent > 0 || deliverySummary.failedNonSilent > 0))
  ) {
    const fallbackText = dispatchError
      ? "Something went wrong while processing your request. Please try again."
      : EMPTY_RESPONSE_FALLBACK;
    const result = await (telegramDeps.deliverReplies ?? deliverReplies)({
      replies: [{ text: fallbackText }],
      ...deliveryBaseOptions,
      silent: silentErrorReplies && (dispatchError != null || hadErrorReplyFailureOrSkip),
      mediaLoader: telegramDeps.loadWebMedia,
    });
    sentFallback = result.delivered;
  } else if (!deliveredFinalReply && partialAnswerFallbackText) {
    const result = await deliverReplies({
      replies: [{ text: partialAnswerFallbackText }],
      ...deliveryBaseOptions,
    });
    sentFallback = result.delivered;
  }

  const hasFinalResponse = queuedFinal || deliveredFinalReply || sentFallback;

  if (statusReactionController && !hasFinalResponse) {
    void statusReactionController.setError().catch((err) => {
      logVerbose(`telegram: status reaction error finalize failed: ${String(err)}`);
    });
  }

  if (!hasFinalResponse) {
    clearGroupHistory();
    return;
  }

  // Fire-and-forget: auto-rename DM topic on first message.
  if (isDmTopic && isFirstTurnInSession) {
    const userMessage = (ctxPayload.RawBody ?? ctxPayload.Body ?? "").slice(0, 500);
    if (userMessage.trim()) {
      const agentDir = resolveAgentDir(cfg, route.agentId);
      const directConfig = !isGroup ? (groupConfig as TelegramDirectConfig | undefined) : undefined;
      const directAutoTopicLabel = directConfig?.autoTopicLabel;
      const accountAutoTopicLabel = telegramCfg?.autoTopicLabel;
      const autoTopicConfig = resolveAutoTopicLabelConfig(
        directAutoTopicLabel,
        accountAutoTopicLabel,
      );
      if (autoTopicConfig) {
        const topicThreadId = threadSpec.id!;
        void (async () => {
          try {
            const label = await generateTopicLabel({
              userMessage,
              prompt: autoTopicConfig.prompt,
              cfg,
              agentId: route.agentId,
              agentDir,
            });
            if (!label) {
              logVerbose("auto-topic-label: LLM returned empty label");
              return;
            }
            logVerbose(`auto-topic-label: generated label (len=${label.length})`);
            await bot.api.editForumTopic(chatId, topicThreadId, { name: label });
            logVerbose(`auto-topic-label: renamed topic ${chatId}/${topicThreadId}`);
          } catch (err) {
            logVerbose(
              `auto-topic-label: failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        })();
      }
    }
  }

  if (statusReactionController) {
    void statusReactionController.setDone().catch((err) => {
      logVerbose(`telegram: status reaction finalize failed: ${String(err)}`);
    });
  } else {
    removeAckReactionAfterReply({
      removeAfterReply: removeAckAfterReply,
      ackReactionPromise,
      ackReactionValue: ackReactionPromise ? "ack" : null,
      remove: () => reactionApi?.(chatId, msg.message_id ?? 0, []) ?? Promise.resolve(),
      onError: (err) => {
        if (!msg.message_id) {
          return;
        }
        logAckFailure({
          log: logVerbose,
          channel: "telegram",
          target: `${chatId}/${msg.message_id}`,
          error: err,
        });
      },
    });
  }
  clearGroupHistory();
};
