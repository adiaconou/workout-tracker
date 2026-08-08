const LOCAL_ORIGINS = new Set([
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:19006",
  "http://127.0.0.1:19006",
]);

export function apiResponse(
  request: Request,
  data: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-request-id", request.headers.get("x-request-id") ?? crypto.randomUUID());
  addCorsHeaders(request, headers);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(
  request: Request,
  status: number,
  code: string,
  message: string,
  retryable = false,
) {
  return apiResponse(
    request,
    { error: { code, message, retryable } },
    { status },
  );
}

export function preflightResponse(request: Request) {
  const headers = new Headers();
  addCorsHeaders(request, headers);
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "authorization,content-type,x-idempotency-key,x-request-id",
  );
  headers.set("access-control-max-age", "86400");
  return new Response(null, { status: 204, headers });
}

function addCorsHeaders(request: Request, headers: Headers) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin || LOCAL_ORIGINS.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("A JSON request body is required.");
  }
  return request.json() as Promise<T>;
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
