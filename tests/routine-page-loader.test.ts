import assert from "node:assert/strict";
import test from "node:test";
import type { BootstrapPayload } from "../src/contracts/api";
import {
  loadRoutinePageData,
  type RoutinePageRequest,
} from "../src/client/routines/routine-page-loader";

const bootstrap = { routines: [] } as unknown as BootstrapPayload;

test("loads the routines bootstrap without requesting workout history", async () => {
  const paths: string[] = [];
  const request: RoutinePageRequest = <T>(path: string) => {
    paths.push(path);
    return Promise.resolve(bootstrap as T);
  };

  assert.equal(await loadRoutinePageData({ request }), bootstrap);
  assert.deepEqual(paths, ["/api/v1/bootstrap"]);
});
