import { getEntityRepository } from "./db";
import { ExerciseService } from "./exercises/service";
import { RoutineService } from "./routines/service";
import { WorkoutService } from "./workouts/service";

export function getEntityServices() {
  const repository = getEntityRepository();
  return {
    exercises: new ExerciseService(repository),
    routines: new RoutineService(repository),
    workouts: new WorkoutService(repository),
  };
}
