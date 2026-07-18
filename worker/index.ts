import { handleApiRequest } from "../server/api";
import type { WorkerEnv } from "../server/types";

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "workout-tracker" });
    }
    if (
      url.pathname === "/api" ||
      url.pathname === "/api/v1" ||
      url.pathname.startsWith("/api/v1/")
    ) {
      return handleApiRequest(request, env);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (
      assetResponse.status !== 404 ||
      request.method !== "GET" ||
      !request.headers.get("accept")?.includes("text/html")
    ) {
      return assetResponse;
    }
    return env.ASSETS.fetch(
      new Request(new URL("/index.html", request.url), request),
    );
  },
};

export default worker;
