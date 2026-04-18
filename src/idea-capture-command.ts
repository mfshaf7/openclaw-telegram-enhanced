export const IDEA_CAPTURE_COMMAND = {
  command: "idea",
  description: "Capture an idea into the Workspace Proposals backlog",
} as const;

const BASE_URL_ENV = "OPERATOR_ORCHESTRATION_BASE_URL";
const CALLER_ID_ENV = "OPERATOR_ORCHESTRATION_CALLER_ID";
const CALLER_SECRET_ENV = "OPERATOR_ORCHESTRATION_CALLER_SECRET";

type IdeaCaptureCommandReply = {
  text: string;
  isError?: boolean;
};

type CaptureIdeaParams = {
  accountId: string;
  chatType: string;
  messageId: number;
  rawArgs: string | undefined;
  senderId: string;
  senderUsername: string;
  telegramChatId: number;
  telegramThreadId?: number;
};

function trimEnv(name: string, env = process.env): string {
  return env[name]?.trim() ?? "";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildIdeaTitle(rawText: string): string {
  const normalized = rawText
    .split(/\r?\n/, 1)[0]
    ?.replace(/\s+/g, " ")
    .trim();
  return truncate(normalized || "Captured Telegram idea", 96);
}

export function isIdeaCaptureConfigured(env = process.env): boolean {
  return Boolean(
    trimEnv(BASE_URL_ENV, env) &&
      trimEnv(CALLER_ID_ENV, env) &&
      trimEnv(CALLER_SECRET_ENV, env),
  );
}

function loadIdeaCaptureConfig(env = process.env) {
  const baseUrl = trimEnv(BASE_URL_ENV, env).replace(/\/$/, "");
  const callerId = trimEnv(CALLER_ID_ENV, env);
  const callerSecret = trimEnv(CALLER_SECRET_ENV, env);

  if (!baseUrl || !callerId || !callerSecret) {
    return null;
  }

  return {
    baseUrl,
    callerId,
    callerSecret,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function captureIdeaThroughBroker(
  params: CaptureIdeaParams,
): Promise<IdeaCaptureCommandReply> {
  const rawText = params.rawArgs?.trim() ?? "";
  if (!rawText) {
    return {
      isError: true,
      text: "Usage: /idea <text>. Provide the idea text you want captured.",
    };
  }

  const config = loadIdeaCaptureConfig();
  if (!config) {
    return {
      isError: true,
      text:
        "Idea capture is not configured in this runtime. Check OPERATOR_ORCHESTRATION_BASE_URL, OPERATOR_ORCHESTRATION_CALLER_ID, and OPERATOR_ORCHESTRATION_CALLER_SECRET in the gateway environment.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/v1/ideas/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-oos-caller-id": config.callerId,
        "x-oos-caller-secret": config.callerSecret,
      },
      body: JSON.stringify({
        source: "telegram",
        operator: {
          id: params.senderId,
          handle: params.senderUsername,
        },
        source_ref: {
          accountId: params.accountId,
          chatId: params.telegramChatId,
          chatType: params.chatType,
          command: "idea",
          messageId: params.messageId,
          messageThreadId: params.telegramThreadId ?? null,
        },
        title: buildIdeaTitle(rawText),
        body: rawText,
      }),
    });
  } catch (error) {
    return {
      isError: true,
      text: `Idea capture request failed before reaching the broker: ${String(error)}`,
    };
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const errorCode =
      typeof payload.error === "string" && payload.error ? payload.error : `http_${response.status}`;
    const message =
      typeof payload.message === "string" && payload.message
        ? payload.message
        : "Broker rejected the idea capture request.";
    return {
      isError: true,
      text: `Idea capture failed (${errorCode}): ${message}`,
    };
  }

  const ideaId = typeof payload.idea_id === "string" ? payload.idea_id : "unknown";
  const recordRef =
    typeof payload.record_ref === "string" ? payload.record_ref : "record-ref-unavailable";
  const status = typeof payload.status === "string" ? payload.status : "captured";

  return {
    text: `Captured ${ideaId} with status ${status}.\nRecord: ${recordRef}`,
  };
}
