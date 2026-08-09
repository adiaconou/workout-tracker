import { env } from "cloudflare:workers";
import { D1EntityRepository } from "./entity-repository";
import { D1ProgramRepository } from "./program-repository";

let repository: D1EntityRepository | null = null;
let programRepository: D1ProgramRepository | null = null;

export function getEntityRepository() {
  if (!env.DB) throw new Error("The workout database is unavailable.");
  repository ??= new D1EntityRepository(env.DB);
  return repository;
}

export function getProgramRepository() {
  if (!env.DB) throw new Error("The workout database is unavailable.");
  programRepository ??= new D1ProgramRepository(env.DB);
  return programRepository;
}
