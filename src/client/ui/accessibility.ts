export type WebFieldAriaProps = {
  "aria-describedby"?: string;
  "aria-errormessage"?: string;
  "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling";
  "aria-labelledby"?: string;
};

export function fieldAccessibilityHint(hint?: string, error?: string) {
  return [error ? `Error: ${error}` : null, hint]
    .filter((value): value is string => Boolean(value))
    .join(". ") || undefined;
}

export function idReferenceList(value?: string | string[]) {
  return Array.isArray(value) ? value.join(" ") : value;
}

export function mergeIdReferences(...values: Array<string | undefined>) {
  const references = new Set(
    values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []),
  );
  return references.size > 0 ? [...references].join(" ") : undefined;
}

export function fieldRelationshipProps(
  isWeb: boolean,
  {
    hintId,
    errorId,
    labelledBy,
    callerDescribedBy,
    callerErrorMessage,
    callerInvalid,
  }: {
    hintId: string | null;
    errorId: string | null;
    labelledBy: string | null;
    callerDescribedBy?: string;
    callerErrorMessage?: string;
    callerInvalid?: WebFieldAriaProps["aria-invalid"];
  },
): WebFieldAriaProps {
  if (!isWeb) return {};

  const generatedDescribedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return {
    "aria-labelledby": labelledBy ?? undefined,
    "aria-describedby": mergeIdReferences(callerDescribedBy, generatedDescribedBy),
    "aria-errormessage": errorId ?? callerErrorMessage,
    "aria-invalid": errorId ? true : callerInvalid,
  };
}
