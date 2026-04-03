import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { collectArtifactIntegrityAndPromotionEvidence } from "./modules/artifact-integrity-and-promotion.js";
import { collectHostControlBoundaryEvidence } from "./modules/host-control-boundary.js";
import { collectIdentityAndApprovalBoundaryEvidence } from "./modules/identity-and-approval-boundary.js";
import { collectNetworkExposureEvidence } from "./modules/network-exposure.js";
import { collectRestartResilienceAndDriftEvidence } from "./modules/restart-resilience-and-drift.js";
import { collectRoutingAndAgentSurfaceEvidence } from "./modules/routing-and-agent-surface.js";
import { collectRuntimeDependencyChainEvidence } from "./modules/runtime-dependency-chain.js";
import { collectSecretDeliveryAndTrustRootEvidence } from "./modules/secret-delivery-and-trust-root.js";
import { collectStorageScopeEvidence } from "./modules/storage-scope.js";
import { resolveSecurityEvidenceModules, summarizeSecurityQuestionScope } from "./question-scope.js";
import type {
  SecurityBridgeConfig,
  SecurityBridgeHealth,
  SecurityEvidenceBundle,
  SecurityEvidenceCollectorContext,
  SecurityEvidenceModuleId,
  SecurityEvidenceModuleResult,
} from "./types.js";
import { DEFAULT_HOST_CONTROL_AUTH_TOKEN_ENV } from "./types.js";

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

const MODULE_COLLECTORS: Record<
  SecurityEvidenceModuleId,
  (ctx: SecurityEvidenceCollectorContext) => Promise<SecurityEvidenceModuleResult>
> = {
  "artifact-integrity-and-promotion": collectArtifactIntegrityAndPromotionEvidence,
  "host-control-boundary": collectHostControlBoundaryEvidence,
  "identity-and-approval-boundary": collectIdentityAndApprovalBoundaryEvidence,
  "network-exposure": collectNetworkExposureEvidence,
  "restart-resilience-and-drift": collectRestartResilienceAndDriftEvidence,
  "routing-and-agent-surface": collectRoutingAndAgentSurfaceEvidence,
  "runtime-dependency-chain": collectRuntimeDependencyChainEvidence,
  "secret-delivery-and-trust-root": collectSecretDeliveryAndTrustRootEvidence,
  "storage-scope": collectStorageScopeEvidence,
};

export async function buildSecurityEvidenceBundle(params: {
  cfg: OpenClawConfig;
  chatId: string;
  originalText: string;
}): Promise<SecurityEvidenceBundle> {
  const assessmentScope = summarizeSecurityQuestionScope(params.originalText);
  const evidenceModules = resolveSecurityEvidenceModules(params.originalText);
  const bridgeConfig = resolveSecurityBridgeConfig(params.cfg);
  const bridgeHealth: SecurityBridgeHealth = bridgeConfig
    ? await callSecurityBridgeHealth(bridgeConfig).catch(() => null)
    : null;
  const ctx: SecurityEvidenceCollectorContext = {
    cfg: params.cfg,
    chatId: params.chatId,
    originalText: params.originalText,
    bridgeConfig,
    bridgeHealth,
  };

  const verifiedFacts: string[] = [];
  const inferences: string[] = [];
  const unknowns: string[] = [];

  for (const moduleId of evidenceModules) {
    const result = await MODULE_COLLECTORS[moduleId](ctx);
    if (result.verifiedFacts) {
      verifiedFacts.push(...result.verifiedFacts);
    }
    if (result.inferences) {
      inferences.push(...result.inferences);
    }
    if (result.unknowns) {
      unknowns.push(...result.unknowns);
    }
  }

  return {
    type: "EVIDENCE_BUNDLE",
    question: params.originalText,
    assessment_scope: assessmentScope,
    evidence_modules: evidenceModules,
    verified_facts: verifiedFacts,
    inferences,
    unknowns,
    confidence: bridgeConfig && bridgeHealth ? "medium" : "low",
  };
}
