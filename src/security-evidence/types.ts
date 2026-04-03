import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";

export const DEFAULT_HOST_CONTROL_AUTH_TOKEN_ENV = "OPENCLAW_HOST_BRIDGE_TOKEN";

export type SecurityAssessmentScope =
  | "current-system-assessment"
  | "boundary-and-auth-assessment"
  | "runtime-dependency-assessment"
  | "architecture-judgment";

export type SecurityEvidenceModuleId =
  | "routing-and-agent-surface"
  | "host-control-boundary"
  | "identity-and-approval-boundary"
  | "network-exposure"
  | "runtime-dependency-chain"
  | "storage-scope"
  | "secret-delivery-and-trust-root"
  | "restart-resilience-and-drift"
  | "artifact-integrity-and-promotion";

export type SecurityEvidenceBundle = {
  type: "EVIDENCE_BUNDLE";
  question: string;
  assessment_scope: SecurityAssessmentScope;
  evidence_modules: SecurityEvidenceModuleId[];
  verified_facts: string[];
  inferences: string[];
  unknowns: string[];
  confidence: string;
};

export type SecurityBridgeConfig = {
  bridgeUrl: string;
  authToken: string;
  authTokenEnv: string;
};

export type SecurityBridgeHealth = Record<string, unknown> | null;

export type SecurityEvidenceModuleResult = {
  verifiedFacts?: string[];
  inferences?: string[];
  unknowns?: string[];
};

export type SecurityEvidenceCollectorContext = {
  cfg: OpenClawConfig;
  chatId: string;
  originalText: string;
  bridgeConfig: SecurityBridgeConfig | null;
  bridgeHealth: SecurityBridgeHealth;
};
