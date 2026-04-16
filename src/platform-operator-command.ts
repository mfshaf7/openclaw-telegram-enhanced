export const PLATFORM_OPERATOR_COMMAND = {
  command: "platform",
  description: "Platform endpoints, health, and governance notes",
} as const;

type PlatformOperatorSurface = {
  id: string;
  label: string;
  category?: string;
  currentState?: string;
  operatorUrl?: string;
  wslFallback?: string;
  credentialSource?: string;
  healthChecks?: string[];
  troubleshootingNotes?: string[];
};

type PlatformGovernanceItem = {
  id: string;
  label: string;
  detail: string;
};

type PlatformOperatorCatalog = {
  schemaVersion?: number;
  title?: string;
  lastReviewed?: string;
  surfaces?: PlatformOperatorSurface[];
  governance?: PlatformGovernanceItem[];
};

type PlatformOperatorReply = {
  text: string;
  isError?: boolean;
};

const CATALOG_ENV = "OPENCLAW_PLATFORM_OPERATOR_CATALOG_JSON";

function loadPlatformOperatorCatalog(): PlatformOperatorCatalog | null {
  const raw = process.env[CATALOG_ENV]?.trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as PlatformOperatorCatalog;
    if (!parsed || !Array.isArray(parsed.surfaces)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function currentRuntimeSummaryLines(): string[] {
  return [
    `Environment: ${process.env.OPENCLAW_ENV?.trim() || "unknown"}`,
    `Telegram SHA: ${process.env.OPENCLAW_TELEGRAM_SHA?.trim() || "unknown"}`,
    `Host bridge SHA: ${process.env.OPENCLAW_HOST_BRIDGE_SHA?.trim() || "unknown"}`,
    `Platform SHA: ${process.env.OPENCLAW_PLATFORM_SHA?.trim() || "unknown"}`,
  ];
}

function compactSurfaces(catalog: PlatformOperatorCatalog): PlatformOperatorSurface[] {
  return Array.isArray(catalog.surfaces) ? catalog.surfaces : [];
}

function compactGovernance(catalog: PlatformOperatorCatalog): PlatformGovernanceItem[] {
  return Array.isArray(catalog.governance) ? catalog.governance : [];
}

function renderOverview(catalog: PlatformOperatorCatalog): string {
  const surfaces = compactSurfaces(catalog);
  const governance = compactGovernance(catalog);
  const lines = [
    `${catalog.title || "Platform operator catalog"}`,
    ...currentRuntimeSummaryLines(),
    "",
    "Use `/platform endpoints`, `/platform health`, `/platform govern`, or `/platform <component>`.",
    "",
    "Surfaces:",
    ...surfaces.map(
      (surface) =>
        `- ${surface.id}: ${surface.label} (${surface.currentState || "unknown"})`,
    ),
  ];
  if (governance.length > 0) {
    lines.push("", "Governance:");
    lines.push(...governance.map((item) => `- ${item.label}: ${item.detail}`));
  }
  return lines.join("\n");
}

function renderEndpoints(catalog: PlatformOperatorCatalog): string {
  const lines = ["Platform endpoints:"];
  for (const surface of compactSurfaces(catalog)) {
    lines.push(`- ${surface.label} [${surface.id}]`);
    lines.push(`  State: ${surface.currentState || "unknown"}`);
    lines.push(`  Operator URL: ${surface.operatorUrl || "none"}`);
    lines.push(`  WSL fallback: ${surface.wslFallback || "none"}`);
    if (surface.credentialSource) {
      lines.push(`  Credential source: ${surface.credentialSource}`);
    }
  }
  return lines.join("\n");
}

function renderHealth(catalog: PlatformOperatorCatalog): string {
  const lines = ["Platform health and troubleshooting checks:"];
  for (const surface of compactSurfaces(catalog)) {
    lines.push(`- ${surface.label} [${surface.id}]`);
    for (const check of surface.healthChecks ?? []) {
      lines.push(`  - ${check}`);
    }
    for (const note of surface.troubleshootingNotes ?? []) {
      lines.push(`  - Note: ${note}`);
    }
  }
  return lines.join("\n");
}

function renderGovernance(catalog: PlatformOperatorCatalog): string {
  const lines = ["Platform governance notes:", ...currentRuntimeSummaryLines()];
  for (const item of compactGovernance(catalog)) {
    lines.push(`- ${item.label}: ${item.detail}`);
  }
  return lines.join("\n");
}

function findSurface(catalog: PlatformOperatorCatalog, token: string): PlatformOperatorSurface | null {
  const lowered = token.trim().toLowerCase();
  if (!lowered) {
    return null;
  }
  return (
    compactSurfaces(catalog).find(
      (surface) =>
        surface.id.toLowerCase() === lowered || surface.label.toLowerCase() === lowered,
    ) ?? null
  );
}

function renderSurface(surface: PlatformOperatorSurface): string {
  const lines = [
    `${surface.label} [${surface.id}]`,
    `Category: ${surface.category || "unknown"}`,
    `State: ${surface.currentState || "unknown"}`,
    `Operator URL: ${surface.operatorUrl || "none"}`,
    `WSL fallback: ${surface.wslFallback || "none"}`,
    `Credential source: ${surface.credentialSource || "none"}`,
  ];
  if ((surface.healthChecks?.length ?? 0) > 0) {
    lines.push("Health checks:");
    for (const check of surface.healthChecks ?? []) {
      lines.push(`- ${check}`);
    }
  }
  if ((surface.troubleshootingNotes?.length ?? 0) > 0) {
    lines.push("Troubleshooting notes:");
    for (const note of surface.troubleshootingNotes ?? []) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join("\n");
}

export function buildPlatformOperatorReply(rawArgs: string | undefined): PlatformOperatorReply {
  const catalog = loadPlatformOperatorCatalog();
  if (!catalog) {
    return {
      isError: true,
      text:
        "Platform operator catalog is not configured in this runtime. Check OPENCLAW_PLATFORM_OPERATOR_CATALOG_JSON in the gateway environment values.",
    };
  }

  const trimmed = rawArgs?.trim() || "";
  if (!trimmed || /^(help|summary|overview)$/i.test(trimmed)) {
    return { text: renderOverview(catalog) };
  }
  if (/^(endpoints|interfaces?)$/i.test(trimmed)) {
    return { text: renderEndpoints(catalog) };
  }
  if (/^(health|checks?)$/i.test(trimmed)) {
    return { text: renderHealth(catalog) };
  }
  if (/^(govern|governance|release|troubleshoot)$/i.test(trimmed)) {
    return { text: renderGovernance(catalog) };
  }

  const componentToken = trimmed.replace(/^component\s+/i, "");
  const surface = findSurface(catalog, componentToken);
  if (!surface) {
    return {
      isError: true,
      text:
        `Unknown platform component: ${trimmed}. Use /platform, /platform endpoints, /platform health, /platform govern, or /platform <component>.`,
    };
  }
  return { text: renderSurface(surface) };
}
