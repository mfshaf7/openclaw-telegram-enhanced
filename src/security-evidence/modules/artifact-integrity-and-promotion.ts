import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { pushFact } from "../shared.js";

function looksLikeCommit(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

export async function collectArtifactIntegrityAndPromotionEvidence(
  _ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  const telegramSha = process.env.OPENCLAW_TELEGRAM_SHA;
  const hostBridgeSha = process.env.OPENCLAW_HOST_BRIDGE_SHA;
  const platformSha = process.env.OPENCLAW_PLATFORM_SHA;
  if (looksLikeCommit(telegramSha)) {
    pushFact(verifiedFacts, "runtime.source.telegram_sha", telegramSha);
  }
  if (looksLikeCommit(hostBridgeSha)) {
    pushFact(verifiedFacts, "runtime.source.host_bridge_sha", hostBridgeSha);
  }
  if (looksLikeCommit(platformSha)) {
    pushFact(verifiedFacts, "runtime.source.platform_sha", platformSha);
  }
  if (verifiedFacts.length > 0) {
    pushFact(
      verifiedFacts,
      "runtime.source.bundle_pinned",
      String([telegramSha, hostBridgeSha, platformSha].every(looksLikeCommit)),
    );
  }
  return {
    verifiedFacts,
    unknowns: [
      "Image digest and promotion-approval records are not fully exposed by the current runtime unless additional deployment metadata is injected.",
    ],
  };
}
