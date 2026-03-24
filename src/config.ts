import { z } from "zod";

const ConfigSchema = z
  .object({
    NINJA_BASE_URL: z.string().url(),
    NINJA_BEARER_TOKEN: z.string().optional(),
    NINJA_SESSION_KEY: z.string().optional(),
    NINJA_OAUTH_TOKEN_URL: z.string().url().optional(),
    NINJA_OAUTH_CLIENT_ID: z.string().optional(),
    NINJA_OAUTH_CLIENT_SECRET: z.string().optional(),
    NINJA_OAUTH_SCOPE: z.string().optional(),
    NINJA_OAUTH_AUDIENCE: z.string().optional(),
    NINJA_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    NINJA_HTTP_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(2),
    NINJA_DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().default(100),
    NINJA_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(1000),
    PORT: z.coerce.number().int().positive().default(3000),
  })
  .superRefine((value, ctx) => {
    const hasStaticAuth = Boolean(value.NINJA_BEARER_TOKEN || value.NINJA_SESSION_KEY);
    const oauthFields = [
      value.NINJA_OAUTH_TOKEN_URL,
      value.NINJA_OAUTH_CLIENT_ID,
      value.NINJA_OAUTH_CLIENT_SECRET,
    ];
    const hasAnyOauthField = oauthFields.some(Boolean);
    const hasCompleteOauth = oauthFields.every(Boolean);

    if (hasAnyOauthField && !hasCompleteOauth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "For OAuth2 client credentials, provide NINJA_OAUTH_TOKEN_URL, NINJA_OAUTH_CLIENT_ID, and NINJA_OAUTH_CLIENT_SECRET",
      });
    }

    if (!hasStaticAuth && !hasCompleteOauth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide one auth mode: NINJA_BEARER_TOKEN, NINJA_SESSION_KEY, or OAuth2 client credentials (token URL/client ID/client secret)",
      });
    }
  });

export type AppConfig = {
  ninjaBaseUrl: string;
  ninjaBearerToken?: string;
  ninjaSessionKey?: string;
  ninjaOauthTokenUrl?: string;
  ninjaOauthClientId?: string;
  ninjaOauthClientSecret?: string;
  ninjaOauthScope?: string;
  ninjaOauthAudience?: string;
  httpTimeoutMs: number;
  httpRetryCount: number;
  defaultPageSize: number;
  maxPageSize: number;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = ConfigSchema.parse(env);

  return {
    ninjaBaseUrl: parsed.NINJA_BASE_URL.replace(/\/+$/, ""),
    ninjaBearerToken: parsed.NINJA_BEARER_TOKEN,
    ninjaSessionKey: parsed.NINJA_SESSION_KEY,
    ninjaOauthTokenUrl: parsed.NINJA_OAUTH_TOKEN_URL,
    ninjaOauthClientId: parsed.NINJA_OAUTH_CLIENT_ID,
    ninjaOauthClientSecret: parsed.NINJA_OAUTH_CLIENT_SECRET,
    ninjaOauthScope: parsed.NINJA_OAUTH_SCOPE,
    ninjaOauthAudience: parsed.NINJA_OAUTH_AUDIENCE,
    httpTimeoutMs: parsed.NINJA_HTTP_TIMEOUT_MS,
    httpRetryCount: parsed.NINJA_HTTP_RETRY_COUNT,
    defaultPageSize: parsed.NINJA_DEFAULT_PAGE_SIZE,
    maxPageSize: parsed.NINJA_MAX_PAGE_SIZE,
    port: parsed.PORT,
  };
}
