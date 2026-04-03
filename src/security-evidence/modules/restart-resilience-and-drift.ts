import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { pushFact } from "../shared.js";

export async function collectRestartResilienceAndDriftEvidence(
  ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  if (ctx.bridgeConfig) {
    pushFact(verifiedFacts, "restart.host_bridge.configured", "true");
  }
  if (ctx.bridgeHealth) {
    pushFact(verifiedFacts, "restart.host_bridge.health_visible", "true");
  }
  pushFact(verifiedFacts, "restart.process.uptime.seconds", String(Math.floor(process.uptime())));
  return {
    verifiedFacts,
    unknowns: [
      "Restart-survival and drift-recovery evidence still depend on host/system verification outside the Telegram runtime path.",
    ],
  };
}
