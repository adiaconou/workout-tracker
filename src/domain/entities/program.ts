import type { MuscleGroup } from "./exercise";
import type { RoutineVersionInput } from "./routine";

export type RoutineProgramMembership = {
  routineId: string;
  routineCode: string;
  routineFocus: string;
  routineDurationMin: number;
  position: number;
};

export type RoutineProgram = {
  id: string;
  ownerEmail: string;
  name: string;
  goal: string;
  selectedMuscleGroups: MuscleGroup[];
  trainingDaysPerWeek: number;
  targetDurationMin: number;
  isActive: boolean;
  routines: RoutineProgramMembership[];
  createdAt: string;
  updatedAt: string;
};

export type RoutineProgramRoutineInput =
  | { routineId: string }
  | { code: string; version: RoutineVersionInput };

export type RoutineProgramCreateInput = {
  name: string;
  goal: string;
  selectedMuscleGroups: MuscleGroup[];
  trainingDaysPerWeek: number;
  targetDurationMin: number;
  activate?: boolean;
  routines: RoutineProgramRoutineInput[];
};
