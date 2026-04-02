import type { AppConfig } from "./config.js";

export type Primitive = string | number | boolean;
export type QueryValue = Primitive | Primitive[] | undefined | null;
export type QueryParams = Record<string, QueryValue>;

type RequestOptions = {
  logOauthRequestBody?: boolean;
};

export class NinjaApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(message: string, status: number, path: string, details: unknown, retryable: boolean) {
    super(message);
    this.name = "NinjaApiError";
    this.status = status;
    this.path = path;
    this.retryable = retryable;
    this.details = details;
  }
}

export class NinjaClient {
  private readonly baseUrl: string;
  private readonly staticBearerToken?: string;
  private readonly sessionKey?: string;
  private readonly oauthTokenUrl?: string;
  private readonly oauthClientId?: string;
  private readonly oauthClientSecret?: string;
  private readonly oauthScope?: string;
  private readonly oauthAudience?: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private oauthAccessToken?: string;
  private oauthAccessTokenExpiresAtMs?: number;

  constructor(config: AppConfig) {
    this.baseUrl = config.ninjaBaseUrl;
    this.staticBearerToken = config.ninjaBearerToken;
    this.sessionKey = config.ninjaSessionKey;
    this.oauthTokenUrl = config.ninjaOauthTokenUrl;
    this.oauthClientId = config.ninjaOauthClientId;
    this.oauthClientSecret = config.ninjaOauthClientSecret;
    this.oauthScope = config.ninjaOauthScope;
    this.oauthAudience = config.ninjaOauthAudience;
    this.timeoutMs = config.httpTimeoutMs;
    this.retryCount = config.httpRetryCount;
  }

  async get(path: string, query: QueryParams = {}, options: RequestOptions = {}): Promise<unknown> {
    return this.request("GET", path, query, options);
  }

  private async request(
    method: "GET",
    path: string,
    query: QueryParams,
    options: RequestOptions,
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          continue;
        }

        url.searchParams.set(key, value.join(","));
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        const bearerToken = await this.getBearerToken(options);

        if (bearerToken) {
          headers.Authorization = `Bearer ${bearerToken}`;
        }

        if (this.sessionKey) {
          headers.Cookie = `sessionKey=${this.sessionKey}`;
        }

        const response = await fetch(url, {
          method,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const responseBody = await parseResponseBody(response);
          const retryable = response.status >= 500 || response.status === 429;

          console.error(
            "Ninja API non-success response",
            JSON.stringify({
              method,
              path,
              status: response.status,
              retryable,
              attempt,
              maxAttempts: this.retryCount,
              details: toLoggableDetails(responseBody),
            }),
          );

          if (response.status === 401 && this.isOauthEnabled() && attempt < this.retryCount) {
            this.oauthAccessToken = undefined;
            this.oauthAccessTokenExpiresAtMs = undefined;
            await sleep(200 * (attempt + 1));
            continue;
          }

          if (retryable && attempt < this.retryCount) {
            await sleep(200 * (attempt + 1));
            continue;
          }

          throw new NinjaApiError(
            `Ninja API request failed with status ${response.status}`,
            response.status,
            path,
            responseBody,
            retryable,
          );
        }

        if (response.status === 204) {
          return { ok: true };
        }

        return parseResponseBody(response);
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;

        console.error(
          "Ninja API request error",
          JSON.stringify({
            method,
            path,
            attempt,
            maxAttempts: this.retryCount,
            error: toLoggableDetails(toErrorDetails(error)),
          }),
        );

        if (error instanceof NinjaApiError) {
          throw error;
        }

        if (attempt < this.retryCount) {
          await sleep(200 * (attempt + 1));
          continue;
        }
      }
    }

    throw new NinjaApiError(
      "Ninja API request failed after retries",
      0,
      path,
      toErrorDetails(lastError),
      true,
    );
  }

  private isOauthEnabled(): boolean {
    return Boolean(this.oauthTokenUrl && this.oauthClientId && this.oauthClientSecret);
  }

  private async getBearerToken(options: RequestOptions): Promise<string | undefined> {
    if (this.staticBearerToken) {
      return this.staticBearerToken;
    }

    if (!this.isOauthEnabled()) {
      return undefined;
    }

    if (
      this.oauthAccessToken &&
      this.oauthAccessTokenExpiresAtMs &&
      Date.now() < this.oauthAccessTokenExpiresAtMs
    ) {
      return this.oauthAccessToken;
    }

    await this.refreshOauthToken(options);
    return this.oauthAccessToken;
  }

  private async refreshOauthToken(options: RequestOptions): Promise<void> {
    const tokenUrl = this.oauthTokenUrl;
    const clientId = this.oauthClientId;
    const clientSecret = this.oauthClientSecret;

    if (!tokenUrl || !clientId || !clientSecret) {
      throw new NinjaApiError("OAuth2 client credentials are not configured", 0, "oauth/token", null, false);
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let sanitizedRequestBody: Record<string, string> | undefined;

      try {
        const body = new URLSearchParams();
        body.set("grant_type", "client_credentials");
        body.set("client_id", clientId);
        body.set("client_secret", clientSecret);

        const scope = normalizeOptionalTokenParam(this.oauthScope);
        if (scope) {
          body.set("scope", scope);
        }

        const audience = normalizeOptionalTokenParam(this.oauthAudience);
        if (audience) {
          body.set("audience", audience);
        }

        sanitizedRequestBody = getSanitizedOauthRequestBody(body);

        const response = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const details = await parseResponseBody(response);
          const retryable = response.status >= 500 || response.status === 429;

          console.error(
            "Ninja OAuth token non-success response",
            JSON.stringify({
              status: response.status,
              retryable,
              attempt,
              maxAttempts: this.retryCount,
              tokenHost: safeTokenHost(tokenUrl),
              tokenPath: safeTokenPath(tokenUrl),
              requestBody: options.logOauthRequestBody ? sanitizedRequestBody : undefined,
              details: toLoggableDetails(details),
            }),
          );

          if (retryable && attempt < this.retryCount) {
            await sleep(200 * (attempt + 1));
            continue;
          }

          throw new NinjaApiError(
            `OAuth token request failed with status ${response.status}`,
            response.status,
            "oauth/token",
            details,
            retryable,
          );
        }

        const payload = (await parseResponseBody(response)) as {
          access_token?: string;
          expires_in?: number;
        };

        if (!payload?.access_token) {
          throw new NinjaApiError(
            "OAuth token response did not include access_token",
            0,
            "oauth/token",
            payload,
            false,
          );
        }

        const expiresInSeconds = Number(payload.expires_in ?? 3600);
        const refreshSkewMs = 60_000;
        const ttlMs = Math.max(5_000, expiresInSeconds * 1000 - refreshSkewMs);

        this.oauthAccessToken = payload.access_token;
        this.oauthAccessTokenExpiresAtMs = Date.now() + ttlMs;
        return;
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;

        console.error(
          "Ninja OAuth token request error",
          JSON.stringify({
            attempt,
            maxAttempts: this.retryCount,
            tokenHost: safeTokenHost(tokenUrl),
            tokenPath: safeTokenPath(tokenUrl),
            requestBody: options.logOauthRequestBody ? sanitizedRequestBody : undefined,
            error: toLoggableDetails(toErrorDetails(error)),
          }),
        );

        if (error instanceof NinjaApiError) {
          throw error;
        }

        if (attempt < this.retryCount) {
          await sleep(200 * (attempt + 1));
          continue;
        }
      }
    }

    throw new NinjaApiError(
      "OAuth token request failed after retries",
      0,
      "oauth/token",
      toErrorDetails(lastError),
      true,
    );
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toErrorDetails(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return error;
}

function toLoggableDetails(details: unknown): unknown {
  const maxLength = 2000;
  let serialized: string;

  if (typeof details === "string") {
    serialized = details;
  } else {
    try {
      serialized = JSON.stringify(details);
    } catch {
      serialized = String(details);
    }
  }

  if (serialized.length <= maxLength) {
    return details;
  }

  return {
    truncated: true,
    maxLength,
    preview: serialized.slice(0, maxLength),
  };
}

function getSanitizedOauthRequestBody(body: URLSearchParams): Record<string, string> {
  const sanitizedBody: Record<string, string> = {
    grant_type: body.get("grant_type") ?? "",
    client_id: body.get("client_id") ?? "",
    client_secret: "[REDACTED]",
  };

  const scope = body.get("scope");
  if (scope) {
    sanitizedBody.scope = scope;
  }

  const audience = body.get("audience");
  if (audience) {
    sanitizedBody.audience = audience;
  }

  return sanitizedBody;
}

function normalizeOptionalTokenParam(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function safeTokenHost(tokenUrl: string): string {
  try {
    return new URL(tokenUrl).host;
  } catch {
    return "invalid-url";
  }
}

function safeTokenPath(tokenUrl: string): string {
  try {
    return new URL(tokenUrl).pathname;
  } catch {
    return "invalid-url";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
