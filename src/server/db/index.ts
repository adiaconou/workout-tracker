import { env } from "cloudflare:workers";
import { D1EntityRepository } from "./entity-repository";

let repository: D1EntityRepository | null = null;

export function getEntityRepository() {
  if (!env.DB) throw new Error("The workout database is unavailable.");
  repository ??= new D1EntityRepository(env.DB);
  return repository;
}
