import {
  muscleGroups,
  type RoutineProgram,
  type RoutineProgramCreateInput,
  type RoutineProgramMembership,
  type RoutineVersionInput,
} from "../../domain/entities";
import type {
  ProgramRepository,
  ProgramRepositoryCreateResult,
} from "../../domain/repositories/program-repository";
import { RoutineProgramInputError } from "../../domain/programs/validation";
import { ensureEntityData, ensureEntitySchema } from "./entity-schema";

type ProgramRow = {
  id: string;
  ownerEmail: string;
  name: string;
  goal: string;
  selectedMuscleGroupsJson: string;
  trainingDaysPerWeek: number;
  targetDurationMin: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
};

type MembershipRow = {
  routineId: string;
  routineCode: string;
  routineFocus: string;
  routineDurationMin: number;
  position: number;
};

type DraftRoutine = {
  routineId: string;
  versionId: string;
  code: string;
  version: RoutineVersionInput;
};

const canonicalCodes = new Set(["A", "B", "C", "D"]);

function storedMuscles(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return muscleGroups.filter((muscle) => parsed.includes(muscle));
  } catch {
    return [];
  }
}

export class D1ProgramRepository implements ProgramRepository {
  private readonly readyOwners = new Set<string>();

  constructor(private readonly d1: D1Database) {}

  private async ready(ownerEmail: string) {
    if (this.readyOwners.has(ownerEmail)) return;
    await ensureEntitySchema(this.d1);
    await ensureEntityData(this.d1, ownerEmail);
    await this.ensureDefaultProgram(ownerEmail);
    this.readyOwners.add(ownerEmail);
  }

  private async ensureDefaultProgram(ownerEmail: string) {
    const existing = await this.d1.prepare(`SELECT id, is_active AS isActive
      FROM routine_programs WHERE owner_email = ? ORDER BY created_at, id`)
      .bind(ownerEmail)
      .all<{ id: string; isActive: number }>();
    if (existing.results.length) {
      if (!existing.results.some((program) => Boolean(Number(program.isActive)))) {
        await this.d1.prepare(`UPDATE routine_programs SET is_active = 1, updated_at = ?
          WHERE id = ? AND owner_email = ?`)
          .bind(new Date().toISOString(), existing.results[0]!.id, ownerEmail)
          .run();
      }
      return;
    }

    const routines = await this.d1.prepare(`SELECT id, code FROM routines
      WHERE owner_email = ? AND is_active = 1 AND current_version_id IS NOT NULL
      ORDER BY CASE code WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 ELSE 5 END, code`)
      .bind(ownerEmail)
      .all<{ id: string; code: string }>();
    const canonical = routines.results.filter((routine) => canonicalCodes.has(routine.code));
    const selected = canonical.length ? canonical : routines.results;
    if (!selected.length) return;

    const profile = await this.d1.prepare(`SELECT preferred_workout_duration_min AS duration
      FROM app_users WHERE owner_email = ?`)
      .bind(ownerEmail)
      .first<{ duration: number }>();
    const now = new Date().toISOString();
    const programId = `${ownerEmail}::program::default`;
    const statements: D1PreparedStatement[] = [
      this.d1.prepare(`INSERT OR IGNORE INTO routine_programs (
        id, owner_email, name, goal, selected_muscle_groups_json,
        training_days_per_week, target_duration_min, is_active,
        idempotency_key, request_fingerprint, created_at, updated_at
      ) VALUES (?, ?, 'Current plan', 'General fitness', '[]', ?, ?, 1, NULL, '', ?, ?)`)
        .bind(
          programId,
          ownerEmail,
          Math.min(7, selected.length),
          Number(profile?.duration ?? 60),
          now,
          now,
        ),
      ...selected.map((routine, index) => this.d1.prepare(`INSERT OR IGNORE INTO routine_program_routines (
        program_id, routine_id, position, created_at
      ) SELECT ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM routine_programs WHERE id = ? AND owner_email = ?
      )`).bind(programId, routine.id, index + 1, now, programId, ownerEmail)),
    ];
    await this.d1.batch(statements);
  }

  private async load(ownerEmail: string, programId: string) {
    const row = await this.d1.prepare(`SELECT id, owner_email AS ownerEmail, name, goal,
      selected_muscle_groups_json AS selectedMuscleGroupsJson,
      training_days_per_week AS trainingDaysPerWeek,
      target_duration_min AS targetDurationMin, is_active AS isActive,
      created_at AS createdAt, updated_at AS updatedAt
      FROM routine_programs WHERE owner_email = ? AND id = ?`)
      .bind(ownerEmail, programId)
      .first<ProgramRow>();
    if (!row) return null;
    const memberships = await this.d1.prepare(`SELECT r.id AS routineId, r.code AS routineCode,
      COALESCE(rv.focus, r.focus) AS routineFocus,
      COALESCE(rv.duration_min, r.duration_min) AS routineDurationMin,
      rpr.position
      FROM routine_program_routines rpr
      INNER JOIN routines r ON r.id = rpr.routine_id AND r.owner_email = ?
      LEFT JOIN routine_versions rv ON rv.id = r.current_version_id AND rv.owner_email = r.owner_email
      WHERE rpr.program_id = ? ORDER BY rpr.position`)
      .bind(ownerEmail, programId)
      .all<MembershipRow>();
    return {
      id: row.id,
      ownerEmail: row.ownerEmail,
      name: row.name,
      goal: row.goal,
      selectedMuscleGroups: storedMuscles(row.selectedMuscleGroupsJson),
      trainingDaysPerWeek: Number(row.trainingDaysPerWeek),
      targetDurationMin: Number(row.targetDurationMin),
      isActive: Boolean(Number(row.isActive)),
      routines: memberships.results.map((membership): RoutineProgramMembership => ({
        ...membership,
        position: Number(membership.position),
        routineDurationMin: Number(membership.routineDurationMin),
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } satisfies RoutineProgram;
  }

  async listPrograms(ownerEmail: string) {
    await this.ready(ownerEmail);
    const rows = await this.d1.prepare(`SELECT id FROM routine_programs
      WHERE owner_email = ? ORDER BY is_active DESC, updated_at DESC, id`)
      .bind(ownerEmail)
      .all<{ id: string }>();
    const programs = await Promise.all(rows.results.map((row) => this.load(ownerEmail, row.id)));
    return programs.filter((program): program is RoutineProgram => program !== null);
  }

  async getProgram(ownerEmail: string, programId: string) {
    await this.ready(ownerEmail);
    return this.load(ownerEmail, programId);
  }

  private async idempotentResult(
    ownerEmail: string,
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<ProgramRepositoryCreateResult | null> {
    const existing = await this.d1.prepare(`SELECT id, request_fingerprint AS requestFingerprint
      FROM routine_programs WHERE owner_email = ? AND idempotency_key = ?`)
      .bind(ownerEmail, idempotencyKey)
      .first<{ id: string; requestFingerprint: string }>();
    if (!existing) return null;
    if (existing.requestFingerprint !== requestFingerprint) return { kind: "conflict" };
    const program = await this.load(ownerEmail, existing.id);
    if (!program) throw new Error("The idempotent program result is unavailable.");
    return { kind: "replayed", program };
  }

  async createProgram(
    ownerEmail: string,
    idempotencyKey: string,
    requestFingerprint: string,
    input: RoutineProgramCreateInput & { activate: boolean },
  ): Promise<ProgramRepositoryCreateResult> {
    await this.ready(ownerEmail);
    const replay = await this.idempotentResult(ownerEmail, idempotencyKey, requestFingerprint);
    if (replay) return replay;

    const drafts: DraftRoutine[] = [];
    const routineIds: string[] = [];
    const usedCodes = new Set<string>();
    for (const item of input.routines) {
      if ("routineId" in item) {
        const routine = await this.d1.prepare(`SELECT id, code FROM routines
          WHERE id = ? AND owner_email = ? AND is_active = 1 AND current_version_id IS NOT NULL`)
          .bind(item.routineId, ownerEmail)
          .first<{ id: string; code: string }>();
        if (!routine) throw new RoutineProgramInputError("A program references an unavailable routine.");
        if (usedCodes.has(routine.code)) throw new RoutineProgramInputError("A program cannot contain the same routine twice.");
        usedCodes.add(routine.code);
        routineIds.push(routine.id);
        continue;
      }
      if (usedCodes.has(item.code)) throw new RoutineProgramInputError("Routine codes must be unique within a program.");
      const codeExists = await this.d1.prepare(`SELECT id FROM routines
        WHERE owner_email = ? AND code = ?`)
        .bind(ownerEmail, item.code)
        .first<{ id: string }>();
      if (codeExists) throw new RoutineProgramInputError(`Routine code ${item.code} is already in use.`);
      for (const exerciseId of new Set(item.version.exercises.map((exercise) => exercise.exerciseId))) {
        const exercise = await this.d1.prepare(`SELECT id FROM exercise_catalog
          WHERE id = ? AND owner_email = ? AND is_active = 1`)
          .bind(exerciseId, ownerEmail)
          .first<{ id: string }>();
        if (!exercise) throw new RoutineProgramInputError("A routine draft references an unavailable exercise.");
      }
      const routineId = crypto.randomUUID();
      drafts.push({
        routineId,
        versionId: crypto.randomUUID(),
        code: item.code,
        version: item.version,
      });
      usedCodes.add(item.code);
      routineIds.push(routineId);
    }

    const programId = crypto.randomUUID();
    const now = new Date().toISOString();
    const currentActive = await this.d1.prepare(`SELECT id FROM routine_programs
      WHERE owner_email = ? AND is_active = 1 LIMIT 1`)
      .bind(ownerEmail)
      .first<{ id: string }>();
    const shouldActivate = input.activate || !currentActive;
    const statements: D1PreparedStatement[] = [];
    if (shouldActivate) {
      statements.push(this.d1.prepare(`UPDATE routine_programs
        SET is_active = 0, updated_at = ? WHERE owner_email = ? AND is_active = 1`)
        .bind(now, ownerEmail));
    }
    statements.push(this.d1.prepare(`INSERT INTO routine_programs (
      id, owner_email, name, goal, selected_muscle_groups_json,
      training_days_per_week, target_duration_min, is_active,
      idempotency_key, request_fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        programId,
        ownerEmail,
        input.name,
        input.goal,
        JSON.stringify(input.selectedMuscleGroups),
        input.trainingDaysPerWeek,
        input.targetDurationMin,
        shouldActivate ? 1 : 0,
        idempotencyKey,
        requestFingerprint,
        now,
        now,
      ));

    for (const draft of drafts) {
      statements.push(
        this.d1.prepare(`INSERT INTO routines (
          id, owner_email, code, version, focus, summary, duration_min,
          current_version_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 1, ?, ?)`)
          .bind(
            draft.routineId,
            ownerEmail,
            draft.code,
            draft.version.focus,
            draft.version.summary,
            draft.version.durationMin,
            draft.versionId,
            now,
            now,
          ),
        this.d1.prepare(`INSERT INTO routine_versions (
          id, owner_email, routine_id, version_number, status, focus, summary,
          duration_min, created_at, published_at, updated_at
        ) VALUES (?, ?, ?, 1, 'published', ?, ?, ?, ?, ?, ?)`)
          .bind(
            draft.versionId,
            ownerEmail,
            draft.routineId,
            draft.version.focus,
            draft.version.summary,
            draft.version.durationMin,
            now,
            now,
            now,
          ),
      );
      for (const exercise of draft.version.exercises) {
        const placementId = crypto.randomUUID();
        statements.push(this.d1.prepare(`INSERT INTO routine_version_exercises (
          id, owner_email, routine_version_id, exercise_id, position,
          superset_group, instructions, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            placementId,
            ownerEmail,
            draft.versionId,
            exercise.exerciseId,
            exercise.position,
            exercise.supersetGroup ?? null,
            exercise.instructions ?? "",
            exercise.notes ?? "",
            now,
            now,
          ));
        for (const set of exercise.sets) {
          statements.push(this.d1.prepare(`INSERT INTO routine_set_templates (
            id, owner_email, routine_exercise_id, position, set_type, target_type,
            target_min, target_max, target_display, target_rir_min, target_rir_max,
            rest_after_sec, rest_rule, load_instruction, side_mode, tempo, notes,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(
              crypto.randomUUID(),
              ownerEmail,
              placementId,
              set.position,
              set.setType,
              set.targetType,
              set.targetMin,
              set.targetMax,
              set.targetDisplay,
              set.targetRirMin,
              set.targetRirMax,
              set.restAfterSec,
              set.restRule,
              set.loadInstruction,
              set.sideMode,
              set.tempo,
              set.notes,
              now,
              now,
            ));
        }
      }
    }
    routineIds.forEach((routineId, index) => {
      statements.push(this.d1.prepare(`INSERT INTO routine_program_routines (
        program_id, routine_id, position, created_at
      ) VALUES (?, ?, ?, ?)`)
        .bind(programId, routineId, index + 1, now));
    });

    try {
      await this.d1.batch(statements);
    } catch (error) {
      const raced = await this.idempotentResult(ownerEmail, idempotencyKey, requestFingerprint);
      if (raced) return raced;
      throw error;
    }
    const program = await this.load(ownerEmail, programId);
    if (!program) throw new Error("The new program could not be loaded.");
    return { kind: "created", program };
  }

  async activateProgram(ownerEmail: string, programId: string) {
    await this.ready(ownerEmail);
    const exists = await this.d1.prepare(`SELECT id FROM routine_programs
      WHERE id = ? AND owner_email = ?`)
      .bind(programId, ownerEmail)
      .first<{ id: string }>();
    if (!exists) return null;
    const now = new Date().toISOString();
    await this.d1.batch([
      this.d1.prepare(`UPDATE routine_programs SET is_active = 0, updated_at = ?
        WHERE owner_email = ? AND is_active = 1 AND id <> ?`)
        .bind(now, ownerEmail, programId),
      this.d1.prepare(`UPDATE routine_programs SET is_active = 1, updated_at = ?
        WHERE id = ? AND owner_email = ?`)
        .bind(now, programId, ownerEmail),
    ]);
    return this.load(ownerEmail, programId);
  }
}
