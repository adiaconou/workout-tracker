import { Platform } from "react-native";
import type { ApiErrorPayload, NativeSession } from "./types";

const configuredBase = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/u, "") ?? "";
const API_BASE_URL = Platform.OS === "web" ? "" : configuredBase;

let accessToken: string | null = null;
let refreshSession: (() => Promise<boolean>) | null = null;

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

export function configureApiSession(options: {
  token: string | null;
  refresh: (() => Promise<boolean>) | null;
}) {
  accessToken = options.token;
  refreshSession = options.refresh;
}

export function apiUrl(path: string) {
  if (!API_BASE_URL && Platform.OS !== "web") {
    throw new ApiError(
      "EXPO_PUBLIC_API_BASE_URL is required for an Android build.",
      503,
      "api_not_configured",
    );
  }
  return `${API_BASE_URL}${path}`;
}

export async function rawApiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  return request<T>(path, init, false);
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
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

  let response = await fetch(apiUrl(path), { ...init, headers });
  if (
    response.status === 401 &&
    allowRefresh &&
    Platform.OS !== "web" &&
    refreshSession &&
    await refreshSession()
  ) {
    const retryHeaders = new Headers(headers);
    if (accessToken) retryHeaders.set("authorization", `Bearer ${accessToken}`);
    response = await fetch(apiUrl(path), { ...init, headers: retryHeaders });
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

export async function refreshWithToken(refreshToken: string) {
  return rawApiRequest<NativeSession>("/api/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}
