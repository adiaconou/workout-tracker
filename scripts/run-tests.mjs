import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const minimumNode = [22, 13, 0];
const currentNode = process.versions.node.split(".").map(Number);
const supported = minimumNode.every((part, index) => {
  const currentPart = currentNode[index] ?? 0;
  const earlierPartsMatch = minimumNode
    .slice(0, index)
    .every((earlierPart, earlierIndex) =>
      (currentNode[earlierIndex] ?? 0) === earlierPart);

  return !earlierPartsMatch || currentPart >= part;
});

if (!supported) {
  console.error(
    `Tests require Node >=${minimumNode.join(".")}; current runtime is ${process.versions.node}.`,
  );
  process.exit(1);
}

const testDirectory = resolve("tests");
const testFiles = findTestFiles(testDirectory)
  .sort((left, right) => left.localeCompare(right));

if (testFiles.length === 0) {
  console.error("No tests matching tests/**/*.test.{mjs,ts} were found.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    ...testFiles,
  ],
  {
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.signal) {
  console.error(`Test process terminated by ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);

function findTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(entryPath);
    return entry.isFile() && /\.test\.(?:mjs|ts)$/.test(entry.name)
      ? [entryPath]
      : [];
  });
}
