import {
  logAckFailure,
  removeAckReactionAfterReply,
} from "openclaw/plugin-sdk/channel-feedback";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { danger, logVerbose } from "openclaw/plugin-sdk/runtime-env";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { deliverReplies } from "./bot/delivery.js";

const DEFAULT_PC_CONTROL_AUTH_TOKEN_ENV = "PC_CONTROL_BRIDGE_TOKEN";
const DEFAULT_PC_CONTROL_TIMEOUT_MS = 10_000;
const DEFAULT_PC_CONTROL_OPERATION_TIMEOUTS_MS: Record<string, number> = {
  "display.screenshot": 20_000,
};

type PcControlTelegramConfig = {
  bridgeUrl: string;
  authTokenEnv: string;
  authToken: string;
  timeoutMs: number;
  operationTimeoutsMs: Record<string, number>;
  sharedPathMap?: { from: string; to: string };
  allowExportOperations: boolean;
};

function toPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function toOperationTimeouts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) {
      output[key] = entry;
    }
  }
  return output;
}

function toPcControlSharedPathMap(value: unknown): { from: string; to: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const from = typeof value.from === "string" ? value.from.trim().replace(/\/+$/, "") : "";
  const to = typeof value.to === "string" ? value.to.trim().replace(/\/+$/, "") : "";
  if (!from || !to) {
    return undefined;
  }
  return { from, to };
}

function resolvePcControlTelegramConfig(cfg: OpenClawConfig): PcControlTelegramConfig | null {
  const pluginEntry = cfg.plugins?.entries?.["pc-control"];
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
      : DEFAULT_PC_CONTROL_AUTH_TOKEN_ENV;
  const authToken = process.env[authTokenEnv]?.trim() ?? "";
  return {
    bridgeUrl: bridgeUrl.replace(/\/+$/, ""),
    authTokenEnv,
    authToken,
    timeoutMs: toPositiveNumber(pluginCfg.timeoutMs, DEFAULT_PC_CONTROL_TIMEOUT_MS),
    operationTimeoutsMs: {
      ...DEFAULT_PC_CONTROL_OPERATION_TIMEOUTS_MS,
      ...toOperationTimeouts(pluginCfg.operationTimeoutsMs),
    },
    sharedPathMap: toPcControlSharedPathMap(pluginCfg.sharedPathMap),
    allowExportOperations: pluginCfg.allowExportOperations !== false,
  };
}

function remapPcControlSharedPath(
  sharedPathMap: PcControlTelegramConfig["sharedPathMap"],
  value: string,
): string {
  const raw = value.trim();
  if (!raw || !sharedPathMap) {
    return raw;
  }
  if (raw === sharedPathMap.from || raw.startsWith(`${sharedPathMap.from}/`)) {
    return `${sharedPathMap.to}${raw.slice(sharedPathMap.from.length)}`;
  }
  return raw;
}

function matchesForcedDesktopScreenshotIntent(text: string | undefined): boolean {
  const normalized = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) {
    return false;
  }
  const mentionsDesktopTarget =
    /\b(desktop|pc|computer|screen|display|monitor|host)\b/.test(normalized) ||
    /\bcurrent tab\b/.test(normalized);
  const screenshotVerb =
    /\b(screenshot|screen ?shot|screen ?capture|capture (?:my )?screen|capture (?:my )?desktop)\b/.test(
      normalized,
    ) || /\bss\b/.test(normalized);
  if (!screenshotVerb) {
    return false;
  }
  if (!mentionsDesktopTarget && !/\bss\b/.test(normalized)) {
    return false;
  }
  return /\b(send|take|capture|get|show)\b/.test(normalized) || screenshotVerb;
}

function resolveTelegramScreenshotIntentText(params: {
  ctxPayload: { BodyForAgent?: unknown; Body?: unknown; RawBody?: unknown };
  msg: { text?: unknown; caption?: unknown };
}): string {
  const candidates = [
    params.ctxPayload.BodyForAgent,
    params.ctxPayload.Body,
    params.ctxPayload.RawBody,
    params.msg.text,
    params.msg.caption,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

async function callPcControlBridgeDirect(
  config: PcControlTelegramConfig,
  payload: Record<string, unknown>,
) {
  if (!config.authToken) {
    throw new Error(`Missing bridge auth token env: ${config.authTokenEnv}`);
  }
  const controller = new AbortController();
  const operation =
    typeof payload.operation === "string" && payload.operation.trim() ? payload.operation : "";
  const timeoutMs =
    (operation && config.operationTimeoutsMs?.[operation]) || config.timeoutMs || DEFAULT_PC_CONTROL_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.bridgeUrl}/v1/bridge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.authToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok !== true) {
      const message = json?.error?.message || `Bridge request failed with status ${response.status}`;
      throw new Error(message);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

type ForcedScreenshotParams = {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  isGroup: boolean;
  chatId: string | number;
  msg: { message_id?: number; text?: unknown; caption?: unknown };
  ctxPayload: {
    BodyForAgent?: unknown;
    Body?: unknown;
    RawBody?: unknown;
    SessionKey?: unknown;
    From?: unknown;
  };
  deliveryBaseOptions: Record<string, unknown>;
  statusReactionController?: {
    setDone(): Promise<void>;
    setError(): Promise<void>;
  } | null;
  sendTyping(): Promise<void>;
  clearGroupHistory(): void;
  removeAckAfterReply: boolean;
  ackReactionPromise?: Promise<unknown> | null;
  reactionApi?: ((chatId: string | number, messageId: number, reactions: unknown[]) => Promise<unknown>) | null;
};

export async function tryHandleForcedPcControlScreenshotTelegram(
  params: ForcedScreenshotParams,
): Promise<boolean> {
  const {
    cfg,
    runtime,
    isGroup,
    chatId,
    msg,
    ctxPayload,
    deliveryBaseOptions,
    statusReactionController,
    sendTyping,
    clearGroupHistory,
    removeAckAfterReply,
    ackReactionPromise,
    reactionApi,
  } = params;
  const forcedScreenshotIntent =
    !isGroup &&
    matchesForcedDesktopScreenshotIntent(
      resolveTelegramScreenshotIntentText({
        ctxPayload,
        msg: {
          text: msg.text,
          caption: msg.caption,
        },
      }),
    );
  if (!forcedScreenshotIntent) {
    return false;
  }
  const pcControlConfig = resolvePcControlTelegramConfig(cfg);
  if (!pcControlConfig || !pcControlConfig.allowExportOperations) {
    const result = await deliverReplies({
      ...deliveryBaseOptions,
      replies: [
        {
          text: "Host screenshot capture is not available right now because pc-control export is not enabled.",
          isError: true,
        } satisfies ReplyPayload,
      ],
    });
    if (result.delivered && statusReactionController) {
      void statusReactionController.setDone().catch((err) => {
        logVerbose(`telegram: status reaction finalize failed: ${String(err)}`);
      });
    }
    clearGroupHistory();
    return true;
  }
  try {
    await sendTyping();
  } catch {
    // Ignore typing failures and continue with direct delivery.
  }
  try {
    const directResult = await callPcControlBridgeDirect(pcControlConfig, {
      request_id: `telegram-screenshot-${Date.now()}`,
      operation: "display.screenshot",
      arguments: {},
      actor: {
        channel: "telegram",
        session_key: ctxPayload.SessionKey ?? null,
        sender_id: ctxPayload.From ?? null,
      },
    });
    const rawPaths: string[] = [];
    if (Array.isArray(directResult?.result?.paths)) {
      for (const value of directResult.result.paths) {
        if (typeof value === "string" && value.trim()) {
          rawPaths.push(value.trim());
        }
      }
    }
    if (Array.isArray(directResult?.result?.displays)) {
      for (const display of directResult.result.displays) {
        if (typeof display?.path === "string" && display.path.trim()) {
          rawPaths.push(display.path.trim());
        }
      }
    }
    if (typeof directResult?.result?.path === "string" && directResult.result.path.trim()) {
      rawPaths.unshift(directResult.result.path.trim());
    }
    const mediaPaths = [
      ...new Set(
        rawPaths
          .map((value) => remapPcControlSharedPath(pcControlConfig.sharedPathMap, value))
          .filter(Boolean),
      ),
    ];
    if (mediaPaths.length === 0) {
      throw new Error("pc-control screenshot capture returned no media path");
    }
    const result = await deliverReplies({
      ...deliveryBaseOptions,
      replies: [
        mediaPaths.length === 1
          ? { mediaUrl: mediaPaths[0], channelData: { telegram: { forceDocument: true } } }
          : { mediaUrls: mediaPaths, channelData: { telegram: { forceDocument: true } } },
      ],
    });
    if (!result.delivered) {
      throw new Error("Telegram screenshot delivery was not accepted");
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
    return true;
  } catch (err) {
    runtime.error?.(danger(`telegram forced screenshot dispatch failed: ${String(err)}`));
    const result = await deliverReplies({
      ...deliveryBaseOptions,
      replies: [
        {
          text: "I couldn't capture and send the host desktop screenshot right now.",
          isError: true,
        } satisfies ReplyPayload,
      ],
    });
    if (result.delivered && statusReactionController) {
      void statusReactionController.setError().catch((reactionErr) => {
        logVerbose(`telegram: status reaction error finalize failed: ${String(reactionErr)}`);
      });
    }
    clearGroupHistory();
    return true;
  }
}
