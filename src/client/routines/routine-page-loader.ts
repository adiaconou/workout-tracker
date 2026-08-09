import type { BootstrapPayload } from "../../contracts/api";

export type RoutinePageRequest = <T>(path: string) => Promise<T>;

export function loadRoutinePageData({ request }: { request: RoutinePageRequest }) {
  return request<BootstrapPayload>("/api/v1/bootstrap");
}
