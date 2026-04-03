import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { asObject, pushFact } from "../shared.js";

export async function collectHostControlBoundaryEvidence(
  ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  const inferences: string[] = [];
  const unknowns: string[] = [];

  if (!ctx.bridgeConfig) {
    unknowns.push("The current runtime did not expose a usable host-control bridge configuration.");
    return { verifiedFacts, inferences, unknowns };
  }

  pushFact(verifiedFacts, "host-control.bridge.url", ctx.bridgeConfig.bridgeUrl);
  pushFact(verifiedFacts, "host-control.bridge.authTokenEnv", ctx.bridgeConfig.authTokenEnv);

  const components = asObject(ctx.bridgeHealth?.components);
  const bridge = asObject(components?.bridge);
  if (bridge) {
    pushFact(verifiedFacts, "bridge.health.ok", String(bridge.ok === true));
    if (typeof bridge.mode === "string" && bridge.mode) {
      pushFact(verifiedFacts, "bridge.mode", bridge.mode);
    }
  } else {
    unknowns.push("Bridge health facts could not be read from the current bridge response.");
  }

  const integrations = asObject(components?.integrations);
  const gateway = asObject(integrations?.gateway);
  if (gateway) {
    pushFact(verifiedFacts, "gateway.health.ok", String(gateway.ok === true));
    if (typeof gateway.health === "string" && gateway.health) {
      pushFact(verifiedFacts, "gateway.health.status", gateway.health);
    }
  }

  const wsl = asObject(integrations?.wsl);
  if (wsl) {
    pushFact(verifiedFacts, "wsl.detected", String(wsl.detected === true));
    pushFact(verifiedFacts, "wsl.ok", String(wsl.ok === true));
  }

  pushFact(
    inferences,
    "host-ops.path",
    "Telegram host-facing actions are mediated by the host-control bridge rather than direct tool access",
  );

  return { verifiedFacts, inferences, unknowns };
}
