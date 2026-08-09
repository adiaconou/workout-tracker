import { getEntityRepository, getProgramRepository } from "./db";
import { ExerciseService } from "./exercises/service";
import { ProgramService } from "./programs/service";
import { RoutineService } from "./routines/service";
import { WorkoutService } from "./workouts/service";

export function getEntityServices() {
  const repository = getEntityRepository();
  return {
    exercises: new ExerciseService(repository),
    programs: new ProgramService(getProgramRepository()),
    routines: new RoutineService(repository),
    workouts: new WorkoutService(repository),
  };
}
