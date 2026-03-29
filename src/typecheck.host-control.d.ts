declare const process: {
  env: Record<string, string | undefined>;
};

declare module "node:crypto" {
  export function randomBytes(size: number): { toString(encoding: string): string };
}

declare module "node:fs/promises" {
  const fs: any;
  export default fs;
}

declare module "node:path" {
  const path: any;
  export default path;
}

declare module "openclaw/plugin-sdk/channel-feedback" {
  export const logAckFailure: (...args: any[]) => any;
  export const removeAckReactionAfterReply: (...args: any[]) => any;
}

declare module "openclaw/plugin-sdk/config-runtime" {
  export type OpenClawConfig = {
    plugins?: {
      entries?: Record<string, { config?: unknown }>;
    };
  };
}

declare module "openclaw/plugin-sdk/reply-runtime" {
  export type ReplyPayload = any;
}

declare module "openclaw/plugin-sdk/runtime-env" {
  export type RuntimeEnv = any;
  export const danger: (...args: any[]) => any;
  export const logVerbose: (...args: any[]) => any;
}

declare module "./bot/delivery.js" {
  export const deliverReplies: (...args: any[]) => Promise<any>;
}

declare module "*.js" {
  export const deliverReplies: (...args: any[]) => Promise<any>;
  const value: any;
  export default value;
}
