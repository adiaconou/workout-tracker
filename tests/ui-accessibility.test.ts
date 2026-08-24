import assert from "node:assert/strict";
import test from "node:test";
import {
  fieldAccessibilityHint,
  fieldRelationshipProps,
  idReferenceList,
  mergeIdReferences,
} from "../src/client/ui/accessibility";
import { colors } from "../src/client/ui/tokens";

test("field hints combine validation errors and supporting text", () => {
  assert.equal(fieldAccessibilityHint("Use kilograms", "Required"), "Error: Required. Use kilograms");
  assert.equal(fieldAccessibilityHint(undefined, "Required"), "Error: Required");
  assert.equal(fieldAccessibilityHint("Use kilograms"), "Use kilograms");
  assert.equal(fieldAccessibilityHint(), undefined);
});

test("field relationship helpers normalize and merge id references", () => {
  assert.equal(idReferenceList(["label-one", "label-two"]), "label-one label-two");
  assert.equal(idReferenceList("label-one"), "label-one");
  assert.equal(idReferenceList(), undefined);
  assert.equal(
    mergeIdReferences("caller hint", "hint error", undefined),
    "caller hint error",
  );
  assert.equal(mergeIdReferences("  ", undefined), undefined);
});

test("native fields do not receive web-only aria relationships", () => {
  assert.deepEqual(
    fieldRelationshipProps(false, {
      hintId: "hint",
      errorId: "error",
      labelledBy: "label",
    }),
    {},
  );
});

test("web fields merge generated relationships with caller aria properties", () => {
  assert.deepEqual(
    fieldRelationshipProps(true, {
      hintId: "hint",
      errorId: "error",
      labelledBy: "label",
      callerDescribedBy: "caller hint",
      callerErrorMessage: "caller-error",
      callerInvalid: "grammar",
    }),
    {
      "aria-labelledby": "label",
      "aria-describedby": "caller hint error",
      "aria-errormessage": "error",
      "aria-invalid": true,
    },
  );
});

test("web fields preserve caller relationships when no error is rendered", () => {
  assert.deepEqual(
    fieldRelationshipProps(true, {
      hintId: null,
      errorId: null,
      labelledBy: null,
      callerErrorMessage: "caller-error",
      callerInvalid: "spelling",
    }),
    {
      "aria-labelledby": undefined,
      "aria-describedby": undefined,
      "aria-errormessage": "caller-error",
      "aria-invalid": "spelling",
    },
  );
});

test("dim text and strong control boundaries meet contrast targets", () => {
  assert.ok(
    contrastRatio(colors.textDim, colors.surfaceRaised) >= 4.5,
    "Small dim text should meet WCAG AA contrast on raised cards",
  );
  assert.ok(
    contrastRatio(colors.borderStrong, colors.surfaceRaised) >= 3,
    "Strong interactive boundaries should meet non-text contrast on raised cards",
  );
  assert.ok(
    contrastRatio(colors.borderStrong, colors.background) >= 3,
    "Strong interactive boundaries should meet non-text contrast on page backgrounds",
  );
  assert.ok(
    contrastRatio(colors.recommendation, colors.recommendationSurface) >= 4.5,
    "Recommended targets should meet WCAG AA text contrast",
  );
  assert.ok(
    contrastRatio(colors.recommendationBorder, colors.recommendationSurface) >= 3,
    "Recommended target boundaries should meet non-text contrast",
  );
});

function contrastRatio(left: string, right: string) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

function relativeLuminance(hex: string) {
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
