import assert from "node:assert/strict";
import test from "node:test";
import {
  profileDisplayName,
  profileInitials,
  safeProfilePhotoUrl,
} from "../src/client/auth/profile-display";

test("uses the IdP display name and produces compact initials", () => {
  assert.equal(profileDisplayName("Alex Diaconou", "alex@example.com"), "Alex Diaconou");
  assert.equal(profileInitials("Alex Diaconou", "alex@example.com"), "AD");
  assert.equal(profileInitials("Prince", "prince@example.com"), "PR");
});

test("falls back to email identity when no distinct name is available", () => {
  assert.equal(profileDisplayName("", "alex@example.com"), "alex@example.com");
  assert.equal(profileDisplayName("ALEX@example.com", "alex@example.com"), "alex@example.com");
  assert.equal(profileInitials("", "alex@example.com"), "AL");
});

test("accepts only HTTPS profile photo URLs", () => {
  assert.equal(
    safeProfilePhotoUrl("https://lh3.googleusercontent.com/avatar"),
    "https://lh3.googleusercontent.com/avatar",
  );
  assert.equal(safeProfilePhotoUrl("http://example.com/avatar.png"), null);
  assert.equal(safeProfilePhotoUrl("javascript:alert(1)"), null);
  assert.equal(safeProfilePhotoUrl(null), null);
});
