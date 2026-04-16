import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPlatformOperatorReply } from "./platform-operator-command.js";

const catalog = {
  schemaVersion: 1,
  title: "Platform operator catalog",
  surfaces: [
    {
      id: "argo-cd",
      label: "Argo CD",
      category: "control-plane",
      currentState: "live",
      operatorUrl: "https://127.0.0.1:32443",
      wslFallback: "k3s kubectl -n argocd port-forward svc/argocd-server 8443:443",
      credentialSource: "operator account",
      healthChecks: ["Argo application sync and health"],
      troubleshootingNotes: ["Self-signed certificate by default"],
    },
  ],
  governance: [
    {
      id: "promotion-gate",
      label: "Promotion gate",
      detail: "Prod promotion requires an approved stage candidate plus verification evidence.",
    },
  ],
};

describe("buildPlatformOperatorReply", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports missing runtime catalog configuration clearly", () => {
    const result = buildPlatformOperatorReply("");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Platform operator catalog is not configured");
  });

  it("renders an overview when no args are supplied", () => {
    vi.stubEnv("OPENCLAW_PLATFORM_OPERATOR_CATALOG_JSON", JSON.stringify(catalog));
    vi.stubEnv("OPENCLAW_ENV", "prod");
    vi.stubEnv("OPENCLAW_TELEGRAM_SHA", "telegram-sha");
    vi.stubEnv("OPENCLAW_HOST_BRIDGE_SHA", "bridge-sha");
    vi.stubEnv("OPENCLAW_PLATFORM_SHA", "platform-sha");

    const result = buildPlatformOperatorReply("");
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("Platform operator catalog");
    expect(result.text).toContain("Environment: prod");
    expect(result.text).toContain("argo-cd: Argo CD (live)");
    expect(result.text).toContain("Promotion gate");
  });

  it("renders component detail lookups", () => {
    vi.stubEnv("OPENCLAW_PLATFORM_OPERATOR_CATALOG_JSON", JSON.stringify(catalog));

    const result = buildPlatformOperatorReply("argo-cd");
    expect(result.text).toContain("Argo CD [argo-cd]");
    expect(result.text).toContain("Operator URL: https://127.0.0.1:32443");
    expect(result.text).toContain("Health checks:");
  });

  it("rejects unknown components with usage guidance", () => {
    vi.stubEnv("OPENCLAW_PLATFORM_OPERATOR_CATALOG_JSON", JSON.stringify(catalog));

    const result = buildPlatformOperatorReply("ghost");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Unknown platform component: ghost");
    expect(result.text).toContain("/platform endpoints");
  });
});
