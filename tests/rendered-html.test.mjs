import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("replaces the starter with the routines product", async () => {
  const [layout, page, routines, detail, hosting] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/routines/page.tsx", root), "utf8"),
    readFile(new URL("app/routines/[routineId]/routine-editor.tsx", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(layout, /Workout Tracker/);
  assert.doesNotMatch(layout, /codex-preview|Starter Project|_sites-preview/);
  assert.match(page, /redirect\("\/routines"\)/);
  assert.match(routines, /A → B → C → D → repeat/);
  assert.match(detail, /Start workout/);
  assert.match(detail, /Edit routine/);
  assert.match(hosting, /"d1": "DB"/);
});
