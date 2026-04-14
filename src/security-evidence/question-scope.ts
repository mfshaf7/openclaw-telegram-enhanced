import type { SecurityAssessmentScope, SecurityEvidenceModuleId } from "./types.js";

function looksLikeBroadCurrentSystemReview(text: string): boolean {
  const hasAssessmentVerb =
    /\b(check|assess|assessment|evaluate|evaluation|review|audit|judge|inspect|analyze|analyse)\b/.test(
      text,
    ) || /\bsecurity posture\b/.test(text);
  const hasCurrentSystemQualifier =
    /\b(current|this|overall|real|live|entire|whole|full|complete|my)\b/.test(text) &&
    /\b(system|setup|deployment|architecture|environment)\b/.test(text);
  const hasSecurityIntent =
    /\b(security|secure|posture|risk|risky|trust boundary|good enough|acceptable|sound)\b/.test(
      text,
    );
  return hasAssessmentVerb && hasCurrentSystemQualifier && hasSecurityIntent;
}

export function summarizeSecurityQuestionScope(originalText: string): SecurityAssessmentScope {
  const text = originalText.toLowerCase();
  const asksForCurrentAssessment =
    looksLikeBroadCurrentSystemReview(text) ||
    (/\b(is)\b/.test(text) &&
      /\b(current|this|overall|real|live)\b/.test(text) &&
      /\b(system|setup|deployment|architecture|environment)\b/.test(text) &&
      /\b(security|secure|posture|risk|risky|trust boundary|good enough|acceptable|sound)\b/.test(
        text,
      ));
  if (asksForCurrentAssessment) {
    return "current-system-assessment";
  }
  if (/\b(trust boundary|boundaries|auth|authorization|authentication)\b/.test(text)) {
    return "boundary-and-auth-assessment";
  }
  if (/\b(ollama|llm|model|inference|runtime)\b/.test(text)) {
    return "runtime-dependency-assessment";
  }
  return "architecture-judgment";
}

export function resolveSecurityEvidenceModules(
  originalText: string,
): SecurityEvidenceModuleId[] {
  const text = originalText.toLowerCase();
  const modules = new Set<SecurityEvidenceModuleId>();

  modules.add("routing-and-agent-surface");

  const asksForCurrentAssessment =
    /\b(current|this|overall|real|live)\b/.test(text) &&
    /\b(system|setup|deployment|architecture|environment)\b/.test(text);
  const asksForBoundaryOrRisk =
    /\b(security|secure|risk|risky|sound|acceptable|good enough|trust boundary|design)\b/.test(
      text,
    );
  if (asksForCurrentAssessment || asksForBoundaryOrRisk) {
    modules.add("host-control-boundary");
    modules.add("identity-and-approval-boundary");
    modules.add("network-exposure");
    modules.add("runtime-dependency-chain");
    modules.add("secret-delivery-and-trust-root");
    modules.add("restart-resilience-and-drift");
    modules.add("artifact-integrity-and-promotion");
  }
  if (/\b(trust boundary|boundaries|auth|authorization|authentication|allowlist|approval)\b/.test(text)) {
    modules.add("identity-and-approval-boundary");
  }
  if (/\b(network|exposure|port|portproxy|host.docker.internal|bridge url|listen)\b/.test(text)) {
    modules.add("network-exposure");
  }
  if (/\b(ollama|llm|model|inference|runtime)\b/.test(text)) {
    modules.add("runtime-dependency-chain");
  }
  if (/\b(storage|filesystem|allowed roots|host access|browse)\b/.test(text)) {
    modules.add("storage-scope");
  }
  if (/\b(secret|vault|credential|token|trust root)\b/.test(text)) {
    modules.add("secret-delivery-and-trust-root");
  }
  if (/\b(restart|restart-survival|recovery|drift)\b/.test(text)) {
    modules.add("restart-resilience-and-drift");
  }
  if (/\b(promote|promotion|artifact|digest|image|revision|sha)\b/.test(text)) {
    modules.add("artifact-integrity-and-promotion");
  }

  return [...modules];
}

export function shouldRunSecurityEvidenceOrchestration(params: {
  agentId: string;
  text: string;
}): boolean {
  if (params.agentId !== "security-architecture") {
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
  const looksLikeAssessmentRequest = looksLikeBroadCurrentSystemReview(text);
  const looksLikeCurrentSetupQuestion =
    /\b(current|this)\b/.test(text) &&
    /\b(setup|deployment|architecture|system)\b/.test(text) &&
    /\b(security|secure|sound|risk|trust boundary|good enough|ok)\b/.test(text);
  const looksLikeArchitectureJudgmentQuestion =
    /\b(architecture|trust boundary|design|deployment)\b/.test(text) &&
    /\b(sound|secure|security|risky|wrong|acceptable|good enough|ok)\b/.test(text);
  return (
    looksLikeAssessmentRequest ||
    looksLikeCurrentSetupQuestion ||
    looksLikeArchitectureJudgmentQuestion
  );
}
