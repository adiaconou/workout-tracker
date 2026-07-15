import type { SideMode } from "./entities/exercise";
import type { RestRule, RoutineSetInput, RoutineSetType, TargetType } from "./entities/routine";

export type LegacyPrescription = {
  warmup: string;
  warmupSets: number;
  regularSets: number;
  failureSets: number;
  dropSets: number;
  target: string;
  rest: string;
  effort: string;
};

function parseRange(value: string) {
  const range = value.match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = value.match(/\d+(?:\.\d+)?/);
  return single ? { min: Number(single[0]), max: Number(single[0]) } : { min: null, max: null };
}

export function parseRestPrescription(rest: string): { seconds: number; rule: RestRule } {
  const normalized = rest.toLowerCase();
  let seconds = 0;
  if (normalized.includes("start every minute")) seconds = 60;
  else {
    const secondsMatch = normalized.match(/(\d+(?:\.\d+)?)\s*sec/);
    const minutesMatch = normalized.match(/(\d+(?:\.\d+)?)\s*min/);
    if (secondsMatch) seconds = Math.round(Number(secondsMatch[1]));
    else if (minutesMatch) seconds = Math.round(Number(minutesMatch[1]) * 60);
  }

  let rule: RestRule = "standard";
  if (normalized.includes("after both")) rule = "after_both_sides";
  if (normalized.includes("start every minute")) rule = "emom";
  if (normalized.trim() === "superset") rule = "after_superset";
  return { seconds, rule };
}

export function parseRir(effort: string) {
  const match = effort.match(/(\d+(?:\.\d+)?)\s*(?:[–-]\s*(\d+(?:\.\d+)?))?\s*RIR/i);
  if (!match) return { min: null, max: null };
  const first = Number(match[1]);
  return { min: first, max: match[2] ? Number(match[2]) : first };
}

function targetFor(prescription: LegacyPrescription, type: RoutineSetType, index: number) {
  if (type === "warmup") {
    const parts = prescription.warmup.split(";").map((part) => part.trim()).filter(Boolean);
    return parts[index] ?? prescription.warmup;
  }
  const parts = prescription.target.split(";").map((part) => part.trim()).filter(Boolean);
  const named = parts.find((part) => part.toLowerCase().includes(type));
  if (named) return named.replace(new RegExp(`\\s*${type}\\s*`, "i"), "").trim();
  if (type === "regular" && parts.length > 1) return parts[0].replace(/\s*regular\s*/i, "").trim();
  return prescription.target;
}

function targetType(value: string): TargetType {
  if (/sec/i.test(value)) return "duration";
  if (/round/i.test(value)) return "rounds";
  return "reps";
}

function sideMode(value: string): SideMode {
  if (/\/leg|per leg/i.test(value)) return "per_leg";
  if (/\/side|per side/i.test(value)) return "per_side";
  return "bilateral";
}

export function expandLegacyPrescription(prescription: LegacyPrescription): RoutineSetInput[] {
  const definitions: Array<{ type: RoutineSetType; count: number }> = [
    { type: "warmup", count: prescription.warmupSets },
    { type: prescription.rest.toLowerCase().includes("start every minute") ? "emom" : "regular", count: prescription.regularSets },
    { type: "failure", count: prescription.failureSets },
    { type: "drop", count: prescription.dropSets },
  ];
  const rest = parseRestPrescription(prescription.rest);
  const rir = parseRir(prescription.effort);
  const result: RoutineSetInput[] = [];

  for (const definition of definitions) {
    for (let index = 0; index < definition.count; index += 1) {
      const targetDisplay = targetFor(prescription, definition.type, index);
      const target = parseRange(targetDisplay);
      let restAfterSec = rest.seconds;
      let restRule = rest.rule;
      if (definition.type === "failure" && prescription.dropSets > 0) {
        restAfterSec = 0;
        restRule = "no_rest_before_drop";
      }
      result.push({
        position: result.length + 1,
        setType: definition.type,
        targetType: targetType(targetDisplay),
        targetMin: target.min,
        targetMax: target.max,
        targetDisplay,
        targetRirMin: definition.type === "warmup" ? null : rir.min,
        targetRirMax: definition.type === "warmup" ? null : rir.max,
        restAfterSec,
        restRule,
        loadInstruction: definition.type === "warmup" ? targetDisplay : "",
        sideMode: sideMode(targetDisplay),
        tempo: null,
        notes: "",
      });
    }
  }
  return result;
}
