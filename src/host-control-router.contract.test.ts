import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/channel-feedback", () => ({
  logAckFailure: vi.fn(),
  removeAckReactionAfterReply: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  danger: (value: string) => value,
  logVerbose: vi.fn(),
}));

vi.mock("./bot/delivery.js", () => ({
  deliverReplies: vi.fn(),
}));

const {
  HOST_CONTROL_DIRECT_READ_CALLBACK_PREFIXES,
  HOST_CONTROL_ROUTER_CONTRACT,
  extractGeneralQuery,
  handleForcedHostControlReadCallback,
  looksLikeHostScopedFindText,
  looksLikeNonHostControlEscape,
  matchHostControlProposalCallbackData,
  parseDirectReadIntent,
} = await import("./bot-message-dispatch.host-control");

const manifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "contracts", "interface-manifest.json"), "utf8"),
);

function makeBridgeConfig() {
  return {
    bridgeUrl: "http://bridge.local:48721",
    authTokenEnv: "OPENCLAW_HOST_BRIDGE_TOKEN",
    recoveryUrl: "http://bridge.local:48722",
    recoveryAuthTokenEnv: "OPENCLAW_HOST_BRIDGE_TOKEN",
    timeoutMs: 10_000,
    recoveryTimeoutMs: 20_000,
    operationTimeoutsMs: {},
    allowWriteOperations: false,
    allowAdminOperations: false,
    allowExportOperations: true,
  };
}

function makeOpenClawConfig() {
  return {
    plugins: {
      entries: {
        "host-control": {
          config: {
            bridgeUrl: "http://bridge.local:48721",
            authTokenEnv: "OPENCLAW_HOST_BRIDGE_TOKEN",
            allowExportOperations: true,
          },
        },
      },
    },
  };
}

function proposalStorePath(homeDir: string, sessionKey: string) {
  const agentId = /^agent:([^:]+):/.exec(sessionKey)?.[1];
  if (!agentId) {
    throw new Error(`Unable to infer agent id from session key ${sessionKey}`);
  }
  return path.join(
    homeDir,
    ".openclaw",
    "agents",
    agentId,
    "sessions",
    "host-control-direct-proposals.json",
  );
}

describe("host-control router contract", () => {
  const originalHome = process.env.HOME;
  const originalToken = process.env.OPENCLAW_HOST_BRIDGE_TOKEN;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalToken == null) {
      delete process.env.OPENCLAW_HOST_BRIDGE_TOKEN;
    } else {
      process.env.OPENCLAW_HOST_BRIDGE_TOKEN = originalToken;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("matches the published manifest surface", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.contractId).toBe("openclaw-telegram-host-control-router.v1");
    expect(manifest.ownerRepo).toBe("openclaw-telegram-enhanced");
    expect(HOST_CONTROL_ROUTER_CONTRACT).toEqual(manifest.hostControlReadRouting);
    expect(HOST_CONTROL_DIRECT_READ_CALLBACK_PREFIXES).toEqual(
      manifest.hostControlReadRouting.callbackPrefixes,
    );
  });

  it("keeps explicit non-host-control escape phrases active", () => {
    for (const phrase of manifest.hostControlReadRouting.escapePhrases) {
      expect(looksLikeNonHostControlEscape(phrase)).toBe(true);
    }
  });

  it("keeps the generic find-query fallback gated behind host-scoped intent", async () => {
    const actor = { session_key: "agent:host-control:telegram:main", sender_id: "1337" };
    const config = makeBridgeConfig();
    const unscopedText = "find my latest resume pdf please";
    const scopedText = "search for my latest resume pdf in downloads";

    expect(extractGeneralQuery(unscopedText)).toBeTruthy();
    expect(looksLikeHostScopedFindText(unscopedText)).toBe(false);
    expect(
      looksLikeHostScopedFindText(unscopedText) ? extractGeneralQuery(unscopedText) : null,
    ).toBeNull();

    expect(extractGeneralQuery(scopedText)).toBeTruthy();
    expect(looksLikeHostScopedFindText(scopedText)).toBe(true);
    expect(
      looksLikeHostScopedFindText(scopedText) ? extractGeneralQuery(scopedText) : null,
    ).toBeTruthy();

    expect(await parseDirectReadIntent(unscopedText, null, config, actor)).not.toBeNull();

    const scoped = await parseDirectReadIntent(
      "find my latest resume pdf in downloads",
      null,
      config,
      actor,
    );
    expect(scoped?.kind).toBe("find");
    expect(scoped?.rootAlias).toBe("downloads");

    expect(
      await parseDirectReadIntent("what about my latest resume pdf in downloads", null, config, actor),
    ).toBeNull();
  });

  it("keeps persisted proposal callbacks and clearButtons behavior aligned", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-host-control-contract-"));
    const sessionKey = "agent:host-control:telegram:callback";
    const proposalId = "proposal-123";
    const storePath = proposalStorePath(tempHome, sessionKey);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          [sessionKey]: {
            proposalId,
            createdAt: new Date().toISOString(),
            intent: { kind: "allowed_roots" },
            originalText: "show allowed roots",
            originalSessionKey: sessionKey,
            originalSenderId: "1337",
          },
        },
        null,
        2,
      ),
    );

    process.env.HOME = tempHome;
    process.env.OPENCLAW_HOST_BRIDGE_TOKEN = "token";

    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.operation).toBe("config.allowed_roots.list");
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            result: {
              roots: ["desktop", "downloads"],
            },
          };
        },
      } as Response;
    });

    const reply = vi.fn(async (_text: string) => {});
    const clearButtons = vi.fn(async () => {});
    const editMessage = vi.fn(async (_text: string) => {});
    const replyMedia = vi.fn(async (_mediaPaths: string[]) => {});

    const callback = matchHostControlProposalCallbackData(
      `${HOST_CONTROL_DIRECT_READ_CALLBACK_PREFIXES.proceed}${proposalId}`,
    );
    expect(callback).toEqual({ action: "proceed", proposalId });

    const handled = await handleForcedHostControlReadCallback({
      action: callback?.action ?? "proceed",
      proposalId: callback?.proposalId ?? null,
      cfg: makeOpenClawConfig(),
      runtime: { error: vi.fn() },
      sessionKey,
      senderId: "1337",
      chatId: "chat-1",
      messageId: 1,
      reply,
      replyMedia,
      editMessage,
      clearButtons,
    });

    expect(handled).toBe(true);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(clearButtons).toHaveBeenCalledTimes(1);
    expect(editMessage).not.toHaveBeenCalled();
    const stored = JSON.parse(fs.readFileSync(storePath, "utf8"));
    expect(
      Object.values(stored).find((entry: any) => entry?.proposalId === proposalId),
    ).toBeUndefined();
  });
});
