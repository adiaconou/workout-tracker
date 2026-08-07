import assert from "node:assert/strict";
import test from "node:test";
import { validateGoogleClaims } from "../server/google";
import {
  generateRefreshToken,
  hashRefreshToken,
  issueAccessToken,
  verifyAccessToken,
} from "../server/session-tokens";

const AUDIENCE = "workout-web-client.apps.googleusercontent.com";
const SECRET = "test-session-secret-with-at-least-thirty-two-bytes";

test("issues and verifies short-lived app access tokens", async () => {
  const token = await issueAccessToken(
    SECRET,
    { id: "user-1", email: "owner@example.com" },
    "session-1",
  );
  const claims = await verifyAccessToken(SECRET, token);
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.email, "owner@example.com");
  assert.equal(claims.sid, "session-1");
  await assert.rejects(() => verifyAccessToken(`${SECRET}-wrong`, token));
});

test("generates opaque refresh tokens and stores only deterministic hashes", async () => {
  const first = generateRefreshToken();
  const second = generateRefreshToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 40);
  assert.equal(await hashRefreshToken(first), await hashRefreshToken(first));
  assert.notEqual(await hashRefreshToken(first), await hashRefreshToken(second));
});

test("accepts only verified Google identity claims for the configured audience", () => {
  const claims = validateGoogleClaims({
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    sub: "google-subject-1",
    email: "owner@example.com",
    email_verified: true,
    name: "Owner Name",
    picture: "https://lh3.googleusercontent.com/avatar",
  }, AUDIENCE);
  assert.equal(claims.sub, "google-subject-1");
  assert.equal(claims.email_verified, true);
  assert.equal(claims.name, "Owner Name");
  assert.equal(claims.picture, "https://lh3.googleusercontent.com/avatar");

  assert.throws(() => validateGoogleClaims({
    iss: "https://accounts.google.com",
    aud: "another-client",
    sub: "google-subject-1",
    email: "owner@example.com",
    email_verified: true,
  }, AUDIENCE), /different application/);

  assert.throws(() => validateGoogleClaims({
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    sub: "google-subject-1",
    email: "owner@example.com",
    email_verified: false,
  }, AUDIENCE), /not verified/);
});
