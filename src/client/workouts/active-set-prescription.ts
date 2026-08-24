import type { GuidedSet, SetType } from "../../domain/workout";

type PrescriptionSet = Pick<
  GuidedSet,
  | "effort"
  | "setType"
  | "sideMode"
  | "target"
  | "targetRirMax"
  | "targetRirMin"
  | "tempo"
>;

export type PrescriptionMetadata = {
  text: string;
  accessibilityText: string;
};

export type ActiveSetPrescription = {
  target: string;
  metadata: PrescriptionMetadata[];
  accessibilityLabel: string;
};

const specialSetTypeLabels: Record<Exclude<SetType, "regular">, string> = {
  drop: "Drop",
  emom: "EMOM",
  failure: "Failure",
  test: "Test",
  warmup: "Warm-up",
};

function rangeText(minimum: number | null, maximum: number | null) {
  if (minimum === null) return String(maximum);
  if (maximum === null || maximum === minimum) return String(minimum);
  return `${minimum}–${maximum}`;
}

function rangeAccessibilityText(minimum: number | null, maximum: number | null) {
  if (minimum === null) return String(maximum);
  if (maximum === null || maximum === minimum) return String(minimum);
  return `${minimum} to ${maximum}`;
}

function legacyRirAmount(effort: string) {
  const normalized = effort.trim();
  const amountPattern = "(?:≈\\s*)?\\d+(?:\\.\\d+)?(?:\\s*[–-]\\s*\\d+(?:\\.\\d+)?)?";
  const prefixMatch = normalized.match(new RegExp(`^RIR\\s*:?\\s*(${amountPattern})$`, "iu"));
  const suffixMatch = normalized.match(new RegExp(`^(${amountPattern})\\s+RIR$`, "iu"));
  return (prefixMatch?.[1] ?? suffixMatch?.[1] ?? null)?.replace(/\s+/gu, "") ?? null;
}

function rirMetadata(set: PrescriptionSet): PrescriptionMetadata | null {
  const minimum = set.targetRirMin ?? null;
  const maximum = set.targetRirMax ?? null;
  if (minimum !== null || maximum !== null) {
    return {
      text: `RIR ${rangeText(minimum, maximum)}`,
      accessibilityText: `${rangeAccessibilityText(minimum, maximum)} repetitions in reserve`,
    };
  }

  const legacyAmount = set.setType === "regular" || set.setType === "emom"
    ? legacyRirAmount(set.effort)
    : null;
  if (!legacyAmount) return null;
  return {
    text: `RIR ${legacyAmount.replaceAll("-", "–")}`,
    accessibilityText: `${legacyAmount
      .replace(/^≈/u, "approximately ")
      .replace(/[-–]/gu, " to ")} repetitions in reserve`,
  };
}

function sideModeMetadata(set: PrescriptionSet): PrescriptionMetadata | null {
  const target = set.target.toLowerCase();
  if (set.sideMode === "per_side") {
    return target.includes("/side")
      || target.includes("per side")
      || target.includes("each side")
      ? null
      : { text: "Per side", accessibilityText: "Per side" };
  }
  if (set.sideMode === "per_leg") {
    return target.includes("/leg")
      || target.includes("per leg")
      || target.includes("each leg")
      ? null
      : { text: "Per leg", accessibilityText: "Per leg" };
  }
  if (set.sideMode === "left_right") {
    return target.includes("left") && target.includes("right")
      ? null
      : { text: "Left / right", accessibilityText: "Left and right" };
  }
  return null;
}

function tempoMetadata(tempo: string | null | undefined): PrescriptionMetadata | null {
  const normalized = tempo?.trim();
  if (!normalized) return null;
  const text = /^tempo\b/iu.test(normalized)
    ? normalized.replace(/^tempo/iu, "Tempo")
    : `Tempo ${normalized}`;
  return { text, accessibilityText: text };
}

export function activeSetPrescription(set: PrescriptionSet): ActiveSetPrescription {
  const target = set.target.trim();
  const metadata = [
    rirMetadata(set),
    sideModeMetadata(set),
    tempoMetadata(set.tempo),
  ].filter((item): item is PrescriptionMetadata => item !== null);
  return {
    target,
    metadata,
    accessibilityLabel: [
      "Target",
      target,
      ...metadata.map((item) => item.accessibilityText),
    ].filter(Boolean).join(", "),
  };
}

export function specialSetTypeLabel(setType: SetType) {
  return setType === "regular" ? null : specialSetTypeLabels[setType];
}
