export type SetGuidanceCandidate = {
  id: string;
  label: string;
  value?: string | null;
};

export type CompactSetDetail = {
  id: string;
  label: string;
  value: string;
};

type CompactSetDetailsInput = {
  primaryValues: Array<string | null | undefined>;
  details: SetGuidanceCandidate[];
};

function normalizeGuidanceValue(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/g, "");
}

const rirAmountPattern = "(?:[~≈]\\s*)?\\d+(?:\\.\\d+)?(?:\\s*[–-]\\s*\\d+(?:\\.\\d+)?)?";
const rirOnlyPattern = new RegExp(
  `^(?:RIR\\s*:?\\s*${rirAmountPattern}|${rirAmountPattern}\\s*RIR)[.!]?$`,
  "iu",
);
const guidanceClauseBoundary = /\r?\n|[;·•|]/u;

function isRirOnlyGuidance(value: string) {
  return rirOnlyPattern.test(value.trim());
}

function removeRepeatedRirClauses(value: string, primaryHasRir: boolean) {
  if (!primaryHasRir || !guidanceClauseBoundary.test(value)) {
    return primaryHasRir && isRirOnlyGuidance(value) ? "" : value;
  }
  return value
    .split(guidanceClauseBoundary)
    .map((clause) => clause.trim())
    .filter((clause) => clause && !isRirOnlyGuidance(clause))
    .join(" · ");
}

export function buildCompactSetDetails({
  primaryValues,
  details,
}: CompactSetDetailsInput): CompactSetDetail[] {
  const primaryHasRir = primaryValues.some(
    (value) => value ? isRirOnlyGuidance(value) : false,
  );
  const seen = new Set(
    primaryValues
      .map((value) => value?.trim() ?? "")
      .filter(Boolean)
      .map(normalizeGuidanceValue),
  );

  return details.reduce<CompactSetDetail[]>((uniqueDetails, detail) => {
    const value = removeRepeatedRirClauses(
      detail.value?.trim() ?? "",
      primaryHasRir,
    );
    if (!value) return uniqueDetails;

    const normalizedValue = normalizeGuidanceValue(value);
    if (seen.has(normalizedValue)) return uniqueDetails;

    seen.add(normalizedValue);
    uniqueDetails.push({ id: detail.id, label: detail.label, value });
    return uniqueDetails;
  }, []);
}
