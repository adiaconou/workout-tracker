import type {
  EntityRepository,
  ExerciseQuery,
  WorkoutHistoryQuery,
  WorkoutQuery,
} from "../../domain/repositories/entity-repository";
import type {
  Exercise,
  ExerciseInput,
  ExerciseMuscle,
  LoadType,
  Routine,
  RoutineAggregate,
  RoutineExercise,
  RoutineSet,
  RoutineVersion,
  RoutineVersionInput,
  SideMode,
  Workout,
  WorkoutExercise,
  WorkoutHistoryPage,
  WorkoutHistorySummary,
  WorkoutItemStatus,
  WorkoutSet,
  WorkoutSetCorrection,
  WorkoutStatus,
} from "../../domain/entities";
import { normalizeExerciseName } from "../../domain/entities";
import { ensureEntityData, ensureEntitySchema } from "./entity-schema";

type Row = Record<string, unknown>;
const bool = (value: unknown) => Boolean(Number(value));
const numberOrNull = (value: unknown) => value === null || value === undefined ? null : Number(value);

function formatRest(seconds: number, rule: string) {
  if (rule === "emom") return "Start every minute";
  if (rule === "after_superset") return "Superset";
  const base = seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`;
  return rule === "after_both_sides" ? `${base} after both` : base;
}

function formatRir(set: RoutineSet, fallback: string) {
  if (set.targetRirMin === null) return fallback || "Controlled reps";
  return set.targetRirMax !== null && set.targetRirMax !== set.targetRirMin
    ? `${set.targetRirMin}–${set.targetRirMax} RIR`
    : `${set.targetRirMin} RIR`;
}

function nextTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
}

function routineTitleFromSnapshot(snapshotJson: unknown, routineCode: string) {
  const fallback = `Routine ${routineCode}`;
  if (typeof snapshotJson !== "string") return fallback;

  try {
    const snapshot = JSON.parse(snapshotJson) as { focus?: unknown };
    const title = typeof snapshot.focus === "string" ? snapshot.focus.trim() : "";
    return title || fallback;
  } catch {
    return fallback;
  }
}

export class D1EntityRepository implements EntityRepository {
  private readyOwners = new Set<string>();
  constructor(private readonly d1: D1Database) {}

  private async ready(ownerEmail: string) {
    if (this.readyOwners.has(ownerEmail)) return;
    await ensureEntitySchema(this.d1);
    await ensureEntityData(this.d1, ownerEmail);
    this.readyOwners.add(ownerEmail);
  }

  private async exerciseFromRow(row: Row): Promise<Exercise> {
    const muscles = await this.d1.prepare("SELECT muscle_group AS muscleGroup, role, weight FROM exercise_muscles WHERE exercise_id = ? ORDER BY weight DESC, muscle_group")
      .bind(String(row.id)).all<ExerciseMuscle>();
    return {
      id: String(row.id), ownerEmail: String(row.ownerEmail), name: String(row.name),
      normalizedName: String(row.normalizedName), equipment: String(row.equipment),
      movementPattern: String(row.movementPattern), trackingType: String(row.trackingType) as Exercise["trackingType"],
      defaultLoadType: String(row.defaultLoadType) as LoadType, sideMode: String(row.sideMode) as SideMode,
      instructions: String(row.instructions), muscles: muscles.results.map((muscle) => ({ ...muscle, weight: Number(muscle.weight) })),
      isFavorite: bool(row.isFavorite),
      isActive: bool(row.isActive), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
    };
  }

  private exerciseSelect() {
    return `SELECT ec.id, ec.owner_email AS ownerEmail, ec.name, ec.normalized_name AS normalizedName,
      equipment, movement_pattern AS movementPattern, tracking_type AS trackingType,
      default_load_type AS defaultLoadType, side_mode AS sideMode, instructions,
      is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt,
      EXISTS (
        SELECT 1 FROM exercise_favorites ef
        WHERE ef.owner_email = ec.owner_email AND ef.exercise_id = ec.id
      ) AS isFavorite
      FROM exercise_catalog ec`;
  }

  async listExercises(ownerEmail: string, query: ExerciseQuery = {}) {
    await this.ready(ownerEmail);
    const clauses = ["owner_email = ?"];
    const values: unknown[] = [ownerEmail];
    if (!query.includeArchived) clauses.push("is_active = 1");
    if (query.search?.trim()) {
      clauses.push("normalized_name LIKE ?");
      values.push(`%${normalizeExerciseName(query.search)}%`);
    }
    const rows = await this.d1.prepare(`${this.exerciseSelect()} WHERE ${clauses.join(" AND ")} ORDER BY name`)
      .bind(...values).all<Row>();
    return Promise.all(rows.results.map((row) => this.exerciseFromRow(row)));
  }

  async getExercise(ownerEmail: string, id: string) {
    await this.ready(ownerEmail);
    const row = await this.d1.prepare(`${this.exerciseSelect()} WHERE owner_email = ? AND id = ?`)
      .bind(ownerEmail, id).first<Row>();
    return row ? this.exerciseFromRow(row) : null;
  }

  async createExercise(ownerEmail: string, input: ExerciseInput) {
    await this.ready(ownerEmail);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.d1.prepare(`INSERT INTO exercise_catalog (
        id, owner_email, name, normalized_name, equipment, movement_pattern, tracking_type,
        default_load_type, side_mode, instructions, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .bind(id, ownerEmail, input.name, normalizeExerciseName(input.name), input.equipment ?? "other",
          input.movementPattern ?? "other", input.trackingType ?? "reps", input.defaultLoadType ?? "external",
          input.sideMode ?? "bilateral", input.instructions ?? "", now, now),
    ];
    for (const muscle of input.muscles ?? []) {
      statements.push(this.d1.prepare("INSERT INTO exercise_muscles (exercise_id, muscle_group, role, weight) VALUES (?, ?, ?, ?)")
        .bind(id, muscle.muscleGroup, muscle.role, muscle.weight));
    }
    await this.d1.batch(statements);
    return (await this.getExercise(ownerEmail, id))!;
  }

  async updateExercise(ownerEmail: string, id: string, input: Partial<ExerciseInput>) {
    await this.ready(ownerEmail);
    const existing = await this.getExercise(ownerEmail, id);
    if (!existing) return null;
    const now = nextTimestamp(existing.updatedAt);
    const muscles = input.muscles ?? existing.muscles;
    const statements: D1PreparedStatement[] = [
      this.d1.prepare(`UPDATE exercise_catalog SET name = ?, normalized_name = ?, equipment = ?,
        movement_pattern = ?, tracking_type = ?, default_load_type = ?, side_mode = ?,
        instructions = ?, updated_at = ? WHERE id = ? AND owner_email = ?`)
        .bind(input.name ?? existing.name, normalizeExerciseName(input.name ?? existing.name),
          input.equipment ?? existing.equipment, input.movementPattern ?? existing.movementPattern,
          input.trackingType ?? existing.trackingType, input.defaultLoadType ?? existing.defaultLoadType,
          input.sideMode ?? existing.sideMode, input.instructions ?? existing.instructions, now, id, ownerEmail),
      this.d1.prepare("DELETE FROM exercise_muscles WHERE exercise_id = ?").bind(id),
    ];
    for (const muscle of muscles) {
      statements.push(this.d1.prepare("INSERT INTO exercise_muscles (exercise_id, muscle_group, role, weight) VALUES (?, ?, ?, ?)")
        .bind(id, muscle.muscleGroup, muscle.role, muscle.weight));
    }
    statements.push(this.d1.prepare(`UPDATE exercises SET name = ?, load_type = ?, updated_at = ?
      WHERE owner_email = ? AND EXISTS (
        SELECT 1 FROM routines r
        INNER JOIN routine_version_exercises rve
          ON rve.routine_version_id = r.current_version_id AND rve.owner_email = r.owner_email
        WHERE r.owner_email = ? AND r.code = exercises.routine_code
          AND rve.position = exercises.exercise_order AND rve.exercise_id = ?
      )`).bind(
        input.name ?? existing.name,
        input.defaultLoadType ?? existing.defaultLoadType,
        now,
        ownerEmail,
        ownerEmail,
        id,
      ));
    await this.d1.batch(statements);
    return this.getExercise(ownerEmail, id);
  }

  async updateExerciseIfUnchanged(
    ownerEmail: string,
    id: string,
    expectedUpdatedAt: string,
    mutationId: string,
    input: ExerciseInput,
  ) {
    await this.ready(ownerEmail);
    const now = nextTimestamp(expectedUpdatedAt);
    const mutationMarker = `coach:${mutationId}`;
    const statements: D1PreparedStatement[] = [
      this.d1.prepare(`UPDATE exercise_catalog SET name = ?, normalized_name = ?, equipment = ?,
        movement_pattern = ?, tracking_type = ?, default_load_type = ?, side_mode = ?,
        instructions = ?, updated_at = ?
        WHERE id = ? AND owner_email = ? AND is_active = 1 AND updated_at = ?`)
        .bind(input.name, normalizeExerciseName(input.name), input.equipment ?? "other",
          input.movementPattern ?? "other", input.trackingType ?? "reps",
          input.defaultLoadType ?? "external", input.sideMode ?? "bilateral",
          input.instructions ?? "", mutationMarker, id, ownerEmail, expectedUpdatedAt),
      this.d1.prepare(`DELETE FROM exercise_muscles WHERE exercise_id = ? AND EXISTS (
        SELECT 1 FROM exercise_catalog
        WHERE id = ? AND owner_email = ? AND is_active = 1 AND updated_at = ?
      )`).bind(id, id, ownerEmail, mutationMarker),
    ];
    for (const muscle of input.muscles ?? []) {
      statements.push(this.d1.prepare(`INSERT INTO exercise_muscles (exercise_id, muscle_group, role, weight)
        SELECT ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM exercise_catalog
          WHERE id = ? AND owner_email = ? AND is_active = 1 AND updated_at = ?
        )`).bind(id, muscle.muscleGroup, muscle.role, muscle.weight, id, ownerEmail, mutationMarker));
    }
    statements.push(this.d1.prepare(`UPDATE exercises SET name = ?, load_type = ?, updated_at = ?
      WHERE owner_email = ? AND EXISTS (
        SELECT 1 FROM routines r
        INNER JOIN routine_version_exercises rve
          ON rve.routine_version_id = r.current_version_id AND rve.owner_email = r.owner_email
        WHERE r.owner_email = ? AND r.code = exercises.routine_code
          AND rve.position = exercises.exercise_order AND rve.exercise_id = ?
      ) AND EXISTS (
        SELECT 1 FROM exercise_catalog
        WHERE id = ? AND owner_email = ? AND is_active = 1 AND updated_at = ?
      )`).bind(
        input.name,
        input.defaultLoadType ?? "external",
        now,
        ownerEmail,
        ownerEmail,
        id,
        id,
        ownerEmail,
        mutationMarker,
      ));
    statements.push(this.d1.prepare(`UPDATE exercise_catalog SET updated_at = ?
      WHERE id = ? AND owner_email = ? AND is_active = 1 AND updated_at = ?`)
      .bind(now, id, ownerEmail, mutationMarker));
    const results = await this.d1.batch(statements);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return null;
    return this.getExercise(ownerEmail, id);
  }

  async setExerciseFavorite(ownerEmail: string, id: string, isFavorite: boolean) {
    await this.ready(ownerEmail);
    const owned = await this.d1.prepare(
      "SELECT id FROM exercise_catalog WHERE id = ? AND owner_email = ?",
    ).bind(id, ownerEmail).first<{ id: string }>();
    if (!owned) return null;

    if (isFavorite) {
      await this.d1.prepare(
        "INSERT OR IGNORE INTO exercise_favorites (owner_email, exercise_id, created_at) VALUES (?, ?, ?)",
      ).bind(ownerEmail, id, new Date().toISOString()).run();
    } else {
      await this.d1.prepare(
        "DELETE FROM exercise_favorites WHERE owner_email = ? AND exercise_id = ?",
      ).bind(ownerEmail, id).run();
    }
    return this.getExercise(ownerEmail, id);
  }

  async archiveExercise(ownerEmail: string, id: string) {
    await this.ready(ownerEmail);
    const result = await this.d1.prepare("UPDATE exercise_catalog SET is_active = 0, updated_at = ? WHERE id = ? AND owner_email = ?")
      .bind(new Date().toISOString(), id, ownerEmail).run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  async archiveExerciseIfUnchanged(ownerEmail: string, id: string, expectedUpdatedAt: string) {
    await this.ready(ownerEmail);
    const result = await this.d1.prepare(`UPDATE exercise_catalog SET is_active = 0, updated_at = ?
      WHERE id = ? AND owner_email = ? AND is_active = 1 AND updated_at = ?
      AND NOT EXISTS (
        SELECT 1 FROM routines r
        INNER JOIN routine_versions rv ON rv.routine_id = r.id AND rv.owner_email = r.owner_email
        INNER JOIN routine_version_exercises rve
          ON rve.routine_version_id = rv.id AND rve.owner_email = r.owner_email
        WHERE r.owner_email = ? AND r.is_active = 1 AND rve.exercise_id = ?
          AND (rv.id = r.current_version_id OR rv.status = 'draft')
      )`)
      .bind(new Date().toISOString(), id, ownerEmail, expectedUpdatedAt, ownerEmail, id).run();
    return Number(result.meta.changes ?? 0) === 1;
  }

  private async routineRow(ownerEmail: string, idOrCode: string) {
    return this.d1.prepare(`SELECT id, owner_email AS ownerEmail, code,
      current_version_id AS currentVersionId, is_active AS isActive,
      COALESCE(created_at, updated_at) AS createdAt, updated_at AS updatedAt
      FROM routines WHERE owner_email = ? AND (id = ? OR code = ?)`)
      .bind(ownerEmail, idOrCode, idOrCode.toUpperCase()).first<Row>();
  }

  private async loadVersion(ownerEmail: string, routineId: string, versionId: string): Promise<RoutineVersion | null> {
    const version = await this.d1.prepare(`SELECT id, owner_email AS ownerEmail, routine_id AS routineId,
      version_number AS versionNumber, status, focus, summary, duration_min AS durationMin,
      created_at AS createdAt, published_at AS publishedAt, updated_at AS updatedAt
      FROM routine_versions WHERE owner_email = ? AND routine_id = ? AND id = ?`)
      .bind(ownerEmail, routineId, versionId).first<Row>();
    if (!version) return null;
    const placements = await this.d1.prepare(`SELECT rve.id, rve.owner_email AS ownerEmail,
      rve.routine_version_id AS routineVersionId, rve.exercise_id AS exerciseId,
      ec.name AS exerciseName, rve.position, rve.superset_group AS supersetGroup,
      rve.instructions, rve.notes, rve.created_at AS createdAt, rve.updated_at AS updatedAt
      FROM routine_version_exercises rve INNER JOIN exercise_catalog ec ON ec.id = rve.exercise_id
      WHERE rve.owner_email = ? AND rve.routine_version_id = ? ORDER BY rve.position`)
      .bind(ownerEmail, versionId).all<Row>();
    const exercises: RoutineExercise[] = [];
    for (const placement of placements.results) {
      const sets = await this.d1.prepare(`SELECT id, owner_email AS ownerEmail,
        routine_exercise_id AS routineExerciseId, position, set_type AS setType,
        target_type AS targetType, target_min AS targetMin, target_max AS targetMax,
        target_display AS targetDisplay, target_rir_min AS targetRirMin,
        target_rir_max AS targetRirMax, rest_after_sec AS restAfterSec, rest_rule AS restRule,
        load_instruction AS loadInstruction, side_mode AS sideMode, tempo, notes,
        created_at AS createdAt, updated_at AS updatedAt
        FROM routine_set_templates WHERE owner_email = ? AND routine_exercise_id = ? ORDER BY position`)
        .bind(ownerEmail, String(placement.id)).all<Row>();
      exercises.push({
        id: String(placement.id), ownerEmail: String(placement.ownerEmail), routineVersionId: String(placement.routineVersionId),
        exerciseId: String(placement.exerciseId), exerciseName: String(placement.exerciseName), position: Number(placement.position),
        supersetGroup: placement.supersetGroup === null ? null : String(placement.supersetGroup), instructions: String(placement.instructions),
        notes: String(placement.notes), createdAt: String(placement.createdAt), updatedAt: String(placement.updatedAt),
        sets: sets.results.map((set) => ({
          ...set, id: String(set.id), ownerEmail: String(set.ownerEmail), routineExerciseId: String(set.routineExerciseId),
          position: Number(set.position), setType: String(set.setType) as RoutineSet["setType"], targetType: String(set.targetType) as RoutineSet["targetType"],
          targetMin: numberOrNull(set.targetMin), targetMax: numberOrNull(set.targetMax), targetDisplay: String(set.targetDisplay),
          targetRirMin: numberOrNull(set.targetRirMin), targetRirMax: numberOrNull(set.targetRirMax), restAfterSec: Number(set.restAfterSec),
          restRule: String(set.restRule) as RoutineSet["restRule"], loadInstruction: String(set.loadInstruction),
          sideMode: String(set.sideMode) as SideMode, tempo: set.tempo === null ? null : String(set.tempo), notes: String(set.notes),
          createdAt: String(set.createdAt), updatedAt: String(set.updatedAt),
        })),
      });
    }
    return {
      id: String(version.id), ownerEmail: String(version.ownerEmail), routineId: String(version.routineId),
      versionNumber: Number(version.versionNumber), status: String(version.status) as RoutineVersion["status"],
      focus: String(version.focus), summary: String(version.summary), durationMin: Number(version.durationMin),
      exercises, createdAt: String(version.createdAt), publishedAt: version.publishedAt === null ? null : String(version.publishedAt),
      updatedAt: String(version.updatedAt),
    };
  }

  private async aggregate(ownerEmail: string, row: Row): Promise<RoutineAggregate> {
    const routine: Routine = {
      id: String(row.id), ownerEmail: String(row.ownerEmail), code: String(row.code),
      currentVersionId: row.currentVersionId === null ? null : String(row.currentVersionId),
      isActive: bool(row.isActive), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
    };
    return {
      ...routine,
      currentVersion: routine.currentVersionId ? await this.loadVersion(ownerEmail, routine.id, routine.currentVersionId) : null,
    };
  }

  async listRoutineAggregates(ownerEmail: string, includeArchived = false) {
    await this.ready(ownerEmail);
    const rows = await this.d1.prepare(`SELECT id, owner_email AS ownerEmail, code,
      current_version_id AS currentVersionId, is_active AS isActive,
      COALESCE(created_at, updated_at) AS createdAt, updated_at AS updatedAt
      FROM routines WHERE owner_email = ? ${includeArchived ? "" : "AND is_active = 1"} ORDER BY code`)
      .bind(ownerEmail).all<Row>();
    return Promise.all(rows.results.map((row) => this.aggregate(ownerEmail, row)));
  }

  async getRoutineAggregate(ownerEmail: string, idOrCode: string) {
    await this.ready(ownerEmail);
    const row = await this.routineRow(ownerEmail, idOrCode);
    return row ? this.aggregate(ownerEmail, row) : null;
  }

  private async insertVersion(ownerEmail: string, routineId: string, versionNumber: number, input: RoutineVersionInput, requestedVersionId?: string) {
    const now = new Date().toISOString();
    const versionId = requestedVersionId ?? crypto.randomUUID();
    const exerciseIds = [...new Set(input.exercises.map((exercise) => exercise.exerciseId))];
    for (const exerciseId of exerciseIds) {
      const owned = await this.d1.prepare("SELECT id FROM exercise_catalog WHERE id = ? AND owner_email = ? AND is_active = 1")
        .bind(exerciseId, ownerEmail).first<{ id: string }>();
      if (!owned) throw new Error("A routine references an unavailable exercise.");
    }
    const statements: D1PreparedStatement[] = [
      this.d1.prepare(`INSERT INTO routine_versions (
        id, owner_email, routine_id, version_number, status, focus, summary, duration_min,
        created_at, published_at, updated_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, NULL, ?)`)
        .bind(versionId, ownerEmail, routineId, versionNumber, input.focus, input.summary, input.durationMin, now, now),
    ];
    for (const exercise of input.exercises) {
      const placementId = crypto.randomUUID();
      statements.push(this.d1.prepare(`INSERT INTO routine_version_exercises (
        id, owner_email, routine_version_id, exercise_id, position, superset_group,
        instructions, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(placementId, ownerEmail, versionId, exercise.exerciseId, exercise.position,
          exercise.supersetGroup ?? null, exercise.instructions ?? "", exercise.notes ?? "", now, now));
      for (const set of exercise.sets) {
        statements.push(this.d1.prepare(`INSERT INTO routine_set_templates (
          id, owner_email, routine_exercise_id, position, set_type, target_type, target_min,
          target_max, target_display, target_rir_min, target_rir_max, rest_after_sec, rest_rule,
          load_instruction, side_mode, tempo, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), ownerEmail, placementId, set.position, set.setType, set.targetType,
            set.targetMin, set.targetMax, set.targetDisplay, set.targetRirMin, set.targetRirMax,
            set.restAfterSec, set.restRule, set.loadInstruction, set.sideMode, set.tempo, set.notes, now, now));
      }
    }
    await this.d1.batch(statements);
    return (await this.loadVersion(ownerEmail, routineId, versionId))!;
  }

  async createRoutine(ownerEmail: string, code: string, input: RoutineVersionInput) {
    await this.ready(ownerEmail);
    const now = new Date().toISOString();
    const routineId = crypto.randomUUID();
    await this.d1.prepare(`INSERT INTO routines (
      id, owner_email, code, version, focus, summary, duration_min, current_version_id,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, 1, ?, ?)`)
      .bind(routineId, ownerEmail, code, input.focus, input.summary, input.durationMin, now, now).run();
    const version = await this.insertVersion(ownerEmail, routineId, 1, input);
    return (await this.publishRoutineVersion(ownerEmail, routineId, version.id))!;
  }

  async updateRoutineIdentity(ownerEmail: string, idOrCode: string, input: { code?: string; isActive?: boolean }) {
    await this.ready(ownerEmail);
    if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
      throw new Error("Routine active state must be a boolean.");
    }
    const row = await this.routineRow(ownerEmail, idOrCode);
    if (!row) return null;
    const nextCode = input.code?.toUpperCase() ?? String(row.code);
    const nextIsActive = input.isActive === undefined ? Number(row.isActive) : input.isActive ? 1 : 0;
    const now = new Date().toISOString();
    const routineUpdate = input.isActive === true
      ? this.d1.prepare(`UPDATE routines SET code = ?, is_active = 1, updated_at = ?
          WHERE id = ? AND owner_email = ? AND NOT EXISTS (
            SELECT 1 FROM routine_version_exercises rve
            LEFT JOIN exercise_catalog ec ON ec.id = rve.exercise_id
            WHERE rve.owner_email = routines.owner_email
              AND rve.routine_version_id = routines.current_version_id
              AND (ec.id IS NULL OR ec.owner_email <> routines.owner_email OR ec.is_active <> 1)
          )`).bind(nextCode, now, row.id, ownerEmail)
      : this.d1.prepare("UPDATE routines SET code = ?, is_active = ?, updated_at = ? WHERE id = ? AND owner_email = ?")
        .bind(nextCode, nextIsActive, now, row.id, ownerEmail);
    const results = await this.d1.batch([
      routineUpdate,
      this.d1.prepare(`UPDATE exercises SET routine_code = ?, updated_at = ?
        WHERE owner_email = ? AND routine_code = ? AND EXISTS (
          SELECT 1 FROM routines
          WHERE id = ? AND owner_email = ? AND code = ? AND is_active = ?
        )`).bind(nextCode, now, ownerEmail, row.code, row.id, ownerEmail, nextCode, nextIsActive),
    ]);
    if (input.isActive === true && Number(results[0]?.meta.changes ?? 0) !== 1) {
      throw new Error("The routine references an unavailable exercise.");
    }
    const updated = await this.routineRow(ownerEmail, String(row.id));
    return updated ? (await this.aggregate(ownerEmail, updated) as RoutineAggregate) : null;
  }

  async listRoutineVersions(ownerEmail: string, idOrCode: string) {
    await this.ready(ownerEmail);
    const routine = await this.routineRow(ownerEmail, idOrCode);
    if (!routine) return [];
    const ids = await this.d1.prepare("SELECT id FROM routine_versions WHERE owner_email = ? AND routine_id = ? ORDER BY version_number DESC")
      .bind(ownerEmail, routine.id).all<{ id: string }>();
    return (await Promise.all(ids.results.map((row) => this.loadVersion(ownerEmail, String(routine.id), row.id)))).filter(Boolean) as RoutineVersion[];
  }

  async getRoutineVersion(ownerEmail: string, idOrCode: string, versionId: string) {
    await this.ready(ownerEmail);
    const routine = await this.routineRow(ownerEmail, idOrCode);
    return routine ? this.loadVersion(ownerEmail, String(routine.id), versionId) : null;
  }

  async createRoutineVersion(ownerEmail: string, idOrCode: string, input: RoutineVersionInput) {
    await this.ready(ownerEmail);
    const routine = await this.routineRow(ownerEmail, idOrCode);
    if (!routine) throw new Error("Routine not found.");
    const latest = await this.d1.prepare("SELECT MAX(version_number) AS versionNumber FROM routine_versions WHERE routine_id = ?")
      .bind(routine.id).first<{ versionNumber: number | null }>();
    return this.insertVersion(ownerEmail, String(routine.id), Number(latest?.versionNumber ?? 0) + 1, input);
  }

  async updateRoutineVersion(ownerEmail: string, idOrCode: string, versionId: string, input: RoutineVersionInput) {
    await this.ready(ownerEmail);
    const routine = await this.routineRow(ownerEmail, idOrCode);
    if (!routine) return null;
    const existing = await this.loadVersion(ownerEmail, String(routine.id), versionId);
    if (!existing) return null;
    if (existing.status !== "draft") throw new Error("Published routine versions are immutable. Create a new version instead.");
    for (const exerciseId of new Set(input.exercises.map((exercise) => exercise.exerciseId))) {
      const owned = await this.d1.prepare("SELECT id FROM exercise_catalog WHERE id = ? AND owner_email = ? AND is_active = 1")
        .bind(exerciseId, ownerEmail).first<{ id: string }>();
      if (!owned) throw new Error("A routine references an unavailable exercise.");
    }
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.d1.prepare("DELETE FROM routine_set_templates WHERE routine_exercise_id IN (SELECT id FROM routine_version_exercises WHERE routine_version_id = ?)").bind(versionId),
      this.d1.prepare("DELETE FROM routine_version_exercises WHERE routine_version_id = ?").bind(versionId),
      this.d1.prepare(`UPDATE routine_versions SET focus = ?, summary = ?, duration_min = ?, updated_at = ?
        WHERE id = ? AND routine_id = ? AND owner_email = ? AND status = 'draft'`)
        .bind(input.focus, input.summary, input.durationMin, now, versionId, routine.id, ownerEmail),
    ];
    for (const exercise of input.exercises) {
      const placementId = crypto.randomUUID();
      statements.push(this.d1.prepare(`INSERT INTO routine_version_exercises (
        id, owner_email, routine_version_id, exercise_id, position, superset_group,
        instructions, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(placementId, ownerEmail, versionId, exercise.exerciseId, exercise.position,
          exercise.supersetGroup ?? null, exercise.instructions ?? "", exercise.notes ?? "", now, now));
      for (const set of exercise.sets) {
        statements.push(this.d1.prepare(`INSERT INTO routine_set_templates (
          id, owner_email, routine_exercise_id, position, set_type, target_type, target_min,
          target_max, target_display, target_rir_min, target_rir_max, rest_after_sec, rest_rule,
          load_instruction, side_mode, tempo, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), ownerEmail, placementId, set.position, set.setType, set.targetType,
            set.targetMin, set.targetMax, set.targetDisplay, set.targetRirMin, set.targetRirMax,
            set.restAfterSec, set.restRule, set.loadInstruction, set.sideMode, set.tempo, set.notes, now, now));
      }
    }
    await this.d1.batch(statements);
    return this.loadVersion(ownerEmail, String(routine.id), versionId);
  }

  async deleteRoutineVersion(ownerEmail: string, idOrCode: string, versionId: string) {
    await this.ready(ownerEmail);
    const routine = await this.routineRow(ownerEmail, idOrCode);
    if (!routine) return false;
    const version = await this.loadVersion(ownerEmail, String(routine.id), versionId);
    if (!version) return false;
    if (version.status !== "draft") throw new Error("Published routine versions cannot be deleted.");
    await this.d1.batch([
      this.d1.prepare("DELETE FROM routine_set_templates WHERE routine_exercise_id IN (SELECT id FROM routine_version_exercises WHERE routine_version_id = ?)").bind(versionId),
      this.d1.prepare("DELETE FROM routine_version_exercises WHERE routine_version_id = ?").bind(versionId),
      this.d1.prepare("DELETE FROM routine_versions WHERE id = ?").bind(versionId),
    ]);
    return true;
  }

  async publishRoutineVersion(
    ownerEmail: string,
    idOrCode: string,
    versionId: string,
    expectedCurrentVersionId?: string,
  ) {
    await this.ready(ownerEmail);
    const routineRow = await this.routineRow(ownerEmail, idOrCode);
    if (!routineRow) return null;
    const routineId = String(routineRow.id);
    const version = await this.loadVersion(ownerEmail, routineId, versionId);
    if (!version) return null;
    const now = new Date().toISOString();
    const code = String(routineRow.code);
    const publishedGuard = `EXISTS (
      SELECT 1 FROM routines publish_guard
      WHERE publish_guard.id = ? AND publish_guard.owner_email = ?
        AND publish_guard.current_version_id = ? AND publish_guard.updated_at = ?
    )`;
    const routineUpdate = expectedCurrentVersionId === undefined
      ? this.d1.prepare(`UPDATE routines SET version = ?, focus = ?, summary = ?, duration_min = ?,
          current_version_id = ?, updated_at = ? WHERE id = ? AND owner_email = ?`)
        .bind(version.versionNumber, version.focus, version.summary, version.durationMin, versionId, now, routineId, ownerEmail)
      : this.d1.prepare(`UPDATE routines SET version = ?, focus = ?, summary = ?, duration_min = ?,
          current_version_id = ?, updated_at = ?
          WHERE id = ? AND owner_email = ? AND current_version_id = ?`)
        .bind(
          version.versionNumber,
          version.focus,
          version.summary,
          version.durationMin,
          versionId,
          now,
          routineId,
          ownerEmail,
          expectedCurrentVersionId,
        );
    const statements: D1PreparedStatement[] = [
      routineUpdate,
      this.d1.prepare(`UPDATE routine_versions SET status = 'superseded', updated_at = ?
        WHERE routine_id = ? AND status = 'published' AND id <> ? AND ${publishedGuard}`)
        .bind(now, routineId, versionId, routineId, ownerEmail, versionId, now),
      this.d1.prepare(`UPDATE routine_versions SET status = 'published',
        published_at = COALESCE(published_at, ?), updated_at = ?
        WHERE id = ? AND routine_id = ? AND ${publishedGuard}`)
        .bind(now, now, versionId, routineId, routineId, ownerEmail, versionId, now),
      this.d1.prepare(`DELETE FROM exercises WHERE owner_email = ? AND routine_code = ?
        AND ${publishedGuard}`)
        .bind(ownerEmail, code, routineId, ownerEmail, versionId, now),
    ];

    for (const exercise of version.exercises) {
      const catalog = await this.getExercise(ownerEmail, exercise.exerciseId);
      if (!catalog?.isActive) throw new Error("A routine references an unavailable exercise.");
      const warmups = exercise.sets.filter((set) => set.setType === "warmup");
      const regular = exercise.sets.filter((set) => set.setType === "regular" || set.setType === "emom");
      const failures = exercise.sets.filter((set) => set.setType === "failure");
      const drops = exercise.sets.filter((set) => set.setType === "drop");
      const targetParts: string[] = [];
      const regularTargets = [...new Set(regular.map((set) => set.targetDisplay))];
      if (regularTargets.length) targetParts.push(regularTargets.join("; "));
      if (failures.length) targetParts.push(`${failures[0].targetDisplay} failure`);
      if (drops.length) targetParts.push(`${drops[0].targetDisplay} drop`);
      const workSet = regular[0] ?? failures[0] ?? drops[0] ?? warmups[0];
      let rest = workSet ? formatRest(workSet.restAfterSec, workSet.restRule) : "0 sec";
      if (drops.length && failures.length) rest = `${formatRest(drops[0].restAfterSec, drops[0].restRule)}; no rest before drop`;
      statements.push(this.d1.prepare(`INSERT INTO exercises (
        id, owner_email, routine_code, exercise_order, name, warmup, warmup_sets,
        regular_sets, failure_sets, drop_sets, target, rest, effort, purpose,
        load_type, weight_unit, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lb', ?
        WHERE ${publishedGuard}`)
        .bind(`${ownerEmail}::exercise::${code}::${exercise.position}`, ownerEmail, code, exercise.position,
          catalog.name, warmups.map((set) => set.targetDisplay).join("; ") || "None", warmups.length,
          regular.length, failures.length, drops.length, targetParts.join("; ") || workSet?.targetDisplay || "",
          rest, workSet ? formatRir(workSet, exercise.instructions) : exercise.instructions,
          exercise.notes, catalog.defaultLoadType, now,
          routineId, ownerEmail, versionId, now));
    }
    const results = await this.d1.batch(statements);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return null;
    const updated = await this.routineRow(ownerEmail, routineId);
    return updated ? this.aggregate(ownerEmail, updated) : null;
  }

  private async workoutFromRow(ownerEmail: string, row: Row): Promise<Workout> {
    const exerciseRows = await this.d1.prepare(`SELECT id, owner_email AS ownerEmail, workout_id AS workoutId,
      exercise_id AS exerciseId, source_routine_exercise_id AS sourceRoutineExerciseId,
      position, exercise_name_snapshot AS exerciseNameSnapshot, load_type_snapshot AS loadTypeSnapshot,
      side_mode_snapshot AS sideModeSnapshot, status, notes, created_at AS createdAt, updated_at AS updatedAt
      FROM workout_exercises WHERE owner_email = ? AND workout_id = ? ORDER BY position`)
      .bind(ownerEmail, row.id).all<Row>();
    const exercises: WorkoutExercise[] = [];
    for (const exercise of exerciseRows.results) {
      const setRows = await this.d1.prepare(`SELECT id, owner_email AS ownerEmail, workout_id AS workoutId,
        workout_exercise_id AS workoutExerciseId, source_routine_set_id AS sourceRoutineSetId,
        prescribed_set_id AS prescribedSetId, position, set_type AS setType,
        planned_target_type AS plannedTargetType, planned_target_min AS plannedTargetMin,
        planned_target_max AS plannedTargetMax, planned_target_display AS plannedTargetDisplay,
        planned_rir_min AS plannedRirMin, planned_rir_max AS plannedRirMax,
        planned_rest_sec AS plannedRestSec, planned_rest_rule AS plannedRestRule,
        actual_reps AS actualReps, actual_reps_left AS actualRepsLeft,
        actual_reps_right AS actualRepsRight, actual_duration_sec AS actualDurationSec,
        actual_weight AS actualWeight, weight_unit AS weightUnit, actual_rir AS actualRir,
        actual_rest_sec AS actualRestSec, rest_started_at AS restStartedAt,
        rest_ended_at AS restEndedAt, rest_skipped AS restSkipped, status,
        started_at AS startedAt, elapsed_seconds AS elapsedSeconds, completed_at AS completedAt,
        notes, created_at AS createdAt, updated_at AS updatedAt
        FROM workout_sets WHERE owner_email = ? AND workout_exercise_id = ? ORDER BY position`)
        .bind(ownerEmail, exercise.id).all<Row>();
      exercises.push({
        id: String(exercise.id), ownerEmail: String(exercise.ownerEmail), workoutId: String(exercise.workoutId),
        exerciseId: String(exercise.exerciseId), sourceRoutineExerciseId: exercise.sourceRoutineExerciseId === null ? null : String(exercise.sourceRoutineExerciseId),
        position: Number(exercise.position), exerciseNameSnapshot: String(exercise.exerciseNameSnapshot),
        loadTypeSnapshot: String(exercise.loadTypeSnapshot) as LoadType, sideModeSnapshot: String(exercise.sideModeSnapshot) as SideMode,
        status: String(exercise.status) as WorkoutItemStatus, notes: String(exercise.notes),
        createdAt: String(exercise.createdAt), updatedAt: String(exercise.updatedAt),
        sets: setRows.results.map((set): WorkoutSet => ({
          id: String(set.id), ownerEmail: String(set.ownerEmail), workoutId: String(set.workoutId), workoutExerciseId: String(set.workoutExerciseId),
          sourceRoutineSetId: set.sourceRoutineSetId === null ? null : String(set.sourceRoutineSetId), prescribedSetId: String(set.prescribedSetId),
          position: Number(set.position), setType: String(set.setType) as WorkoutSet["setType"], plannedTargetType: String(set.plannedTargetType) as WorkoutSet["plannedTargetType"],
          plannedTargetMin: numberOrNull(set.plannedTargetMin), plannedTargetMax: numberOrNull(set.plannedTargetMax), plannedTargetDisplay: String(set.plannedTargetDisplay),
          plannedRirMin: numberOrNull(set.plannedRirMin), plannedRirMax: numberOrNull(set.plannedRirMax), plannedRestSec: Number(set.plannedRestSec),
          plannedRestRule: String(set.plannedRestRule) as WorkoutSet["plannedRestRule"], actualReps: numberOrNull(set.actualReps),
          actualRepsLeft: numberOrNull(set.actualRepsLeft), actualRepsRight: numberOrNull(set.actualRepsRight), actualDurationSec: numberOrNull(set.actualDurationSec),
          actualWeight: numberOrNull(set.actualWeight), weightUnit: String(set.weightUnit), actualRir: numberOrNull(set.actualRir), actualRestSec: numberOrNull(set.actualRestSec),
          restStartedAt: set.restStartedAt === null ? null : String(set.restStartedAt), restEndedAt: set.restEndedAt === null ? null : String(set.restEndedAt),
          restSkipped: bool(set.restSkipped), status: String(set.status) as WorkoutItemStatus,
          startedAt: set.startedAt === null ? null : String(set.startedAt), elapsedSeconds: numberOrNull(set.elapsedSeconds),
          completedAt: set.completedAt === null ? null : String(set.completedAt),
          notes: String(set.notes), createdAt: String(set.createdAt), updatedAt: String(set.updatedAt),
        })),
      });
    }
    return {
      id: String(row.id), ownerEmail: String(row.ownerEmail), routineId: row.routineId === null ? null : String(row.routineId),
      routineVersionId: row.routineVersionId === null ? null : String(row.routineVersionId), routineCode: String(row.routineCode),
      status: String(row.status) as WorkoutStatus, startedAt: String(row.startedAt), completedAt: row.completedAt === null ? null : String(row.completedAt),
      bodyWeight: numberOrNull(row.bodyWeight), weightUnit: String(row.weightUnit), notes: String(row.notes), isArchived: bool(row.isArchived),
      exercises, updatedAt: String(row.updatedAt),
    };
  }

  private workoutSelect() {
    return `SELECT id, owner_email AS ownerEmail, routine_id AS routineId, routine_version_id AS routineVersionId,
      routine_code AS routineCode, status, started_at AS startedAt, completed_at AS completedAt,
      body_weight AS bodyWeight, weight_unit AS weightUnit, session_notes AS notes,
      is_archived AS isArchived, updated_at AS updatedAt FROM workout_sessions`;
  }

  async listWorkouts(ownerEmail: string, query: WorkoutQuery = {}) {
    await this.ready(ownerEmail);
    const clauses = ["owner_email = ?"];
    const values: unknown[] = [ownerEmail];
    if (!query.includeArchived) clauses.push("is_archived = 0");
    if (query.status) { clauses.push("status = ?"); values.push(query.status); }
    const rows = await this.d1.prepare(`${this.workoutSelect()} WHERE ${clauses.join(" AND ")} ORDER BY started_at DESC`)
      .bind(...values).all<Row>();
    return Promise.all(rows.results.map((row) => this.workoutFromRow(ownerEmail, row)));
  }

  async listWorkoutHistory(
    ownerEmail: string,
    query: WorkoutHistoryQuery = {},
  ): Promise<WorkoutHistoryPage> {
    await this.ready(ownerEmail);
    const clauses = [
      "ws.owner_email = ?",
      "ws.status <> 'In Progress'",
      "ws.is_archived = 0",
    ];
    const values: unknown[] = [ownerEmail];
    if (query.from) {
      clauses.push("ws.started_at >= ?");
      values.push(query.from);
    }
    if (query.to) {
      clauses.push("ws.started_at < ?");
      values.push(query.to);
    }
    if (query.routineCode?.trim()) {
      clauses.push("ws.routine_code = ?");
      values.push(query.routineCode.trim().toUpperCase());
    }
    if (query.status) {
      clauses.push("ws.status = ?");
      values.push(query.status);
    }
    if (query.exerciseSearch?.trim()) {
      clauses.push(`EXISTS (
        SELECT 1 FROM workout_exercises filtered_exercise
        WHERE filtered_exercise.workout_id = ws.id
          AND filtered_exercise.owner_email = ws.owner_email
          AND LOWER(filtered_exercise.exercise_name_snapshot) LIKE ?
      )`);
      values.push(`%${query.exerciseSearch.trim().toLowerCase()}%`);
    }

    const where = clauses.join(" AND ");
    const requestedLimit = Number(query.limit ?? 20);
    const requestedOffset = Number(query.offset ?? 0);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(50, Math.max(1, Math.round(requestedLimit)))
      : 20;
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.round(requestedOffset))
      : 0;
    const rows = await this.d1
      .prepare(`SELECT ws.id, ws.routine_code AS routineCode, ws.status,
        ws.snapshot_json AS snapshotJson,
        ws.started_at AS startedAt, ws.completed_at AS completedAt,
        ws.completed_sets AS completedSets, ws.skipped_sets AS skippedSets,
        ws.total_sets AS totalSets,
        (SELECT COUNT(*) FROM workout_exercises count_exercise
          WHERE count_exercise.workout_id = ws.id
            AND count_exercise.owner_email = ws.owner_email) AS exerciseCount,
        (SELECT GROUP_CONCAT(DISTINCT name_exercise.exercise_name_snapshot)
          FROM workout_exercises name_exercise
          WHERE name_exercise.workout_id = ws.id
            AND name_exercise.owner_email = ws.owner_email) AS exerciseNames,
        (SELECT GROUP_CONCAT(DISTINCT exercise_muscles.muscle_group)
          FROM workout_exercises muscle_exercise
          INNER JOIN exercise_muscles
            ON exercise_muscles.exercise_id = muscle_exercise.exercise_id
          WHERE muscle_exercise.workout_id = ws.id
            AND muscle_exercise.owner_email = ws.owner_email
            AND exercise_muscles.role = 'primary') AS muscleGroups
        FROM workout_sessions ws
        WHERE ${where}
        ORDER BY ws.started_at DESC
        LIMIT ? OFFSET ?`)
      .bind(...values, limit + 1, offset)
      .all<Row>();
    const pageRows = rows.results.slice(0, limit);
    const workouts = pageRows.map((row): WorkoutHistorySummary => {
      const startedAt = String(row.startedAt);
      const completedAt = row.completedAt === null ? null : String(row.completedAt);
      const elapsed = completedAt
        ? Math.max(
          0,
          Math.round(
            (new Date(completedAt).getTime() - new Date(startedAt).getTime()) /
              1000,
          ),
        )
        : 0;
      return {
        id: String(row.id),
        routineCode: String(row.routineCode),
        routineTitle: routineTitleFromSnapshot(row.snapshotJson, String(row.routineCode)),
        status: String(row.status) as WorkoutHistorySummary["status"],
        startedAt,
        completedAt,
        durationSeconds: elapsed,
        completedSets: Number(row.completedSets),
        skippedSets: Number(row.skippedSets),
        totalSets: Number(row.totalSets),
        exerciseCount: Number(row.exerciseCount),
        exerciseNames: String(row.exerciseNames ?? "").split(",").filter(Boolean),
        muscleGroups: String(row.muscleGroups ?? "").split(",").filter(Boolean),
      };
    });
    const stats = await this.d1
      .prepare(`SELECT COUNT(*) AS workoutCount,
        COALESCE(SUM(ws.completed_sets), 0) AS completedSets,
        COALESCE(SUM(
          CASE WHEN ws.completed_at IS NULL THEN 0
          ELSE MAX(0, ROUND(
            (julianday(ws.completed_at) - julianday(ws.started_at)) * 86400
          )) END
        ), 0) AS durationSeconds
        FROM workout_sessions ws WHERE ${where}`)
      .bind(...values)
      .first<Row>();

    return {
      workouts,
      stats: {
        workoutCount: Number(stats?.workoutCount ?? 0),
        completedSets: Number(stats?.completedSets ?? 0),
        durationSeconds: Number(stats?.durationSeconds ?? 0),
      },
      hasMore: rows.results.length > limit,
      offset,
    };
  }

  async getWorkout(ownerEmail: string, id: string) {
    await this.ready(ownerEmail);
    const row = await this.d1.prepare(`${this.workoutSelect()} WHERE owner_email = ? AND id = ?`).bind(ownerEmail, id).first<Row>();
    return row ? this.workoutFromRow(ownerEmail, row) : null;
  }

  async updateWorkout(ownerEmail: string, id: string, input: { bodyWeight?: number | null; notes?: string; status?: string }) {
    await this.ready(ownerEmail);
    const existing = await this.getWorkout(ownerEmail, id);
    if (!existing) return null;
    const now = new Date().toISOString();
    await this.d1.prepare(`UPDATE workout_sessions SET body_weight = ?, session_notes = ?, status = ?,
      completed_at = CASE WHEN ? IN ('Completed', 'Partial', 'Abandoned') THEN COALESCE(completed_at, ?) ELSE completed_at END,
      updated_at = ? WHERE id = ? AND owner_email = ?`)
      .bind(input.bodyWeight === undefined ? existing.bodyWeight : input.bodyWeight,
        input.notes === undefined ? existing.notes : input.notes, input.status ?? existing.status,
        input.status ?? existing.status, now, now, id, ownerEmail).run();
    return this.getWorkout(ownerEmail, id);
  }

  async archiveWorkout(ownerEmail: string, id: string) {
    await this.ready(ownerEmail);
    const now = new Date().toISOString();
    const result = await this.d1.prepare(`UPDATE workout_sessions SET is_archived = 1,
      status = CASE WHEN status = 'In Progress' THEN 'Abandoned' ELSE status END,
      completed_at = CASE WHEN status = 'In Progress' THEN COALESCE(completed_at, ?) ELSE completed_at END,
      rest_ends_at = NULL, updated_at = ? WHERE id = ? AND owner_email = ?`)
      .bind(now, now, id, ownerEmail).run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  async discardWorkout(ownerEmail: string, id: string) {
    await this.ready(ownerEmail);
    const existing = await this.d1.prepare(
      "SELECT status FROM workout_sessions WHERE id = ? AND owner_email = ?",
    ).bind(id, ownerEmail).first<{ status: string }>();
    if (!existing) return "not_found" as const;
    if (existing.status !== "In Progress") return "not_in_progress" as const;

    await this.d1.batch([
      this.d1.prepare(`DELETE FROM set_performances
        WHERE owner_email = ? AND session_id = ?
        AND EXISTS (
          SELECT 1 FROM workout_sessions ws
          WHERE ws.id = ? AND ws.owner_email = ? AND ws.status = 'In Progress'
        )`).bind(ownerEmail, id, id, ownerEmail),
      this.d1.prepare(`DELETE FROM workout_sets
        WHERE owner_email = ? AND workout_id = ?
        AND EXISTS (
          SELECT 1 FROM workout_sessions ws
          WHERE ws.id = ? AND ws.owner_email = ? AND ws.status = 'In Progress'
        )`).bind(ownerEmail, id, id, ownerEmail),
      this.d1.prepare(`DELETE FROM workout_exercises
        WHERE owner_email = ? AND workout_id = ?
        AND EXISTS (
          SELECT 1 FROM workout_sessions ws
          WHERE ws.id = ? AND ws.owner_email = ? AND ws.status = 'In Progress'
        )`).bind(ownerEmail, id, id, ownerEmail),
      this.d1.prepare(`DELETE FROM workout_sessions
        WHERE id = ? AND owner_email = ? AND status = 'In Progress'`)
        .bind(id, ownerEmail),
    ]);

    const remaining = await this.d1.prepare(
      "SELECT status FROM workout_sessions WHERE id = ? AND owner_email = ?",
    ).bind(id, ownerEmail).first<{ status: string }>();
    return remaining ? "not_in_progress" as const : "discarded" as const;
  }

  async correctWorkoutSet(ownerEmail: string, workoutId: string, setId: string, input: WorkoutSetCorrection) {
    await this.ready(ownerEmail);
    const existing = await this.d1.prepare(`SELECT prescribed_set_id AS prescribedSetId, actual_reps AS actualReps,
      actual_reps_left AS actualRepsLeft, actual_reps_right AS actualRepsRight,
      actual_duration_sec AS actualDurationSec, actual_weight AS actualWeight, actual_rir AS actualRir,
      actual_rest_sec AS actualRestSec, rest_skipped AS restSkipped, notes, status
      FROM workout_sets WHERE id = ? AND workout_id = ? AND owner_email = ?`)
      .bind(setId, workoutId, ownerEmail).first<Row>();
    if (!existing) return null;
    const now = new Date().toISOString();
    const status = input.status ?? String(existing.status);
    const value = <T>(incoming: T | undefined, prior: unknown) => incoming === undefined ? prior : incoming;
    await this.d1.batch([
      this.d1.prepare(`UPDATE workout_sets SET actual_reps = ?, actual_reps_left = ?, actual_reps_right = ?,
        actual_duration_sec = ?, actual_weight = ?, actual_rir = ?, actual_rest_sec = ?, rest_skipped = ?,
        notes = ?, status = ?, completed_at = CASE WHEN ? IN ('completed', 'skipped') THEN COALESCE(completed_at, ?) ELSE NULL END,
        updated_at = ? WHERE id = ? AND workout_id = ? AND owner_email = ?`)
        .bind(value(input.actualReps, existing.actualReps), value(input.actualRepsLeft, existing.actualRepsLeft),
          value(input.actualRepsRight, existing.actualRepsRight), value(input.actualDurationSec, existing.actualDurationSec),
          value(input.actualWeight, existing.actualWeight), value(input.actualRir, existing.actualRir),
          value(input.actualRestSec, existing.actualRestSec), Number(value(input.restSkipped, bool(existing.restSkipped))),
          value(input.notes, existing.notes), status, status, now, now, setId, workoutId, ownerEmail),
      this.d1.prepare(`UPDATE set_performances SET actual_reps = ?, actual_duration_sec = ?, actual_weight = ?,
        rest_skipped = ?, notes = ?, status = ?, updated_at = ?
        WHERE session_id = ? AND prescribed_set_id = ? AND owner_email = ?`)
        .bind(value(input.actualReps, existing.actualReps), value(input.actualDurationSec, existing.actualDurationSec),
          value(input.actualWeight, existing.actualWeight), Number(value(input.restSkipped, bool(existing.restSkipped))),
          value(input.notes, existing.notes), status === "completed" ? "Completed" : status === "skipped" ? "Skipped" : "Planned",
          now, workoutId, existing.prescribedSetId, ownerEmail),
    ]);
    const counts = await this.d1.prepare(`SELECT
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedSets,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skippedSets
      FROM workout_sets WHERE workout_id = ? AND owner_email = ?`)
      .bind(workoutId, ownerEmail)
      .first<Row>();
    await this.d1.batch([
      this.d1.prepare(`UPDATE workout_sessions SET completed_sets = ?,
        skipped_sets = ?, updated_at = ? WHERE id = ? AND owner_email = ?`)
        .bind(
          Number(counts?.completedSets ?? 0),
          Number(counts?.skippedSets ?? 0),
          now,
          workoutId,
          ownerEmail,
        ),
      this.d1.prepare(`UPDATE workout_exercises SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM workout_sets ws
          WHERE ws.workout_exercise_id = workout_exercises.id
            AND ws.status = 'completed'
        ) THEN 'completed'
        WHEN EXISTS (
          SELECT 1 FROM workout_sets ws
          WHERE ws.workout_exercise_id = workout_exercises.id
            AND ws.status = 'skipped'
        ) THEN 'skipped'
        ELSE 'planned'
        END, updated_at = ?
        WHERE workout_id = ? AND owner_email = ?`)
        .bind(now, workoutId, ownerEmail),
    ]);
    return this.getWorkout(ownerEmail, workoutId);
  }
}
