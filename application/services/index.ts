import { getEntityRepository } from "../../infrastructure/d1";
import { ExerciseService, RoutineService, WorkoutService } from "./entity-services";

export function getEntityServices() {
  const repository = getEntityRepository();
  return {
    exercises: new ExerciseService(repository),
    routines: new RoutineService(repository),
    workouts: new WorkoutService(repository),
  };
}

export * from "./entity-services";
