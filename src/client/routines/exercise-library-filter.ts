import type {
  Exercise,
  MuscleGroup,
  MuscleRole,
  SideMode,
  TrackingType,
} from "../../domain/entities";
import { muscleGroups } from "../../domain/entities";

export const exerciseBodyAreaAliases = {
  arms: ["biceps", "triceps", "grip"],
  legs: ["quads", "hamstrings", "glutes", "calves"],
  "upper body": ["chest", "back", "shoulders", "biceps", "triceps", "grip"],
} as const satisfies Readonly<Record<string, readonly MuscleGroup[]>>;

export type ExerciseBodyAreaAlias = keyof typeof exerciseBodyAreaAliases;
export type ExerciseLibraryMuscleRole = "any" | MuscleRole;

export type ExerciseLibraryFilters = {
  query?: string;
  muscles?: readonly MuscleGroup[];
  muscleRole?: ExerciseLibraryMuscleRole;
  equipment?: readonly string[];
  movementPatterns?: readonly string[];
  trackingTypes?: readonly TrackingType[];
  sideModes?: readonly SideMode[];
  favoritesOnly?: boolean;
};

export type ExerciseLibraryMatchReasonKind =
  | "primaryMuscle"
  | "secondaryMuscle"
  | "name"
  | "equipment"
  | "movementPattern"
  | "trackingType"
  | "sideMode"
  | "favorite";

export type ExerciseLibraryMatchReason = {
  kind: ExerciseLibraryMatchReasonKind;
  value: string;
  label: string;
};

export type ExerciseLibraryMatch = {
  exercise: Exercise;
  reasons: ExerciseLibraryMatchReason[];
};

type SearchTerm = {
  value: string;
  muscleGroups?: readonly MuscleGroup[];
  muscleRole?: MuscleRole;
};

type SearchEntry = {
  reason: ExerciseLibraryMatchReason;
  searchText: string;
  muscleGroup?: MuscleGroup;
  muscleRole?: MuscleRole;
};

type NormalizedSelections = {
  equipment: ReadonlySet<string>;
  movementPatterns: ReadonlySet<string>;
  trackingTypes: ReadonlySet<string>;
  sideModes: ReadonlySet<string>;
};

type RankedExerciseLibraryMatch = {
  match: ExerciseLibraryMatch;
  muscleRank: number;
};

const reasonCategoryLabels: Readonly<Record<Exclude<ExerciseLibraryMatchReasonKind, "favorite">, string>> = {
  primaryMuscle: "Primary",
  secondaryMuscle: "Secondary",
  name: "Name",
  equipment: "Equipment",
  movementPattern: "Movement",
  trackingType: "Tracking",
  sideMode: "Side mode",
};

const bodyAreaLookup: Readonly<Partial<Record<string, readonly MuscleGroup[]>>> = exerciseBodyAreaAliases;
const muscleGroupLookup = new Set<string>(muscleGroups);

export function filterExerciseLibrary(
  exercises: readonly Exercise[],
  filters: ExerciseLibraryFilters = {},
): ExerciseLibraryMatch[] {
  const queryTerms = parseSearchTerms(filters.query ?? "");
  const selectedMuscles = new Set<MuscleGroup>(filters.muscles ?? []);
  const normalizedSelections: NormalizedSelections = {
    equipment: normalizeSelections(filters.equipment),
    movementPatterns: normalizeSelections(filters.movementPatterns),
    trackingTypes: normalizeSelections(filters.trackingTypes),
    sideModes: normalizeSelections(filters.sideModes),
  };
  const rankedMatches: RankedExerciseLibraryMatch[] = [];

  for (const exercise of exercises) {
    const match = matchExercise(
      exercise,
      filters,
      queryTerms,
      selectedMuscles,
      normalizedSelections,
    );
    if (match) rankedMatches.push(match);
  }

  rankedMatches.sort((left, right) =>
    left.muscleRank - right.muscleRank
    || Number(right.match.exercise.isFavorite) - Number(left.match.exercise.isFavorite)
    || normalizeSearchText(left.match.exercise.name)
      .localeCompare(normalizeSearchText(right.match.exercise.name))
  );

  return rankedMatches.map((ranked) => ranked.match);
}

function matchExercise(
  exercise: Exercise,
  filters: ExerciseLibraryFilters,
  queryTerms: readonly SearchTerm[],
  selectedMuscles: ReadonlySet<MuscleGroup>,
  normalizedSelections: NormalizedSelections,
): RankedExerciseLibraryMatch | null {
  const entries = buildSearchEntries(exercise);
  const matchedReasonKeys = new Set<string>();

  if (!markSelectedMuscles(
    exercise,
    selectedMuscles,
    filters.muscleRole ?? "any",
    matchedReasonKeys,
  )) return null;

  if (!markSelectedValue(
    exercise.equipment,
    normalizedSelections.equipment,
    "equipment",
    matchedReasonKeys,
  )) return null;

  if (!markSelectedValue(
    exercise.movementPattern,
    normalizedSelections.movementPatterns,
    "movementPattern",
    matchedReasonKeys,
  )) return null;

  if (!markSelectedValue(
    exercise.trackingType,
    normalizedSelections.trackingTypes,
    "trackingType",
    matchedReasonKeys,
  )) return null;

  if (!markSelectedValue(
    exercise.sideMode,
    normalizedSelections.sideModes,
    "sideMode",
    matchedReasonKeys,
  )) return null;

  if (filters.favoritesOnly) {
    if (!exercise.isFavorite) return null;
    matchedReasonKeys.add(reasonKey("favorite", "favorite"));
  }

  if (!markQueryMatches(entries, queryTerms, matchedReasonKeys)) return null;

  const reasons = entries
    .filter((entry) => matchedReasonKeys.has(reasonKey(entry.reason.kind, entry.reason.value)))
    .map((entry) => entry.reason);
  const muscleRank = reasons.some((reason) => reason.kind === "primaryMuscle")
    ? 0
    : reasons.some((reason) => reason.kind === "secondaryMuscle") ? 1 : 2;

  return {
    match: { exercise, reasons },
    muscleRank,
  };
}

function markSelectedMuscles(
  exercise: Exercise,
  selectedMuscles: ReadonlySet<MuscleGroup>,
  muscleRole: ExerciseLibraryMuscleRole,
  matchedReasonKeys: Set<string>,
) {
  if (selectedMuscles.size === 0) return true;
  let matched = false;

  for (const muscle of exercise.muscles) {
    if (
      selectedMuscles.has(muscle.muscleGroup)
      && (muscleRole === "any" || muscle.role === muscleRole)
    ) {
      matched = true;
      matchedReasonKeys.add(reasonKey(
        muscle.role === "primary" ? "primaryMuscle" : "secondaryMuscle",
        muscle.muscleGroup,
      ));
    }
  }

  return matched;
}

function markSelectedValue(
  value: string,
  selectedValues: ReadonlySet<string>,
  reasonKind: "equipment" | "movementPattern" | "trackingType" | "sideMode",
  matchedReasonKeys: Set<string>,
) {
  if (selectedValues.size === 0) return true;
  if (!selectedValues.has(normalizeSearchText(value))) return false;
  matchedReasonKeys.add(reasonKey(reasonKind, value));
  return true;
}

function markQueryMatches(
  entries: readonly SearchEntry[],
  queryTerms: readonly SearchTerm[],
  matchedReasonKeys: Set<string>,
) {
  for (const term of queryTerms) {
    let matched = false;
    for (const entry of entries) {
      const entryMatches = term.muscleGroups
        ? entry.muscleGroup !== undefined
          && term.muscleGroups.includes(entry.muscleGroup)
          && (term.muscleRole === undefined || entry.muscleRole === term.muscleRole)
        : entry.searchText.includes(term.value);
      if (entryMatches) {
        matched = true;
        matchedReasonKeys.add(reasonKey(entry.reason.kind, entry.reason.value));
      }
    }
    if (!matched) return false;
  }
  return true;
}

function buildSearchEntries(exercise: Exercise): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const role of ["primary", "secondary"] as const) {
    for (const muscle of exercise.muscles) {
      if (muscle.role !== role) continue;
      const kind = role === "primary" ? "primaryMuscle" : "secondaryMuscle";
      entries.push({
        reason: createReason(kind, muscle.muscleGroup),
        searchText: normalizeSearchText(`${role} ${muscle.muscleGroup}`),
        muscleGroup: muscle.muscleGroup,
        muscleRole: role,
      });
    }
  }

  entries.push(
    createSearchEntry("name", exercise.name, `${exercise.name} ${exercise.normalizedName}`),
    createSearchEntry("equipment", exercise.equipment),
    createSearchEntry("movementPattern", exercise.movementPattern),
    createSearchEntry("trackingType", exercise.trackingType),
    createSearchEntry("sideMode", exercise.sideMode, sideModeSearchText(exercise.sideMode)),
  );

  if (exercise.isFavorite) {
    entries.push({
      reason: createReason("favorite", "favorite"),
      searchText: "favorite favorites fav starred",
    });
  }

  return entries;
}

function createSearchEntry(
  kind: "name" | "equipment" | "movementPattern" | "trackingType" | "sideMode",
  value: string,
  searchText = value,
): SearchEntry {
  return {
    reason: createReason(kind, value),
    searchText: normalizeSearchText(searchText),
  };
}

function createReason(
  kind: ExerciseLibraryMatchReasonKind,
  value: string,
): ExerciseLibraryMatchReason {
  if (kind === "favorite") return { kind, value, label: "Favorite" };
  return {
    kind,
    value,
    label: `${reasonCategoryLabels[kind]} · ${humanize(value)}`,
  };
}

function humanize(value: string) {
  const cleaned = value.replaceAll("_", " ").replace(/\s+/g, " ").trim();
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

function reasonKey(kind: ExerciseLibraryMatchReasonKind, value: string) {
  return `${kind}:${normalizeSearchText(value)}`;
}

function normalizeSelections(values: readonly string[] | undefined) {
  const normalized = new Set<string>();
  for (const value of values ?? []) normalized.add(normalizeSearchText(value));
  return normalized;
}

function parseSearchTerms(query: string): SearchTerm[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const words = normalized.split(" ");
  const terms: SearchTerm[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const prefixRole = parseMuscleRole(word);
    if (prefixRole) {
      const muscleTerm = readMuscleTerm(words, index + 1);
      if (muscleTerm) {
        terms.push({ ...muscleTerm.term, muscleRole: prefixRole });
        index += muscleTerm.wordCount;
      } else {
        terms.push({ value: word });
      }
      continue;
    }

    const muscleTerm = readMuscleTerm(words, index);
    if (!muscleTerm) {
      terms.push({ value: word });
      continue;
    }

    const suffixRole = parseMuscleRole(words[index + muscleTerm.wordCount]);
    terms.push(suffixRole
      ? { ...muscleTerm.term, muscleRole: suffixRole }
      : muscleTerm.term);
    index += muscleTerm.wordCount - 1 + Number(suffixRole !== undefined);
  }

  return terms;
}

function readMuscleTerm(
  words: readonly string[],
  index: number,
): { term: SearchTerm; wordCount: number } | null {
  const word = words[index];
  if (word === undefined) return null;
  const twoWordValue = words[index + 1] === undefined ? "" : `${word} ${words[index + 1]}`;
  const aliasGroups = bodyAreaLookup[twoWordValue] ?? bodyAreaLookup[word];
  if (aliasGroups) {
    const value = bodyAreaLookup[twoWordValue] ? twoWordValue : word;
    return { term: { value, muscleGroups: aliasGroups }, wordCount: value === word ? 1 : 2 };
  }
  if (!muscleGroupLookup.has(word)) return null;
  return {
    term: { value: word, muscleGroups: [word as MuscleGroup] },
    wordCount: 1,
  };
}

function parseMuscleRole(value: string | undefined): MuscleRole | undefined {
  return value === "primary" || value === "secondary" ? value : undefined;
}

function sideModeSearchText(sideMode: SideMode) {
  switch (sideMode) {
    case "bilateral":
      return "bilateral both sides two sided";
    case "per_side":
      return "per side unilateral single side one side single sided";
    case "per_leg":
      return "per leg unilateral single leg one leg";
    case "left_right":
      return "left right unilateral alternating sides alternate sides each side";
  }
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
