import type { ApiUser, WorkerEnv } from "./types";

export type RouteContext = {
  request: Request;
  env: WorkerEnv;
  user: ApiUser;
  segments: string[];
};
