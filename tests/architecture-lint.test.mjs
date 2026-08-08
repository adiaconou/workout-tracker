import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("../scripts/check-boundaries.mjs", import.meta.url));

test("architecture lint accepts aliases, platform indexes, and public feature APIs", (context) => {
  const fixture = createFixture(context, {
    "base-tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./base-tsconfig.json",
      include: ["src/**/*.ts"],
    }),
    ".c8rc.json": coverageConfig(["src/contracts/api.ts"]),
    "src/domain/value.ts": "export type Value = { amount: number };\nexport function amount(value: Value) { return value.amount; }\n",
    "src/contracts/api.ts": "import type { Value } from '@/domain/value';\nexport type Payload = Value;\n",
    "src/client/alpha/use-beta.ts": "import { beta } from '@/client/beta/public';\nimport { platformValue } from './widget';\nexport function useBeta() { return beta() + platformValue; }\n",
    "src/client/alpha/widget/index.native.ts": "export const platformValue = 1;\n",
    "src/client/alpha/widget/index.web.ts": "export const platformValue = 1;\n",
    "src/client/beta/internal.ts": "export function beta() { return 1; }\n",
    "src/client/beta/public.ts": "export { beta } from './internal';\n",
    "src/server/auth/use-profile.ts": "import { profile } from '../profile/public';\nexport function useProfile() { return profile(); }\n",
    "src/server/profile/internal.ts": "export function profile() { return 'ok'; }\n",
    "src/server/profile/public.ts": "export { profile } from './internal';\n",
  });

  const result = runChecker(fixture);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /Architecture lint passed/);
});

test("architecture lint reports purity, layer, feature, cycle, resolver, and coverage violations", (context) => {
  const fixture = createFixture(context, {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
      include: ["src/**/*.ts"],
    }),
    ".c8rc.json": JSON.stringify({
      all: true,
      "check-coverage": true,
      "per-file": true,
      statements: 99,
      branches: 100,
      functions: 100,
      lines: 100,
      include: ["src/domain/*.ts"],
      exclude: ["src/server/**", "src/server/missing.ts", "src/server/missing.ts"],
    }),
    "legacy.ts": "export const outsideSource = true;\n",
    "src/domain/bad.ts": "import React from 'react';\nexport const bad = React;\n",
    "src/contracts/api.ts": "import { bad } from '../domain/bad';\nexport const payload = bad;\n",
    "src/client/alpha/deep.ts": "import { beta } from '../beta/internal';\nexport const deep = beta;\n",
    "src/client/alpha/use-beta.ts": "import { beta } from '../beta/public';\nimport { serverValue } from '../../server/profile/internal';\nimport { missing } from './missing';\nexport const useBeta = () => beta() + serverValue + missing;\n",
    "src/client/alpha/public.ts": "export { useBeta } from './use-beta';\n",
    "src/client/api/client.ts": "import { beta } from '../beta/internal';\nexport const client = beta;\n",
    "src/client/beta/dependency.ts": "import { useBeta } from '../alpha/public';\nexport const dependency = useBeta;\n",
    "src/client/beta/internal.ts": "export function beta() { return 1; }\n",
    "src/client/beta/public.ts": "export { beta } from './internal';\nexport { dependency } from './dependency';\n",
    "src/server/auth/use-profile.ts": "import { profile } from '../profile/internal';\nexport const authProfile = profile;\n",
    "src/server/db/direct.ts": "import { profile } from '../profile/internal';\nexport const direct = profile;\n",
    "src/server/db/new-store.ts": "import { services } from '../services';\nexport const store = services;\n",
    "src/server/profile/internal.ts": "export const profile = 'profile';\n",
    "src/server/services.ts": "export const services = {};\n",
  });

  const result = runChecker(fixture);
  assert.equal(result.status, 1, output(result));
  const stderr = result.stderr;
  for (const kind of [
    "boundary",
    "contract-runtime-code",
    "contract-runtime-import",
    "coverage-config",
    "external-dependency",
    "feature-boundary",
    "feature-cycle",
    "source-location",
    "unresolved-import",
  ]) {
    assert.match(stderr, new RegExp(`\\[${kind}\\]`), stderr);
  }
  assert.match(stderr, /database infrastructure may not add a dependency on service composition/);
  assert.match(stderr, /duplicate coverage exclusion/);
  assert.match(stderr, /stale coverage exclusion/);
});

test("architecture lint fails closed when tsconfig is invalid", (context) => {
  const fixture = createFixture(context, {
    "tsconfig.json": "{ invalid json",
    ".c8rc.json": coverageConfig([]),
    "src/domain/value.ts": "export function value() { return 1; }\n",
  });

  const result = runChecker(fixture);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stderr, /\[typescript-config\]/);
});

function createFixture(context, files) {
  const directory = mkdtempSync(path.join(tmpdir(), "architecture-lint-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(directory, ...relativePath.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents, "utf8");
  }
  return directory;
}

function coverageConfig(exclude) {
  return JSON.stringify({
    all: true,
    "check-coverage": true,
    "per-file": true,
    statements: 100,
    branches: 100,
    functions: 100,
    lines: 100,
    include: ["src/**/*.ts"],
    exclude,
  });
}

function runChecker(cwd) {
  return spawnSync(process.execPath, [checker], {
    cwd,
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}
