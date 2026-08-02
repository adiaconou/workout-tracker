import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("shared UI primitives expose accessible field, status, heading, and focus semantics", async () => {
  const ui = await readFile(new URL("src/components/ui.tsx", root), "utf8");

  assert.match(ui, /accessibilityLabel=\{props\.accessibilityLabel \?\? label\}/);
  assert.match(ui, /accessibilityLabelledBy=/);
  assert.match(ui, /"aria-labelledby"/);
  assert.match(ui, /"aria-describedby"/);
  assert.match(ui, /"aria-errormessage"/);
  assert.match(ui, /"aria-invalid"/);
  assert.match(ui, /mergeIdReferences\(callerDescribedBy, generatedDescribedBy\)/);
  assert.match(ui, /"aria-errormessage": errorId \?\? callerErrorMessage/);
  assert.match(ui, /"aria-invalid": errorId \? true : callerInvalid/);
  assert.match(ui, /nativeID=\{labelId\}/);
  assert.match(ui, /fieldAccessibilityHint\(hint, error\)/);
  assert.match(ui, /accessibilityRole="alert"/);
  assert.match(ui, /role=\{tone === "error" \? "alert" : "status"\}/);
  assert.match(ui, /accessibilityLiveRegion=\{tone === "error" \? "assertive" : "polite"\}/);
  assert.match(ui, /role="heading"/);
  assert.match(ui, /"aria-level": semanticLevel/);
  assert.match(ui, /buttonCompact: \{ minHeight: 44/);
  assert.match(ui, /outlineStyle: "solid"/);
  assert.match(ui, /outlineOffset: -2/);
  assert.doesNotMatch(ui, /outlineOffset: 2/);
  assert.match(ui, /focused && Platform\.OS === "web" && styles\.webFocusRing/);
  assert.match(ui, /focusedControl === "input" && Platform\.OS === "web" && styles\.webFocusRing/);
});

test("dim text and strong control boundaries meet contrast targets on raised surfaces", async () => {
  const tokens = await readFile(new URL("src/theme/tokens.ts", root), "utf8");
  const color = (name) => {
    const match = tokens.match(new RegExp(`${name}:\\s*"(#[0-9a-fA-F]{6})"`));
    assert.ok(match, `Expected ${name} to be a six-digit hex color`);
    return match[1];
  };

  assert.ok(
    contrastRatio(color("textDim"), color("surfaceRaised")) >= 4.5,
    "Small dim text should meet WCAG AA contrast on raised cards",
  );
  assert.ok(
    contrastRatio(color("borderStrong"), color("surfaceRaised")) >= 3,
    "Strong interactive boundaries should meet non-text contrast on raised cards",
  );
  assert.ok(
    contrastRatio(color("borderStrong"), color("background")) >= 3,
    "Strong interactive boundaries should meet non-text contrast on page backgrounds",
  );
});

function contrastRatio(left, right) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) => (
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  ));
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
