import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("profile route is protected, provided globally, and linked from the account menu", async () => {
  const [layout, accountMenu, route, context] = await Promise.all([
    readFile(new URL("app/_layout.tsx", root), "utf8"),
    readFile(new URL("src/components/account-menu.tsx", root), "utf8"),
    readFile(new URL("app/profile.tsx", root), "utf8"),
    readFile(new URL("src/profile/profile-context.tsx", root), "utf8"),
  ]);
  assert.match(layout, /<ProfileProvider>/);
  assert.match(layout, /Stack\.Screen name="profile"/);
  assert.match(accountMenu, /router\.push\("\/profile"\)/);
  assert.match(accountMenu, /Profile & settings/);
  assert.match(route, /<ProfileScreen/);
  assert.match(context, /export function useProfile/);
  assert.match(context, /\/api\/v1\/auth\/profile/);
  assert.match(context, /requestGeneration\.current === generation/);
  assert.match(context, /profile\?\.id === user\.id/);
});

test("profile form exposes optional unit-aware measurements and accessible feedback", async () => {
  const screen = await readFile(new URL("src/features/profile/profile-screen.tsx", root), "utf8");
  assert.match(screen, /accessibilityRole="radiogroup"/);
  assert.match(screen, /accessibilityRole="radio"/);
  assert.match(screen, /Height \(feet\)/);
  assert.match(screen, /Height \(inches\)/);
  assert.match(screen, /Body weight \(lb\)/);
  assert.match(screen, /Height \(cm\)/);
  assert.match(screen, /Body weight \(kg\)/);
  assert.match(screen, /Clear measurements/);
  assert.match(screen, /tone="success"/);
  assert.doesNotMatch(screen, /biometric summary/i);
});
