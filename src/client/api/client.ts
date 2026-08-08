import { Platform } from "react-native";
import type { ApiErrorPayload, NativeSession } from "../../contracts/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "request_failed",
    readonly retryable = false,
  ) {
    super(message);
  }
}

export type ApiClientDependencies = {
  platform: string;
  configuredBaseUrl: string | undefined;
  fetch: typeof fetch;
};

type ApiSessionOptions = {
  token: string | null;
  refresh: (() => Promise<boolean>) | null;
};

export function createApiClient(dependencies: ApiClientDependencies) {
  const configuredBase = dependencies.configuredBaseUrl?.replace(/\/$/u, "") ?? "";
  const baseUrl = dependencies.platform === "web" ? "" : configuredBase;
  let accessToken: string | null = null;
  let refreshSession: (() => Promise<boolean>) | null = null;

  function configureSession(options: ApiSessionOptions) {
    accessToken = options.token;
    refreshSession = options.refresh;
  }

  function buildApiUrl(path: string) {
    if (!baseUrl && dependencies.platform !== "web") {
      throw new ApiError(
        "EXPO_PUBLIC_API_BASE_URL is required for an Android build.",
        503,
        "api_not_configured",
      );
    }
    return `${baseUrl}${path}`;
  }

  async function rawRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    return request<T>(path, init, false);
  }

  async function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    return request<T>(path, init, true);
  }

  async function request<T>(
    path: string,
    init: RequestInit,
    allowRefresh: boolean,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);

    let response = await dependencies.fetch(buildApiUrl(path), { ...init, headers });
    if (
      response.status === 401 &&
      allowRefresh &&
      dependencies.platform !== "web" &&
      refreshSession &&
      await refreshSession()
    ) {
      const retryHeaders = new Headers(headers);
      if (accessToken) retryHeaders.set("authorization", `Bearer ${accessToken}`);
      response = await dependencies.fetch(buildApiUrl(path), { ...init, headers: retryHeaders });
    }

    const payload = await response.json().catch(() => ({})) as T & ApiErrorPayload;
    if (!response.ok) {
      const structured = typeof payload.error === "object" ? payload.error : null;
      const message = structured?.message ??
        (typeof payload.error === "string" ? payload.error : "The request could not be completed.");
      throw new ApiError(
        message,
        response.status,
        structured?.code,
        Boolean(structured?.retryable),
      );
    }
    return payload;
  }

  async function refreshWithToken(refreshToken: string) {
    return rawRequest<NativeSession>("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  }

  return {
    configureSession,
    apiUrl: buildApiUrl,
    rawRequest,
    request: authenticatedRequest,
    refreshWithToken,
  };
}

const defaultClient = createApiClient({
  platform: Platform.OS,
  configuredBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  fetch: (...args) => fetch(...args),
});

export function configureApiSession(options: ApiSessionOptions) {
  defaultClient.configureSession(options);
}

export function apiUrl(path: string) {
  return defaultClient.apiUrl(path);
}

export async function rawApiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return defaultClient.rawRequest<T>(path, init);
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return defaultClient.request<T>(path, init);
}

export async function refreshWithToken(refreshToken: string) {
  return defaultClient.refreshWithToken(refreshToken);
}
