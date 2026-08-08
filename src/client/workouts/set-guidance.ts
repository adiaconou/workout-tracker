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

export function buildCompactSetDetails({
  primaryValues,
  details,
}: CompactSetDetailsInput): CompactSetDetail[] {
  const seen = new Set(
    primaryValues
      .map((value) => value?.trim() ?? "")
      .filter(Boolean)
      .map(normalizeGuidanceValue),
  );

  return details.reduce<CompactSetDetail[]>((uniqueDetails, detail) => {
    const value = detail.value?.trim() ?? "";
    if (!value) return uniqueDetails;

    const normalizedValue = normalizeGuidanceValue(value);
    if (seen.has(normalizedValue)) return uniqueDetails;

    seen.add(normalizedValue);
    uniqueDetails.push({ id: detail.id, label: detail.label, value });
    return uniqueDetails;
  }, []);
}
