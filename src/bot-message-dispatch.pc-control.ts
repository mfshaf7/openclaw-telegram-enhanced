import {
  logAckFailure,
  removeAckReactionAfterReply,
} from "openclaw/plugin-sdk/channel-feedback";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { danger, logVerbose } from "openclaw/plugin-sdk/runtime-env";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { deliverReplies } from "./bot/delivery.js";

const DEFAULT_PC_CONTROL_AUTH_TOKEN_ENV = "PC_CONTROL_BRIDGE_TOKEN";
const DEFAULT_PC_CONTROL_TIMEOUT_MS = 10_000;
const DIRECT_READ_PROPOSAL_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PC_CONTROL_OPERATION_TIMEOUTS_MS: Record<string, number> = {
  "display.screenshot": 20_000,
};

type PcControlTelegramConfig = {
  bridgeUrl: string;
  authTokenEnv: string;
  authToken: string;
  recoveryUrl: string;
  recoveryAuthTokenEnv: string;
  recoveryAuthToken: string;
  timeoutMs: number;
  recoveryTimeoutMs: number;
  operationTimeoutsMs: Record<string, number>;
  sharedPathMap?: { from: string; to: string };
  allowWriteOperations: boolean;
  allowAdminOperations: boolean;
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

function deriveRecoveryUrl(bridgeUrl: string): string {
  try {
    const url = new URL(bridgeUrl);
    url.port = "48722";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
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
  const recoveryUrl =
    (typeof pluginCfg.recoveryUrl === "string" && pluginCfg.recoveryUrl.trim()
      ? pluginCfg.recoveryUrl.trim()
      : process.env.PC_CONTROL_RECOVERY_URL?.trim()) || deriveRecoveryUrl(bridgeUrl);
  const recoveryAuthTokenEnv =
    typeof pluginCfg.recoveryAuthTokenEnv === "string" && pluginCfg.recoveryAuthTokenEnv.trim()
      ? pluginCfg.recoveryAuthTokenEnv.trim()
      : authTokenEnv;
  const recoveryAuthToken = process.env[recoveryAuthTokenEnv]?.trim() || authToken;
  return {
    bridgeUrl: bridgeUrl.replace(/\/+$/, ""),
    authTokenEnv,
    authToken,
    recoveryUrl: recoveryUrl.replace(/\/+$/, ""),
    recoveryAuthTokenEnv,
    recoveryAuthToken,
    timeoutMs: toPositiveNumber(pluginCfg.timeoutMs, DEFAULT_PC_CONTROL_TIMEOUT_MS),
    recoveryTimeoutMs: toPositiveNumber(pluginCfg.recoveryTimeoutMs, 20_000),
    operationTimeoutsMs: {
      ...DEFAULT_PC_CONTROL_OPERATION_TIMEOUTS_MS,
      ...toOperationTimeouts(pluginCfg.operationTimeoutsMs),
    },
    sharedPathMap: toPcControlSharedPathMap(pluginCfg.sharedPathMap),
    allowWriteOperations: pluginCfg.allowWriteOperations === true,
    allowAdminOperations: pluginCfg.allowWriteOperations === true || pluginCfg.allowAdminOperations === true,
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

function resolveTelegramPcControlIntentText(params: {
  ctxPayload: { BodyForAgent?: unknown; Body?: unknown; RawBody?: unknown };
  msg: { text?: unknown; caption?: unknown };
}): string {
  const candidates = [
    params.msg.text,
    params.msg.caption,
    params.ctxPayload.BodyForAgent,
    params.ctxPayload.RawBody,
    params.ctxPayload.Body,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeTelegramIntentLine(raw: string): string {
  const withoutCodeBlocks = raw.replace(/```[\s\S]*?```/g, " ");
  const nonEmptyLines = withoutCodeBlocks
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return nonEmptyLines.at(-1) ?? withoutCodeBlocks.trim();
}

const READ_ONLY_PC_CONTROL_HINTS = [
  /\ballowed roots?\b/i,
  /\bhealth check\b/i,
  /\bdrives?\b/i,
  /\bfolders?\b/i,
  /\bdirector(?:y|ies)\b/i,
  /\bpath\b/i,
  /\bcontents?\b/i,
  /\binside\b/i,
  /\bdesktop\b/i,
  /\bdownloads?\b/i,
  /\bdocuments?\b/i,
  /\bmusic\b/i,
  /\bfind\b/i,
  /\bsearch\b/i,
  /\blocate\b/i,
  /\blook for\b/i,
  /\bwhere is\b/i,
  /\bwhere's\b/i,
];

const NON_PC_CONTROL_ESCAPE_HINTS = [
  /\bnot pc-?control\b/i,
  /\bnot on (?:my )?(?:pc|computer|desktop|host)\b/i,
  /\banswer normally\b/i,
  /\bjust answer\b/i,
  /\bno tools?\b/i,
  /\bdon't use (?:pc-?control|tools?)\b/i,
];

const SEARCH_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "at",
  "can",
  "check",
  "could",
  "directory",
  "do",
  "file",
  "files",
  "find",
  "folder",
  "folders",
  "for",
  "how",
  "inside",
  "is",
  "it",
  "lets",
  "let",
  "list",
  "locate",
  "look",
  "me",
  "my",
  "of",
  "open",
  "please",
  "search",
  "see",
  "show",
  "that",
  "the",
  "to",
  "up",
  "what",
  "where",
  "with",
]);

function looksLikeReadOnlyPcControlText(text: string): boolean {
  return READ_ONLY_PC_CONTROL_HINTS.some((pattern) => pattern.test(text));
}

function looksLikeNonPcControlEscape(text: string): boolean {
  return NON_PC_CONTROL_ESCAPE_HINTS.some((pattern) => pattern.test(text));
}

function isAffirmativePcControlText(text: string): boolean {
  return /^(?:yes|y|ok|okay|sure|proceed|do it|go ahead|continue|yes proceed)\b/i.test(text.trim());
}

function extractAbsolutePath(text: string): string | null {
  const windowsPathMatch = text.match(/([a-zA-Z]:\\[^\n\r]*)/);
  if (windowsPathMatch?.[1]) {
    return windowsPathMatch[1].trim();
  }
  const wslPathMatch = text.match(/(\/mnt\/[a-z][^\n\r]*)/i);
  return wslPathMatch?.[1]?.trim() ?? null;
}

function extractBrowseTargetName(text: string): string | null {
  const normalized = text.toLowerCase();
  const alias = extractRootAlias(normalized);
  if (alias) {
    const explicitFolder = /(?:^|\s)([a-z0-9._-]+)\s+(?:folder|directory|dir)\b/i.exec(normalized)?.[1];
    if (explicitFolder && explicitFolder !== alias) {
      return explicitFolder.trim();
    }
  }
  const patterns = [
    /\b(?:what(?:'s| is)?\s+)?(?:inside|contents(?: of| inside)?|in)\s+([a-z0-9._ -]+?)(?:\s+in\s+(?:the\s+)?(?:desktop|downloads?|documents?|music)\b)?$/i,
    /\b(?:browse|explore|open|show|list)(?:\s+me)?(?:\s+what(?:'s| is)?)?(?:\s+inside)?\s+([a-z0-9._ -]+?)(?:\s+in\s+(?:the\s+)?(?:desktop|downloads?|documents?|music)\b)?$/i,
    /\bfind\s+(?:the\s+)?([a-z0-9._ -]+?)\s+(?:folder|directory|dir)\b(?:\s+in\s+(?:the\s+)?(?:desktop|downloads?|documents?|music)\b)?$/i,
  ];
  let candidate = "";
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const value = match?.[1]?.trim().replace(/[.?!]+$/g, "") ?? "";
    if (value) {
      candidate = value;
      break;
    }
  }
  if (!candidate) {
    return null;
  }
  candidate = candidate
    .replace(/^(?:me\s+what(?:'s| is)?\s+|what(?:'s| is)?\s+)/i, "")
    .replace(/\b(?:folder|directory|dir)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return candidate || null;
}

function extractGeneralQuery(text: string): string | null {
  const absolutePath = extractAbsolutePath(text);
  if (absolutePath) {
    return null;
  }
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._\-/\\\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  const directMatch =
    /(?:find|search|locate|look for|look up|where is|where's)\s+(.+)$/i.exec(
      normalized,
    );
  if (!directMatch?.[1]) {
    return null;
  }
  const candidate = directMatch[1]
    .replace(/^(?:for|my|the|a|an)\s+/i, "")
    .replace(/\b(?:please|thanks?)\b/gi, "")
    .trim();
  const tokens = candidate
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !SEARCH_QUERY_STOP_WORDS.has(token));
  if (tokens.length === 0) {
    return null;
  }
  return tokens.slice(0, 6).join(" ");
}

function normalizeFolderLikeQuery(query: string | null): string | null {
  if (!query) {
    return null;
  }
  const normalized = query
    .replace(/\b(?:folder|directory|dir)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/g, "");
  return normalized || null;
}

function looksLikeHostScopedFindText(text: string): boolean {
  return /\b(?:file|files|folder|folders|directory|directories|path|desktop|downloads?|documents?|music|allowed roots?|pc|computer|host|drive|drives)\b/i.test(
    text,
  );
}

function resolveProposalStorePath(sessionKey: unknown): string | null {
  const rawSessionKey = typeof sessionKey === "string" ? sessionKey.trim() : "";
  const agentId = /^agent:([^:]+):/.exec(rawSessionKey)?.[1];
  const homeDir = process.env.HOME?.trim();
  if (!rawSessionKey || !agentId || !homeDir) {
    return null;
  }
  return path.join(homeDir, ".openclaw", "agents", agentId, "sessions", "pc-control-direct-proposals.json");
}

function extractRootAlias(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\bdesktop\b/.test(normalized)) {
    return "desktop";
  }
  if (/\bdownloads?\b/.test(normalized)) {
    return "downloads";
  }
  if (/\bdocuments?\b/.test(normalized)) {
    return "documents";
  }
  if (/\bmusic\b/.test(normalized)) {
    return "music";
  }
  return null;
}

function extractFindQuery(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\bportfolio\b/.test(normalized)) {
    return "portfolio";
  }
  if (/\bresume\b/.test(normalized)) {
    return "resume";
  }
  if (/\bcv\b/.test(normalized)) {
    return "cv";
  }
  return null;
}

function formatByteCount(bytes: unknown): string {
  const value = typeof bytes === "number" ? bytes : Number(bytes);
  if (!Number.isFinite(value) || value < 0) {
    return "unknown";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[index]}`;
}

function scoreSearchResult(query: string, entry: Record<string, unknown>): number {
  const queryLower = query.toLowerCase();
  const candidatePath = typeof entry.path === "string" ? entry.path : "";
  const fileName = candidatePath ? path.basename(candidatePath).toLowerCase() : "";
  let score = 0;
  if (fileName.includes(queryLower)) {
    score += 100;
  }
  if (candidatePath.toLowerCase().includes(queryLower)) {
    score += 30;
  }
  const modifiedAt = typeof entry.modifiedAt === "string" ? Date.parse(entry.modifiedAt) : NaN;
  if (Number.isFinite(modifiedAt)) {
    score += Math.max(0, Math.floor((modifiedAt - Date.now() + 30 * 24 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000)));
  }
  return score;
}

function formatAllowedRootsReply(result: Record<string, unknown>): string {
  const roots = Array.isArray(result.roots) ? result.roots.filter((entry) => typeof entry === "string") : [];
  if (roots.length === 0) {
    return "There are no allowed roots configured right now.";
  }
  return `Allowed roots:\n${roots.map((root, index) => `${index + 1}. \`${root}\``).join("\n")}`;
}

function formatHostOverviewReply(result: Record<string, unknown>): string {
  const drives = Array.isArray(result.drives) ? result.drives : [];
  const homeEntries = Array.isArray(result.homeEntries) ? result.homeEntries : [];
  const driveLines = drives.length
    ? drives
        .map((entry) => {
          const name = typeof entry?.name === "string" ? entry.name : "?";
          const windowsPath = typeof entry?.windowsPath === "string" ? entry.windowsPath : "";
          const free = formatByteCount(entry?.freeBytes);
          const label = windowsPath || name;
          return `- ${label}${free !== "unknown" ? ` (free ${free})` : ""}`;
        })
        .join("\n")
    : "- none";
  const home = typeof result.home?.windowsPath === "string" ? result.home.windowsPath : "";
  const entryLines = homeEntries.length
    ? homeEntries.slice(0, 20).map((entry) => `- ${entry?.name}${entry?.type === "directory" ? "/" : ""}`).join("\n")
    : "- none";
  return [
    "Available drives:",
    driveLines,
    home ? `Sevensoul home: \`${home}\`` : "",
    "Top-level entries:",
    entryLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatHealthReply(result: Record<string, unknown>): string {
  const components =
    result.components && typeof result.components === "object"
      ? (result.components as Record<string, Record<string, unknown>>)
      : {};
  const panel =
    components.panel && typeof components.panel === "object"
      ? (components.panel as Record<string, Record<string, unknown>>)
      : result.panel && typeof result.panel === "object"
        ? (result.panel as Record<string, Record<string, unknown>>)
        : {};
  const lines = ["System panel:"];
  if (panel.cpu) {
    lines.push(
      `- CPU: ${panel.cpu.model ?? "unknown"}${panel.cpu.utilizationPercent != null ? `, ${panel.cpu.utilizationPercent}%` : panel.cpu.usagePercent != null ? `, ${panel.cpu.usagePercent}%` : ""}${panel.cpu.clockMhz != null ? `, ${panel.cpu.clockMhz} MHz` : panel.cpu.clockMHz != null ? `, ${panel.cpu.clockMHz} MHz` : ""}`,
    );
  }
  if (panel.gpu) {
    lines.push(
      `- GPU: ${panel.gpu.name ?? panel.gpu.model ?? "unknown"}${panel.gpu.utilizationPercent != null ? `, ${panel.gpu.utilizationPercent}%` : panel.gpu.usagePercent != null ? `, ${panel.gpu.usagePercent}%` : ""}${panel.gpu.temperatureC != null ? `, ${panel.gpu.temperatureC} C` : ""}`,
    );
  }
  const ram = panel.ram ?? panel.memory;
  if (ram) {
    lines.push(
      `- RAM: ${ram.usedPercent != null ? `${ram.usedPercent}% used` : "unknown"}${ram.usedBytes != null && ram.totalBytes != null ? ` (${Math.round(Number(ram.usedBytes) / 1048576)}/${Math.round(Number(ram.totalBytes) / 1048576)} MB)` : ram.usedMB != null && ram.totalMB != null ? ` (${ram.usedMB}/${ram.totalMB} MB)` : ""}`,
    );
  }
  if (panel.display) {
    const resolution =
      panel.display.resolution ??
      (panel.display.width != null && panel.display.height != null
        ? `${panel.display.width}x${panel.display.height}`
        : "unknown");
    lines.push(
      `- Display: ${resolution}${panel.display.refreshHz != null ? ` @ ${panel.display.refreshHz} Hz` : ""}`,
    );
  }
  if (panel.publicIp && typeof panel.publicIp.address === "string") {
    lines.push(`- Public IP: ${panel.publicIp.address}`);
  }
  const bridge =
    components.bridge && typeof components.bridge === "object"
      ? (components.bridge as Record<string, unknown>)
      : {};
  const host =
    components.host && typeof components.host === "object"
      ? (components.host as Record<string, unknown>)
      : {};
  const storage =
    components.storage && typeof components.storage === "object"
      ? (components.storage as Record<string, unknown>)
      : {};
  const integrations =
    components.integrations && typeof components.integrations === "object"
      ? (components.integrations as Record<string, Record<string, unknown>>)
      : {};

  if (Object.keys(bridge).length > 0) {
    lines.push("");
    lines.push("Bridge:");
    lines.push(`- Status: ${bridge.ok === true ? "ok" : "degraded"}`);
    if (typeof bridge.service === "string") {
      lines.push(`- Service: ${bridge.service}`);
    }
    if (bridge.listen && typeof bridge.listen === "object") {
      const listen = bridge.listen as Record<string, unknown>;
      if (listen.host != null || listen.port != null) {
        lines.push(`- Listen: ${listen.host ?? "unknown"}:${listen.port ?? "unknown"}`);
      }
    }
    if (typeof bridge.configPath === "string") {
      lines.push(`- Config: \`${bridge.configPath}\``);
    }
  }

  if (Object.keys(host).length > 0) {
    lines.push("");
    lines.push("Host:");
    lines.push(`- Status: ${host.ok === true ? "ok" : "degraded"}`);
    if (typeof host.hostname === "string") {
      lines.push(`- Hostname: ${host.hostname}`);
    }
    if (typeof host.platform === "string" || typeof host.release === "string") {
      lines.push(`- Platform: ${host.platform ?? "unknown"} ${host.release ?? ""}`.trim());
    }
    if (host.memory && typeof host.memory === "object") {
      const memory = host.memory as Record<string, unknown>;
      if (memory.totalBytes != null && memory.freeBytes != null) {
        lines.push(
          `- Memory: ${Math.round((Number(memory.totalBytes) - Number(memory.freeBytes)) / 1048576)}/${Math.round(Number(memory.totalBytes) / 1048576)} MB used`,
        );
      }
    }
  }

  if (Object.keys(storage).length > 0) {
    lines.push("");
    lines.push("Storage:");
    lines.push(`- Status: ${storage.ok === true ? "ok" : "degraded"}`);
    const allowedRoots = Array.isArray(storage.allowedRoots) ? storage.allowedRoots : [];
    if (allowedRoots.length > 0) {
      lines.push("- Allowed roots:");
      for (const root of allowedRoots) {
        if (!root || typeof root !== "object") {
          continue;
        }
        const entry = root as Record<string, unknown>;
        if (typeof entry.path === "string") {
          lines.push(`  - \`${entry.path}\`${entry.exists === true ? "" : " (missing)"}`);
        }
      }
    }
    if (storage.stagingDir && typeof storage.stagingDir === "object") {
      const stagingDir = storage.stagingDir as Record<string, unknown>;
      if (typeof stagingDir.path === "string") {
        lines.push(`- Staging: \`${stagingDir.path}\``);
      }
    }
    if (storage.auditDir && typeof storage.auditDir === "object") {
      const auditDir = storage.auditDir as Record<string, unknown>;
      if (typeof auditDir.path === "string") {
        lines.push(`- Audit: \`${auditDir.path}\``);
      }
    }
  }

  if (Object.keys(integrations).length > 0) {
    lines.push("");
    lines.push("Integrations:");
    for (const [name, value] of Object.entries(integrations)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const entry = value as Record<string, unknown>;
      const base = `- ${name}: ${entry.ok === true || entry.detected === true ? "ok" : "degraded"}`;
      if (name === "gateway" && typeof entry.status === "number") {
        lines.push(`${base} (${entry.status})`);
        continue;
      }
      if (name === "ollama") {
        const models = Array.isArray((entry.body as Record<string, unknown> | undefined)?.models)
          ? ((entry.body as Record<string, unknown>).models as Array<Record<string, unknown>>)
          : [];
        const names = models
          .map((model) => (typeof model.name === "string" ? model.name : ""))
          .filter(Boolean)
          .slice(0, 5);
        lines.push(`${base}${names.length > 0 ? ` (${names.join(", ")})` : ""}`);
        continue;
      }
      lines.push(base);
    }
  }

  return lines.join("\n");
}

function formatFindReply(query: string, results: Array<Record<string, unknown>>): string {
  if (results.length === 0) {
    return `I couldn't find any likely ${query} files in the current allowed roots.`;
  }
  const lines = [`I found these ${query} candidates:`];
  results.slice(0, 5).forEach((entry, index) => {
    const candidatePath = typeof entry.path === "string" ? entry.path : "";
    const fileName = candidatePath ? path.basename(candidatePath) : `Result ${index + 1}`;
    const modifiedAt = typeof entry.modifiedAt === "string" ? entry.modifiedAt.slice(0, 10) : "unknown";
    lines.push(`${index + 1}. ${fileName}`);
    lines.push(`   Path: \`${candidatePath}\``);
    lines.push(`   Modified: ${modifiedAt}`);
  });
  return lines.join("\n");
}

function formatNoMatchInAllowedRootsReply(kind: "file" | "folder", query: string, roots: string[]): string {
  const lines = [
    `I couldn't find a ${kind} matching \`${query}\` in the current allowed roots.`,
  ];
  if (roots.length > 0) {
    lines.push("");
    lines.push("Current allowed roots:");
    for (const root of roots) {
      lines.push(`- \`${root}\``);
    }
  }
  lines.push("");
  lines.push(
    kind === "folder"
      ? "Next deterministic options: add the parent location to allowed roots, browse a known allowed path directly, or show drives to discover where that folder lives."
      : "Next deterministic options: refine the filename clue, scope the search to one known allowed path, or add another allowed root first.",
  );
  return lines.join("\n");
}

type DirectReadIntent =
  | { kind: "allowed_roots" }
  | { kind: "health" }
  | { kind: "discover" }
  | { kind: "monitor_power"; action: "off" | "on" }
  | { kind: "browse"; path: string; absolute: boolean }
  | { kind: "browse_named"; query: string; rootAlias: string | null }
  | { kind: "find"; query: string; rootAlias: string | null }
  | { kind: "send_file"; path: string; label: string }
  | { kind: "rename_path"; source: string; destination: string; label: string }
  | { kind: "move_path"; source: string; destination: string; label: string }
  | {
      kind: "move_paths";
      items: Array<{ source: string; destination: string; label: string }>;
    }
  | { kind: "quarantine_path"; path: string; label: string }
  | {
      kind: "quarantine_paths";
      items: Array<{ path: string; label: string }>;
    }
  | { kind: "mkdir_path"; path: string; label: string }
  | { kind: "add_allowed_root"; root: string }
  | { kind: "remove_allowed_root"; root: string }
  | { kind: "self_heal"; action: "bridge_restart" | "bridge_repair_network" | "gateway_restart" | "recheck_health" | "full_pc_control_repair" };

type DirectReadProposal = {
  proposalId: string;
  createdAt: string;
  intent: DirectReadIntent;
  originalText: string;
  originalSessionKey: string | null;
  originalSenderId: string | null;
};

type DirectRecentContext = {
  createdAt: string;
  kind: "find_results" | "browse_entries" | "host_browse_entries";
  basePath: string | null;
  entries: Array<{
    index: number;
    name: string;
    path: string;
    type: "file" | "directory" | "unknown";
  }>;
};

type DirectExecutionResult =
  | { kind: "text"; text: string }
  | { kind: "media"; mediaPaths: string[]; caption?: string };

function createDirectReadProposalId(): string {
  return randomBytes(6).toString("base64url");
}

function resolveDirectContextStorePath(sessionKey: unknown): string | null {
  const proposalStorePath = resolveProposalStorePath(sessionKey);
  if (!proposalStorePath) {
    return null;
  }
  return proposalStorePath.replace(/pc-control-direct-proposals\.json$/, "pc-control-direct-context.json");
}

async function loadDirectReadProposal(sessionKey: unknown): Promise<DirectReadProposal | null> {
  const storePath = resolveProposalStorePath(sessionKey);
  const rawSessionKey = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!storePath || !rawSessionKey) {
    return null;
  }
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const store = JSON.parse(raw);
    const proposal = store?.[rawSessionKey];
    if (!proposal || typeof proposal !== "object") {
      return null;
    }
    const createdAt = typeof proposal.createdAt === "string" ? Date.parse(proposal.createdAt) : NaN;
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > DIRECT_READ_PROPOSAL_TTL_MS) {
      return null;
    }
    return proposal as DirectReadProposal;
  } catch {
    return null;
  }
}

async function loadDirectReadProposalById(
  sessionKey: unknown,
  proposalId: unknown,
): Promise<DirectReadProposal | null> {
  const storePath = resolveProposalStorePath(sessionKey);
  const normalizedProposalId = typeof proposalId === "string" ? proposalId.trim() : "";
  if (!storePath || !normalizedProposalId) {
    return null;
  }
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const store = JSON.parse(raw) as Record<string, DirectReadProposal>;
    for (const proposal of Object.values(store)) {
      if (!proposal || typeof proposal !== "object") {
        continue;
      }
      if (proposal.proposalId !== normalizedProposalId) {
        continue;
      }
      const createdAt = typeof proposal.createdAt === "string" ? Date.parse(proposal.createdAt) : NaN;
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > DIRECT_READ_PROPOSAL_TTL_MS) {
        return null;
      }
      return proposal;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveDirectReadProposal(sessionKey: unknown, proposal: DirectReadProposal): Promise<void> {
  const storePath = resolveProposalStorePath(sessionKey);
  const rawSessionKey = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!storePath || !rawSessionKey) {
    return;
  }
  let store: Record<string, DirectReadProposal> = {};
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      store = parsed;
    }
  } catch {
    // Start fresh.
  }
  store[rawSessionKey] = proposal;
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function clearDirectReadProposal(sessionKey: unknown): Promise<void> {
  const storePath = resolveProposalStorePath(sessionKey);
  const rawSessionKey = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!storePath || !rawSessionKey) {
    return;
  }
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !(rawSessionKey in parsed)) {
      return;
    }
    delete parsed[rawSessionKey];
    await fs.writeFile(storePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    // Ignore cleanup failures.
  }
}

async function clearDirectReadProposalById(sessionKey: unknown, proposalId: unknown): Promise<void> {
  const storePath = resolveProposalStorePath(sessionKey);
  const normalizedProposalId = typeof proposalId === "string" ? proposalId.trim() : "";
  if (!storePath || !normalizedProposalId) {
    return;
  }
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, DirectReadProposal>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    let changed = false;
    for (const [key, proposal] of Object.entries(parsed)) {
      if (proposal?.proposalId !== normalizedProposalId) {
        continue;
      }
      delete parsed[key];
      changed = true;
    }
    if (!changed) {
      return;
    }
    await fs.writeFile(storePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    // Ignore cleanup failures.
  }
}

async function loadDirectRecentContext(sessionKey: unknown): Promise<DirectRecentContext | null> {
  const storePath = resolveDirectContextStorePath(sessionKey);
  const rawSessionKey = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!storePath || !rawSessionKey) {
    return null;
  }
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const store = JSON.parse(raw);
    const context = store?.[rawSessionKey];
    if (!context || typeof context !== "object") {
      return null;
    }
    const createdAt = typeof context.createdAt === "string" ? Date.parse(context.createdAt) : NaN;
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > DIRECT_READ_PROPOSAL_TTL_MS) {
      return null;
    }
    return context as DirectRecentContext;
  } catch {
    return null;
  }
}

async function saveDirectRecentContext(sessionKey: unknown, context: DirectRecentContext): Promise<void> {
  const storePath = resolveDirectContextStorePath(sessionKey);
  const rawSessionKey = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!storePath || !rawSessionKey) {
    return;
  }
  let store: Record<string, DirectRecentContext> = {};
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      store = parsed;
    }
  } catch {
    // Start fresh.
  }
  store[rawSessionKey] = context;
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function clearDirectRecentContext(sessionKey: unknown): Promise<void> {
  const storePath = resolveDirectContextStorePath(sessionKey);
  const rawSessionKey = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!storePath || !rawSessionKey) {
    return;
  }
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !(rawSessionKey in parsed)) {
      return;
    }
    delete parsed[rawSessionKey];
    await fs.writeFile(storePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    // Ignore cleanup failures.
  }
}

function parseIndexedSelection(text: string): number | null {
  const match = /\b(?:no|number|#)\s*(\d+)\b/i.exec(text) ?? /\b(\d+)\b/.exec(text);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseIndexedSelections(text: string): number[] {
  const matches = [...text.matchAll(/\b(?:no|number|#)?\s*(\d+)\b/gi)];
  const selections: number[] = [];
  for (const match of matches) {
    const raw = match[1];
    if (!raw) {
      continue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || selections.includes(parsed)) {
      continue;
    }
    selections.push(parsed);
  }
  return selections;
}

function findContextEntryByIndex(
  context: DirectRecentContext | null,
  index: number | null,
  allowedTypes?: Array<DirectRecentContext["entries"][number]["type"]>,
) {
  if (!context || index == null) {
    return null;
  }
  return (
    context.entries.find((entry) => {
      if (entry.index !== index) {
        return false;
      }
      return !allowedTypes || allowedTypes.includes(entry.type);
    }) ?? null
  );
}

function findContextEntriesByIndices(
  context: DirectRecentContext | null,
  indices: number[],
  allowedTypes?: Array<DirectRecentContext["entries"][number]["type"]>,
) {
  if (!context || indices.length === 0) {
    return [];
  }
  return indices
    .map((index) => findContextEntryByIndex(context, index, allowedTypes))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function findSingleContextEntry(
  context: DirectRecentContext | null,
  allowedTypes?: Array<DirectRecentContext["entries"][number]["type"]>,
) {
  if (!context) {
    return null;
  }
  const entries = context.entries.filter((entry) => !allowedTypes || allowedTypes.includes(entry.type));
  return entries.length === 1 ? entries[0] : null;
}

function buildBrowseEntryPath(basePath: string, entry: Record<string, unknown>): string {
  if (typeof entry.path === "string" && entry.path.trim()) {
    return entry.path.trim();
  }
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (!name) {
    return basePath;
  }
  return path.posix.join(basePath, name);
}

function extractMediaPathsFromBridgeResult(
  config: PcControlTelegramConfig,
  payload: Record<string, unknown>,
): string[] {
  const rawPaths: string[] = [];
  if (Array.isArray(payload?.paths)) {
    for (const value of payload.paths) {
      if (typeof value === "string" && value.trim()) {
        rawPaths.push(value.trim());
      }
    }
  }
  if (Array.isArray(payload?.displays)) {
    for (const display of payload.displays) {
      if (typeof display?.path === "string" && display.path.trim()) {
        rawPaths.push(display.path.trim());
      }
    }
  }
  if (typeof payload?.path === "string" && payload.path.trim()) {
    rawPaths.unshift(payload.path.trim());
  }
  return [
    ...new Set(rawPaths.map((value) => remapPcControlSharedPath(config.sharedPathMap, value)).filter(Boolean)),
  ];
}

function isDirectAbsolutePath(value: string): boolean {
  return /^\/mnt\/[a-z](?:\/|$)/i.test(value) || /^[a-zA-Z]:\\/.test(value);
}

function normalizeDirectAbsolutePath(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return raw;
  }
  const windowsMatch = /^([a-zA-Z]):\\(.*)$/.exec(raw);
  if (windowsMatch) {
    const drive = windowsMatch[1].toLowerCase();
    const tail = windowsMatch[2].replace(/\\/g, "/");
    return `/mnt/${drive}/${tail}`;
  }
  return raw;
}

async function loadAllowedRootsDirect(
  config: PcControlTelegramConfig,
  actor: Record<string, unknown>,
): Promise<string[]> {
  const result = await callPcControlBridgeDirect(config, {
    request_id: `telegram-allowed-roots-${Date.now()}`,
    operation: "config.allowed_roots.list",
    arguments: {},
    actor,
  });
  return Array.isArray(result?.result?.roots)
    ? result.result.roots.filter((entry: unknown) => typeof entry === "string" && entry.trim())
    : [];
}

function chooseAllowedRootByAlias(roots: string[], alias: string): string | null {
  const normalizedAlias = alias.trim().toLowerCase();
  if (!normalizedAlias) {
    return null;
  }
  const matches = roots.filter((root) => {
    const normalized = String(root).toLowerCase();
    if (normalized === normalizedAlias || normalized.endsWith(`/${normalizedAlias}`)) {
      return true;
    }
    if (normalizedAlias === "desktop" && normalized.includes("/onedrive/desktop")) {
      return true;
    }
    return false;
  });
  return matches[0] ?? null;
}

async function resolveRootSpecToPath(
  config: PcControlTelegramConfig,
  actor: Record<string, unknown>,
  spec: string,
  recentContext: DirectRecentContext | null,
): Promise<string | null> {
  const raw = spec.trim();
  if (!raw) {
    return null;
  }
  if (/^(?:this|current)(?:\s+folder|\s+path)?$/i.test(raw)) {
    return recentContext?.basePath ? normalizeDirectAbsolutePath(recentContext.basePath) : null;
  }
  if (isDirectAbsolutePath(raw)) {
    return normalizeDirectAbsolutePath(raw);
  }
  const selectedIndex = parseIndexedSelection(raw);
  const selectedEntry = findContextEntryByIndex(recentContext, selectedIndex, ["directory", "unknown"]);
  if (selectedEntry) {
    return selectedEntry.path;
  }
  const roots = await loadAllowedRootsDirect(config, actor);
  const alias = extractRootAlias(raw);
  if (alias) {
    return chooseAllowedRootByAlias(roots, alias);
  }
  return null;
}

function describeDirectReadProposal(intent: DirectReadIntent): string {
  if (intent.kind === "allowed_roots") {
    return "Suggested pc-control action: use `pc_control_list_allowed_roots` to read the current allowed roots.";
  }
  if (intent.kind === "health") {
    return "Suggested pc-control action: use `pc_control_health_check` to read the current system and bridge health.";
  }
  if (intent.kind === "discover") {
    return "Suggested pc-control action: use `pc_control_discover_host_locations` to read available drives and top-level profile folders.";
  }
  if (intent.kind === "monitor_power") {
    return `Suggested pc-control action: turn the host monitor(s) ${intent.action === "off" ? "off" : "back on"}.`;
  }
  if (intent.kind === "browse") {
    return `Suggested pc-control action: use \`${intent.absolute ? "pc_control_browse_host_path" : "pc_control_list_host_folder"}\` on \`${intent.path}\`.`;
  }
  if (intent.kind === "browse_named") {
    return `Suggested pc-control action: search allowed roots for a folder named \`${intent.query}\`${intent.rootAlias ? ` scoped to \`${intent.rootAlias}\`` : ""}, then browse the exact match if found.`;
  }
  if (intent.kind === "send_file") {
    return `Suggested pc-control action: send \`${intent.label}\` to Telegram from \`${intent.path}\`.`;
  }
  if (intent.kind === "rename_path") {
    return `Suggested pc-control action: rename \`${intent.label}\` to \`${path.basename(intent.destination)}\`.`;
  }
  if (intent.kind === "move_path") {
    return `Suggested pc-control action: move \`${intent.label}\` to \`${intent.destination}\`.`;
  }
  if (intent.kind === "move_paths") {
    return `Suggested pc-control action: move ${intent.items.length} selected entries in a single operation.`;
  }
  if (intent.kind === "quarantine_path") {
    return `Suggested pc-control action: quarantine \`${intent.label}\` instead of permanently deleting it.`;
  }
  if (intent.kind === "quarantine_paths") {
    return `Suggested pc-control action: quarantine ${intent.items.length} selected entries instead of permanently deleting them.`;
  }
  if (intent.kind === "mkdir_path") {
    return `Suggested pc-control action: create folder \`${intent.label}\` at \`${intent.path}\`.`;
  }
  if (intent.kind === "add_allowed_root") {
    return `Suggested pc-control action: add \`${intent.root}\` to allowed roots.`;
  }
  if (intent.kind === "remove_allowed_root") {
    return `Suggested pc-control action: remove \`${intent.root}\` from allowed roots.`;
  }
  if (intent.kind === "self_heal") {
    return `Suggested pc-control action: run self-heal action \`${intent.action}\`.`;
  }
  return `Suggested pc-control action: use \`pc_control_find_ranked_files\` for query \`${intent.query}\`${intent.rootAlias ? ` scoped to \`${intent.rootAlias}\`` : ""}.`;
}

async function parseDirectReadIntent(
  text: string,
  recentContext: DirectRecentContext | null,
  config: PcControlTelegramConfig,
  actor: Record<string, unknown>,
): Promise<DirectReadIntent | null> {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  if (!lower) {
    return null;
  }
  if (matchesForcedDesktopScreenshotIntent(normalized)) {
    return null;
  }
  if (
    /\b(?:monitor|monitors|screen|screens|display|displays)\b/i.test(normalized) &&
    /\b(?:turn off|power off|sleep|blank|blackout|black screen|switch off)\b/i.test(normalized)
  ) {
    return { kind: "monitor_power", action: "off" };
  }
  if (
    /\b(?:monitor|monitors|screen|screens|display|displays)\b/i.test(normalized) &&
    /\b(?:turn on|wake|power on|switch on)\b/i.test(normalized)
  ) {
    return { kind: "monitor_power", action: "on" };
  }
  const browseSelectionMatch =
    /\b(?:browse|explore|open|show|list|see)\s+(?:inside\s+)?(?:no|number|#)\s*(\d+)\b/i.exec(normalized);
  if (browseSelectionMatch?.[1]) {
    const selected = findContextEntryByIndex(recentContext, Number.parseInt(browseSelectionMatch[1], 10), [
      "directory",
      "unknown",
    ]);
    if (selected) {
      return { kind: "browse", path: selected.path, absolute: isDirectAbsolutePath(selected.path) };
    }
  }
  if (/\b(?:send|deliver|share)\b/i.test(normalized)) {
    const selected =
      findContextEntryByIndex(recentContext, parseIndexedSelection(normalized), ["file", "unknown"]) ??
      findSingleContextEntry(recentContext, ["file", "unknown"]);
    if (selected) {
      return { kind: "send_file", path: selected.path, label: selected.name };
    }
  }
  const renameMatch = /\brename\s+(?:no|number|#)?\s*(\d+)\s+to\s+(.+)$/i.exec(normalized);
  if (renameMatch?.[1] && renameMatch?.[2]) {
    const selected = findContextEntryByIndex(recentContext, Number.parseInt(renameMatch[1], 10), [
      "file",
      "directory",
      "unknown",
    ]);
    const newName = renameMatch[2].trim().replace(/[.?!]+$/g, "");
    if (selected && newName) {
      return {
        kind: "rename_path",
        source: selected.path,
        destination: path.posix.join(path.posix.dirname(selected.path), newName),
        label: selected.name,
      };
    }
  }
  const moveMatch = /\b(?:move|relocate|put)\s+(.+?)\s+(?:to|into)\s+(.+)$/i.exec(normalized);
  if (moveMatch?.[1] && moveMatch?.[2]) {
    const selectedIndices = parseIndexedSelections(moveMatch[1]);
    const selectedEntries = findContextEntriesByIndices(recentContext, selectedIndices, [
      "file",
      "directory",
      "unknown",
    ]);
    const destinationSpec = moveMatch[2].trim().replace(/[.?!]+$/g, "");
    const destinationRoot = await resolveRootSpecToPath(config, actor, destinationSpec, recentContext);
    if (selectedEntries.length > 0 && destinationRoot) {
      if (selectedEntries.length === 1) {
        const selected = selectedEntries[0];
        return {
          kind: "move_path",
          source: selected.path,
          destination: path.posix.join(destinationRoot, path.posix.basename(selected.path)),
          label: selected.name,
        };
      }
      return {
        kind: "move_paths",
        items: selectedEntries.map((selected) => ({
          source: selected.path,
          destination: path.posix.join(destinationRoot, path.posix.basename(selected.path)),
          label: selected.name,
        })),
      };
    }
  }
  const quarantineMatch = /\b(?:quarantine|archive|hide|delete)\s+(.+)$/i.exec(normalized);
  if (quarantineMatch?.[1]) {
    const selectedEntries = findContextEntriesByIndices(recentContext, parseIndexedSelections(quarantineMatch[1]), [
      "file",
      "directory",
      "unknown",
    ]);
    if (selectedEntries.length === 1) {
      const selected = selectedEntries[0];
      return {
        kind: "quarantine_path",
        path: selected.path,
        label: selected.name,
      };
    }
    if (selectedEntries.length > 1) {
      return {
        kind: "quarantine_paths",
        items: selectedEntries.map((selected) => ({
          path: selected.path,
          label: selected.name,
        })),
      };
    }
  }
  const mkdirMatch =
    /\b(?:create|make|mkdir)\s+(?:a\s+)?(?:new\s+)?folder\s+(.+?)(?:\s+in\s+(.+))?$/i.exec(normalized);
  if (mkdirMatch?.[1]) {
    const folderName = mkdirMatch[1].trim().replace(/[.?!]+$/g, "");
    const destinationSpec = mkdirMatch[2]?.trim() ?? "";
    const basePath =
      (destinationSpec
        ? await resolveRootSpecToPath(config, actor, destinationSpec, recentContext)
        : recentContext?.basePath) ?? null;
    if (folderName && basePath) {
      return {
        kind: "mkdir_path",
        path: path.posix.join(basePath, folderName),
        label: folderName,
      };
    }
  }
  const addAllowedRootMatch = /\b(?:add|allow|include)\s+(.+?)\s+to\s+allowed roots?\b/i.exec(normalized);
  if (addAllowedRootMatch?.[1]) {
    const root = await resolveRootSpecToPath(config, actor, addAllowedRootMatch[1], recentContext);
    if (root) {
      return { kind: "add_allowed_root", root };
    }
  }
  const removeAllowedRootMatch =
    /\b(?:remove|delete|drop|unallow)\s+(.+?)\s+from\s+allowed roots?\b/i.exec(normalized);
  if (removeAllowedRootMatch?.[1]) {
    const root = await resolveRootSpecToPath(config, actor, removeAllowedRootMatch[1], recentContext);
    if (root) {
      return { kind: "remove_allowed_root", root };
    }
  }
  if (/\b(?:repair|fix|self-heal|heal|restart)\b/i.test(normalized) && /\b(?:pc-control|bridge|gateway|connection)\b/i.test(normalized)) {
    const action =
      /\bgateway\b/i.test(normalized)
        ? "gateway_restart"
        : /\bnetwork\b/i.test(normalized)
          ? "bridge_repair_network"
          : /\brecheck\b|\bcheck\b/i.test(normalized)
            ? "recheck_health"
            : /\brestart\b/i.test(normalized) && /\bbridge\b/i.test(normalized)
              ? "bridge_restart"
              : "full_pc_control_repair";
    return { kind: "self_heal", action };
  }
  if (/\b(?:show|list|what are)\b/.test(lower) && /\ballowed roots?\b/.test(lower)) {
    return { kind: "allowed_roots" };
  }
  if (/\bhealth check\b/.test(lower) || /\bcheck .*health\b/.test(lower)) {
    return { kind: "health" };
  }
  if ((/\b(?:show|list|what)\b/.test(lower) && /\bdrives?\b/.test(lower)) || /\bsevensoul folders?\b/.test(lower)) {
    return { kind: "discover" };
  }
  const absolutePath = extractAbsolutePath(normalized);
  if (/\b(?:browse|explore|show|list|open)\b/.test(lower) && absolutePath) {
    return { kind: "browse", path: absolutePath, absolute: true };
  }
  const browseAlias = extractRootAlias(lower);
  if (/\b(?:browse|explore|show|list|open)\b/.test(lower) && browseAlias) {
    return { kind: "browse", path: browseAlias, absolute: false };
  }
  const targetName = extractBrowseTargetName(normalized);
  const folderHint = /\b(?:folder|directory|dir|inside|contents?)\b/.test(lower);
  if ((/\b(?:inside|contents?)\b/.test(lower) || /\b(?:browse|explore|open)\b/.test(lower)) && targetName) {
    return { kind: "browse_named", query: targetName, rootAlias: extractRootAlias(lower) };
  }
  const explicitFindQuery = extractFindQuery(lower);
  const query =
    explicitFindQuery ??
    (looksLikeHostScopedFindText(normalized) ? extractGeneralQuery(normalized) : null);
  const folderQuery = normalizeFolderLikeQuery(targetName ?? query);
  if (folderHint && folderQuery) {
    return { kind: "browse_named", query: folderQuery, rootAlias: extractRootAlias(lower) };
  }
  if (query) {
    return { kind: "find", query, rootAlias: extractRootAlias(lower) };
  }
  return null;
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

async function callPcControlRecoveryDirect(
  config: PcControlTelegramConfig,
  payload: Record<string, unknown>,
) {
  if (!config.recoveryUrl) {
    throw new Error("Missing pc-control recovery URL");
  }
  if (!config.recoveryAuthToken) {
    throw new Error(`Missing recovery auth token env: ${config.recoveryAuthTokenEnv}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.recoveryTimeoutMs || 20_000);
  try {
    const response = await fetch(`${config.recoveryUrl}/v1/self-heal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.recoveryAuthToken}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok !== true) {
      const message = json?.error?.message || `Recovery request failed with status ${response.status}`;
      throw new Error(message);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function executeDirectReadIntent(params: {
  config: PcControlTelegramConfig;
  intent: DirectReadIntent;
  sessionKey: string | null;
  senderId: unknown;
}): Promise<DirectExecutionResult> {
  const actor = {
    channel: "telegram",
    session_key: params.sessionKey ?? null,
    sender_id: params.senderId ?? null,
  };
  const activeIntent = params.intent;
  if (activeIntent.kind === "allowed_roots") {
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-allowed-roots-${Date.now()}`,
      operation: "config.allowed_roots.list",
      arguments: {},
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return { kind: "text", text: formatAllowedRootsReply(result.result ?? {}) };
  }
  if (activeIntent.kind === "health") {
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-health-${Date.now()}`,
      operation: "health.check",
      arguments: {},
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return { kind: "text", text: formatHealthReply(result.result ?? {}) };
  }
  if (activeIntent.kind === "discover") {
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-discover-${Date.now()}`,
      operation: "config.host_discovery.overview",
      arguments: {},
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return { kind: "text", text: formatHostOverviewReply(result.result ?? {}) };
  }
  if (activeIntent.kind === "monitor_power") {
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-monitor-power-${Date.now()}`,
      operation: "display.monitor_power",
      arguments: { action: activeIntent.action },
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    const powered = result?.result?.powered === "on" ? "on" : "off";
    return {
      kind: "text",
      text:
        powered === "off"
          ? "Host monitor power command sent: monitors should turn off now."
          : "Host monitor wake command sent: monitors should wake back on now.",
    };
  }
  if (activeIntent.kind === "browse") {
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-browse-${Date.now()}`,
      operation: activeIntent.absolute ? "config.host_discovery.browse" : "fs.list",
      arguments: { path: activeIntent.path },
      actor,
    });
    const entries = Array.isArray(result?.result?.entries) ? result.result.entries : [];
    const header =
      typeof result?.result?.path?.windowsPath === "string"
        ? result.result.path.windowsPath
        : typeof result?.result?.path === "string"
          ? result.result.path
          : activeIntent.path;
    await saveDirectRecentContext(params.sessionKey, {
      createdAt: new Date().toISOString(),
      kind: activeIntent.absolute ? "host_browse_entries" : "browse_entries",
      basePath: activeIntent.path,
      entries: entries.slice(0, 40).map((entry: Record<string, unknown>, index) => ({
        index: index + 1,
        name: typeof entry.name === "string" ? entry.name : `Entry ${index + 1}`,
        path: buildBrowseEntryPath(activeIntent.path, entry),
        type:
          entry.type === "directory" ? "directory" : entry.type === "file" ? "file" : "unknown",
      })),
    });
    return {
      kind: "text",
      text: [`Contents of \`${header}\`:`]
        .concat(
          entries.length > 0
            ? entries.slice(0, 40).map((entry: Record<string, unknown>, index) => {
                const name = typeof entry.name === "string" ? entry.name : "unknown";
                const type = entry.type === "directory" ? "/" : "";
                return `${index + 1}. ${name}${type}`;
              })
            : ["- empty"],
        )
        .join("\n"),
    };
  }
  if (activeIntent.kind === "browse_named") {
    const rootsResult = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-browse-named-roots-${Date.now()}`,
      operation: "config.allowed_roots.list",
      arguments: {},
      actor,
    });
    const allowedRoots = Array.isArray(rootsResult?.result?.roots)
      ? rootsResult.result.roots.filter((entry: unknown) => typeof entry === "string" && entry.trim())
      : [];
    const scopedRoots = activeIntent.rootAlias
      ? allowedRoots.filter((entry: string) => {
          const normalized = entry.toLowerCase();
          return (
            normalized.includes(`/${activeIntent.rootAlias}`) ||
            normalized.endsWith(`/${activeIntent.rootAlias}`) ||
            normalized === activeIntent.rootAlias
          );
        })
      : allowedRoots;
    const rootsToSearch =
      scopedRoots.length > 0 ? scopedRoots : activeIntent.rootAlias ? [activeIntent.rootAlias] : allowedRoots;
    const combinedResults: Array<Record<string, unknown>> = [];
    for (const root of rootsToSearch) {
      const searchResult = await callPcControlBridgeDirect(params.config, {
        request_id: `telegram-browse-named-${Date.now()}-${String(root).replace(/[^a-z0-9]+/gi, "-")}`,
        operation: "fs.search",
        arguments: {
          root,
          pattern: `*${activeIntent.query}*`,
          limit: 20,
          includeFiles: false,
          includeDirectories: true,
        },
        actor,
      });
      const entries = Array.isArray(searchResult?.result?.results) ? searchResult.result.results : [];
      combinedResults.push(...entries.filter((entry: Record<string, unknown>) => entry?.type === "directory"));
    }
    const deduped: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const entry of combinedResults) {
      const candidatePath = typeof entry.path === "string" ? entry.path : "";
      if (!candidatePath || seen.has(candidatePath)) {
        continue;
      }
      seen.add(candidatePath);
      deduped.push(entry);
    }
    if (deduped.length === 0) {
      await clearDirectRecentContext(params.sessionKey);
      return {
        kind: "text",
        text: formatNoMatchInAllowedRootsReply("folder", activeIntent.query, rootsToSearch.map(String)),
      };
    }
    if (deduped.length === 1) {
      const only = deduped[0];
      const listResult = await callPcControlBridgeDirect(params.config, {
        request_id: `telegram-browse-named-list-${Date.now()}`,
        operation: "fs.list",
        arguments: {
          path: only.path,
        },
        actor,
      });
      const entries = Array.isArray(listResult?.result?.entries) ? listResult.result.entries : [];
      await saveDirectRecentContext(params.sessionKey, {
        createdAt: new Date().toISOString(),
        kind: "browse_entries",
        basePath: typeof only.path === "string" ? only.path : null,
        entries: entries.slice(0, 40).map((entry: Record<string, unknown>, index) => ({
          index: index + 1,
          name: typeof entry.name === "string" ? entry.name : `Entry ${index + 1}`,
          path: buildBrowseEntryPath(String(only.path ?? ""), entry),
          type:
            entry.type === "directory" ? "directory" : entry.type === "file" ? "file" : "unknown",
        })),
      });
      return {
        kind: "text",
        text: [`Contents of \`${only.path}\`:`]
          .concat(
            entries.length > 0
              ? entries.slice(0, 40).map((entry: Record<string, unknown>, index) => {
                  const name = typeof entry.name === "string" ? entry.name : "unknown";
                  const type = entry.type === "directory" ? "/" : "";
                  return `${index + 1}. ${name}${type}`;
                })
              : ["- empty"],
          )
          .join("\n"),
      };
    }
    await clearDirectRecentContext(params.sessionKey);
    return { kind: "text", text: [`I found multiple matching folders for \`${activeIntent.query}\`:`]
      .concat(deduped.slice(0, 10).map((entry, index) => `${index + 1}. \`${entry.path}\``))
      .concat(["Reply with the exact path you want to browse next."])
      .join("\n") };
  }
  if (activeIntent.kind === "find") {
    const rootsResult = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-find-roots-${Date.now()}`,
      operation: "config.allowed_roots.list",
      arguments: {},
      actor,
    });
    const allowedRoots = Array.isArray(rootsResult?.result?.roots)
      ? rootsResult.result.roots.filter((entry: unknown) => typeof entry === "string" && entry.trim())
      : [];
    const scopedRoots = activeIntent.rootAlias
      ? allowedRoots.filter((entry: string) => {
          const normalized = entry.toLowerCase();
          return (
            normalized.includes(`/${activeIntent.rootAlias}`) ||
            normalized.endsWith(`/${activeIntent.rootAlias}`) ||
            normalized === activeIntent.rootAlias
          );
        })
      : allowedRoots;
    const rootsToSearch =
      scopedRoots.length > 0 ? scopedRoots : activeIntent.rootAlias ? [activeIntent.rootAlias] : allowedRoots;
    const combinedResults: Array<Record<string, unknown>> = [];
    for (const root of rootsToSearch) {
      const searchResult = await callPcControlBridgeDirect(params.config, {
        request_id: `telegram-find-${Date.now()}-${String(root).replace(/[^a-z0-9]+/gi, "-")}`,
        operation: "fs.search",
        arguments: {
          root,
          pattern: `*${activeIntent.query}*`,
          limit: 20,
        },
        actor,
      });
      const entries = Array.isArray(searchResult?.result?.results) ? searchResult.result.results : [];
      combinedResults.push(...entries);
    }
    const ranked = combinedResults
      .filter((entry) => typeof entry?.path === "string" && entry.path.trim())
      .map((entry) => ({ ...entry, score: scoreSearchResult(activeIntent.query, entry) }))
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
    const deduped: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const entry of ranked) {
      const candidatePath = typeof entry.path === "string" ? entry.path : "";
      if (!candidatePath || seen.has(candidatePath)) {
        continue;
      }
      seen.add(candidatePath);
      deduped.push(entry);
      if (deduped.length >= 5) {
        break;
      }
    }
    if (deduped.length === 0) {
      await clearDirectRecentContext(params.sessionKey);
      return {
        kind: "text",
        text: formatNoMatchInAllowedRootsReply("file", activeIntent.query, rootsToSearch.map(String)),
      };
    }
    await saveDirectRecentContext(params.sessionKey, {
      createdAt: new Date().toISOString(),
      kind: "find_results",
      basePath: activeIntent.rootAlias,
      entries: deduped.map((entry, index) => ({
        index: index + 1,
        name: path.basename(String(entry.path ?? `Result ${index + 1}`)),
        path: String(entry.path ?? ""),
        type:
          entry.type === "directory" ? "directory" : entry.type === "file" ? "file" : "unknown",
      })),
    });
    return { kind: "text", text: formatFindReply(activeIntent.query, deduped) };
  }
  if (activeIntent.kind === "send_file") {
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-send-file-${Date.now()}`,
      operation: "fs.stage_for_telegram",
      arguments: { path: activeIntent.path },
      actor,
    });
    const mediaPaths = extractMediaPathsFromBridgeResult(params.config, result.result ?? {});
    if (mediaPaths.length === 0) {
      throw new Error("pc-control send file returned no media path");
    }
    return {
      kind: "media",
      mediaPaths,
      caption: `Sending \`${activeIntent.label}\``,
    };
  }
  if (activeIntent.kind === "rename_path") {
    if (!params.config.allowWriteOperations) {
      throw new Error("pc-control write operations are not enabled");
    }
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-rename-${Date.now()}`,
      operation: "fs.move",
      arguments: {
        source: activeIntent.source,
        destination: activeIntent.destination,
      },
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: result?.result?.destination
        ? `Renamed \`${activeIntent.label}\` to \`${path.basename(String(result.result.destination))}\`.`
        : `Renamed \`${activeIntent.label}\` to \`${path.basename(activeIntent.destination)}\`.`,
    };
  }
  if (activeIntent.kind === "move_path") {
    if (!params.config.allowWriteOperations) {
      throw new Error("pc-control write operations are not enabled");
    }
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-move-${Date.now()}`,
      operation: "fs.move",
      arguments: {
        source: activeIntent.source,
        destination: activeIntent.destination,
      },
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: result?.result?.destination
        ? `Moved \`${activeIntent.label}\` to \`${String(result.result.destination)}\`.`
        : `Moved \`${activeIntent.label}\` to \`${activeIntent.destination}\`.`,
    };
  }
  if (activeIntent.kind === "move_paths") {
    if (!params.config.allowWriteOperations) {
      throw new Error("pc-control write operations are not enabled");
    }
    let lastDestination: string | null = null;
    for (const item of activeIntent.items) {
      const result = await callPcControlBridgeDirect(params.config, {
        request_id: `telegram-move-${Date.now()}`,
        operation: "fs.move",
        arguments: {
          source: item.source,
          destination: item.destination,
        },
        actor,
      });
      lastDestination =
        typeof result?.result?.destination === "string" && result.result.destination.trim()
          ? result.result.destination
          : item.destination;
    }
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: `Moved ${activeIntent.items.length} entries to \`${path.posix.dirname(lastDestination ?? activeIntent.items[0]?.destination ?? ".")}\`.`,
    };
  }
  if (activeIntent.kind === "quarantine_path") {
    if (!params.config.allowWriteOperations) {
      throw new Error("pc-control write operations are not enabled");
    }
    const result = await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-quarantine-${Date.now()}`,
      operation: "fs.quarantine",
      arguments: {
        path: activeIntent.path,
      },
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: result?.result?.destination
        ? `Quarantined \`${activeIntent.label}\` at \`${String(result.result.destination)}\` instead of permanently deleting it.`
        : `Quarantined \`${activeIntent.label}\` instead of permanently deleting it.`,
    };
  }
  if (activeIntent.kind === "quarantine_paths") {
    if (!params.config.allowWriteOperations) {
      throw new Error("pc-control write operations are not enabled");
    }
    for (const item of activeIntent.items) {
      await callPcControlBridgeDirect(params.config, {
        request_id: `telegram-quarantine-${Date.now()}`,
        operation: "fs.quarantine",
        arguments: {
          path: item.path,
        },
        actor,
      });
    }
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: `Quarantined ${activeIntent.items.length} entries instead of permanently deleting them.`,
    };
  }
  if (activeIntent.kind === "mkdir_path") {
    if (!params.config.allowWriteOperations) {
      throw new Error("pc-control write operations are not enabled");
    }
    await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-mkdir-${Date.now()}`,
      operation: "fs.mkdir",
      arguments: { path: activeIntent.path },
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: `Created folder \`${activeIntent.label}\` at \`${activeIntent.path}\`.`,
    };
  }
  if (activeIntent.kind === "add_allowed_root") {
    if (!params.config.allowAdminOperations) {
      throw new Error("pc-control admin operations are not enabled");
    }
    await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-add-root-${Date.now()}`,
      operation: "config.allowed_roots.add",
      arguments: { root: activeIntent.root },
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: `Added \`${activeIntent.root}\` to allowed roots.`,
    };
  }
  if (activeIntent.kind === "remove_allowed_root") {
    if (!params.config.allowAdminOperations) {
      throw new Error("pc-control admin operations are not enabled");
    }
    await callPcControlBridgeDirect(params.config, {
      request_id: `telegram-remove-root-${Date.now()}`,
      operation: "config.allowed_roots.remove",
      arguments: { root: activeIntent.root },
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: `Removed \`${activeIntent.root}\` from allowed roots.`,
    };
  }
  if (activeIntent.kind === "self_heal") {
    if (!params.config.allowAdminOperations) {
      throw new Error("pc-control admin operations are not enabled");
    }
    await callPcControlRecoveryDirect(params.config, {
      request_id: `telegram-self-heal-${Date.now()}`,
      action: activeIntent.action,
      arguments: {},
      actor,
    });
    await clearDirectRecentContext(params.sessionKey);
    return {
      kind: "text",
      text: `Requested self-heal action \`${activeIntent.action}\`.`,
    };
  }
  return { kind: "text", text: "" };
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

type ForcedReadParams = ForcedScreenshotParams;

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

export async function tryHandleForcedPcControlReadTelegram(
  params: ForcedReadParams,
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
  if (isGroup) {
    return false;
  }
  const intentText = normalizeTelegramIntentLine(
    resolveTelegramPcControlIntentText({
      ctxPayload,
      msg: {
        text: msg.text,
        caption: msg.caption,
      },
    }),
  );
  if (looksLikeNonPcControlEscape(intentText)) {
    return false;
  }
  const pcControlConfig = resolvePcControlTelegramConfig(cfg);
  if (!pcControlConfig) {
    return false;
  }
  const recentContext = await loadDirectRecentContext(ctxPayload.SessionKey);
  const actor = {
    channel: "telegram",
    session_key: typeof ctxPayload.SessionKey === "string" ? ctxPayload.SessionKey : null,
    sender_id: ctxPayload.From ?? null,
  };
  const intent = await parseDirectReadIntent(intentText, recentContext, pcControlConfig, actor);
  const pendingProposal = await loadDirectReadProposal(ctxPayload.SessionKey);
  const isAffirmativeFollowup = isAffirmativePcControlText(intentText);
  const shouldHandleReadOnlyPcControl =
    intent !== null || (Boolean(pendingProposal) && isAffirmativeFollowup);
  if (!shouldHandleReadOnlyPcControl) {
    return false;
  }
  if (isAffirmativeFollowup) {
    if (!pendingProposal) {
      const result = await deliverReplies({
        ...deliveryBaseOptions,
        replies: [
          {
            text:
              "There is no pending pc-control action to run. Ask for a specific search, browse, send, rename, allowed-roots, or health action first.",
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
  } else {
    if (!intent) {
      const result = await deliverReplies({
        ...deliveryBaseOptions,
        replies: [
          {
            text:
              "I can keep this accurate if you name a specific pc-control action first. Ask to search, browse, send a selected file, rename, move, quarantine or delete a numbered entry, list allowed roots, show drives, or run a health check.",
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
    const proposalId = createDirectReadProposalId();
    await saveDirectReadProposal(ctxPayload.SessionKey, {
      proposalId,
      createdAt: new Date().toISOString(),
      intent,
      originalText: intentText,
      originalSessionKey: typeof ctxPayload.SessionKey === "string" ? ctxPayload.SessionKey : null,
      originalSenderId:
        typeof ctxPayload.From === "string" ? ctxPayload.From : ctxPayload.From != null ? String(ctxPayload.From) : null,
    });
    const result = await deliverReplies({
      ...deliveryBaseOptions,
      replies: [
        {
          text: `${describeDirectReadProposal(intent)} Use the button to continue, or refine your request.`,
          channelData: {
            telegram: {
              buttons: [
                [
                  { text: "Proceed", callback_data: `pcctl:proceed:${proposalId}`, style: "success" },
                  { text: "Cancel", callback_data: `pcctl:cancel:${proposalId}`, style: "danger" },
                ],
              ],
            },
          },
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
    // Ignore typing failures.
  }
  try {
    const activeIntent = pendingProposal?.intent;
    if (!activeIntent) {
      throw new Error("Missing pending direct read proposal");
    }
    const execution = await executeDirectReadIntent({
      config: pcControlConfig,
      intent: activeIntent,
      sessionKey: typeof ctxPayload.SessionKey === "string" ? ctxPayload.SessionKey : null,
      senderId: ctxPayload.From ?? null,
    });
    const replies =
      execution.kind === "media"
        ? [
            execution.mediaPaths.length === 1
              ? {
                  mediaUrl: execution.mediaPaths[0],
                  channelData: { telegram: { forceDocument: true } },
                }
              : {
                  mediaUrls: execution.mediaPaths,
                  channelData: { telegram: { forceDocument: true } },
                },
          ]
        : [{ text: execution.text }];
    const result = await deliverReplies({
      ...deliveryBaseOptions,
      replies,
    });
    if (!result.delivered) {
      throw new Error("Telegram direct pc-control reply was not accepted");
    }
    await clearDirectReadProposal(ctxPayload.SessionKey);
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
    runtime.error?.(danger(`telegram forced pc-control read dispatch failed: ${String(err)}`));
    await clearDirectReadProposal(ctxPayload.SessionKey);
    const result = await deliverReplies({
      ...deliveryBaseOptions,
      replies: [
        {
          text: "I couldn't complete that pc-control request directly right now.",
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

export async function handleForcedPcControlReadCallback(params: {
  action: "proceed" | "cancel";
  proposalId?: string | null;
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  sessionKey: string;
  senderId?: string | null;
  chatId: string | number;
  messageId: number;
  reply: (text: string) => Promise<unknown>;
  replyMedia: (mediaPaths: string[]) => Promise<unknown>;
  editMessage: (text: string, buttons?: Array<Array<{ text: string; callback_data: string; style?: "danger" | "success" | "primary" }>>) => Promise<unknown>;
  clearButtons: () => Promise<unknown>;
}): Promise<boolean> {
  const pcControlConfig = resolvePcControlTelegramConfig(params.cfg);
  if (!pcControlConfig) {
    return false;
  }
  const proposal =
    (params.proposalId
      ? await loadDirectReadProposalById(params.sessionKey, params.proposalId)
      : null) ?? (await loadDirectReadProposal(params.sessionKey));
  if (!proposal) {
    await params.editMessage("There is no pending pc-control action for this button.");
    return true;
  }
  if (params.action === "cancel") {
    if (params.proposalId) {
      await clearDirectReadProposalById(params.sessionKey, params.proposalId);
    } else {
      await clearDirectReadProposal(params.sessionKey);
    }
    await params.editMessage("Cancelled the pending pc-control action.");
    return true;
  }
  try {
    const execution = await executeDirectReadIntent({
      config: pcControlConfig,
      intent: proposal.intent,
      sessionKey: proposal.originalSessionKey ?? params.sessionKey,
      senderId: proposal.originalSenderId ?? params.senderId ?? null,
    });
    if (execution.kind === "media") {
      await params.replyMedia(execution.mediaPaths);
    } else {
      await params.reply(execution.text);
    }
    if (params.proposalId) {
      await clearDirectReadProposalById(params.sessionKey, params.proposalId);
    } else {
      await clearDirectReadProposal(params.sessionKey);
    }
    await params.clearButtons();
    return true;
  } catch (err) {
    params.runtime.error?.(danger(`telegram forced pc-control callback dispatch failed: ${String(err)}`));
    if (params.proposalId) {
      await clearDirectReadProposalById(params.sessionKey, params.proposalId);
    } else {
      await clearDirectReadProposal(params.sessionKey);
    }
    await params.editMessage("I couldn't complete that pc-control action from the button.");
    return true;
  }
}
