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

type IdeaWorkflowDescriptor = {
  title?: string;
  purpose?: string;
  operator_guidance?: {
    what_to_send?: string[];
    examples?: string[];
    after_capture?: string[];
  };
  source_hints?: {
    telegram?: {
      help_invocation?: string;
      invocation_examples?: string[];
      note?: string;
    };
  };
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

function isIdeaHelpRequest(rawText: string): boolean {
  const normalized = rawText.trim().toLowerCase();
  return normalized === "help" || normalized === "--help" || normalized === "-h" ||
    normalized === "usage" || normalized === "?";
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

async function fetchIdeaWorkflowDescriptor(
  config: NonNullable<ReturnType<typeof loadIdeaCaptureConfig>>,
): Promise<IdeaCaptureCommandReply | IdeaWorkflowDescriptor> {
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}/v1/workflows/idea-capture`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-oos-caller-id": config.callerId,
        "x-oos-caller-secret": config.callerSecret,
      },
    });
  } catch (error) {
    return {
      isError: true,
      text: `Idea workflow guidance request failed before reaching the broker: ${String(error)}`,
    };
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const errorCode =
      typeof payload.error === "string" && payload.error ? payload.error : `http_${response.status}`;
    const message =
      typeof payload.message === "string" && payload.message
        ? payload.message
        : "Broker rejected the workflow guidance request.";
    return {
      isError: true,
      text: `Idea workflow guidance failed (${errorCode}): ${message}`,
    };
  }

  return payload as IdeaWorkflowDescriptor;
}

function renderIdeaWorkflowGuidance(descriptor: IdeaWorkflowDescriptor): string {
  const lines = [
    descriptor.title?.trim() || "Idea capture",
  ];

  if (descriptor.purpose?.trim()) {
    lines.push("", descriptor.purpose.trim());
  }

  const telegramHints = descriptor.source_hints?.telegram;
  const invocationExamples = telegramHints?.invocation_examples?.filter(Boolean) ?? [];
  if (invocationExamples.length > 0) {
    lines.push("", "Usage:");
    for (const example of invocationExamples) {
      lines.push(example);
    }
  }

  if (telegramHints?.note?.trim()) {
    lines.push("", telegramHints.note.trim());
  }

  const whatToSend = descriptor.operator_guidance?.what_to_send?.filter(Boolean) ?? [];
  if (whatToSend.length > 0) {
    lines.push("", "What to send:");
    for (const item of whatToSend) {
      lines.push(`- ${item}`);
    }
  }

  const examples = descriptor.operator_guidance?.examples?.filter(Boolean) ?? [];
  if (examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of examples) {
      lines.push(`- ${example}`);
    }
  }

  const afterCapture = descriptor.operator_guidance?.after_capture?.filter(Boolean) ?? [];
  if (afterCapture.length > 0) {
    lines.push("", "After capture:");
    for (const item of afterCapture) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}

export async function captureIdeaThroughBroker(
  params: CaptureIdeaParams,
): Promise<IdeaCaptureCommandReply> {
  const config = loadIdeaCaptureConfig();
  const rawText = params.rawArgs?.trim() ?? "";

  if (!config) {
    return {
      isError: true,
      text:
        "Idea capture is not configured in this runtime. Check OPERATOR_ORCHESTRATION_BASE_URL, OPERATOR_ORCHESTRATION_CALLER_ID, and OPERATOR_ORCHESTRATION_CALLER_SECRET in the gateway environment.",
    };
  }

  if (!rawText || isIdeaHelpRequest(rawText)) {
    const descriptor = await fetchIdeaWorkflowDescriptor(config);
    if ("text" in descriptor) {
      return descriptor;
    }

    return {
      text: renderIdeaWorkflowGuidance(descriptor),
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
        operator: {
          id: params.senderId,
          handle: params.senderUsername,
        },
        source: {
          surface: "telegram",
          integration_id: params.accountId,
          context_ref: {
            conversation_id: String(params.telegramChatId),
            conversation_type: params.chatType,
            ...(params.telegramThreadId !== undefined
              ? {
                  thread_id: String(params.telegramThreadId),
                }
              : {}),
          },
          native_ref: {
            command: "idea",
            message_id: String(params.messageId),
          },
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
