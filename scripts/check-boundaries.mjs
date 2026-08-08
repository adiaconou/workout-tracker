import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = path.join(root, "src");

// This user-owned scratch copy predates the refactor and is explicitly excluded
// from TypeScript compilation. It is not part of the authored runtime graph.
const ignoredSourceFiles = new Set([
  "src/features/routines/routine-detail-screen (1).tsx",
]);
const ignoredDirectories = new Set([
  ".expo",
  ".git",
  ".tmp",
  "coverage",
  "dist",
  "node_modules",
]);
const platformSuffixes = ["", ".native", ".web", ".android", ".ios"];
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];
const allowedImports = new Map([
  ["domain", new Set(["domain"])],
  ["contracts", new Set(["contracts", "domain"])],
  ["client", new Set(["client", "domain", "contracts"])],
  ["server", new Set(["server", "domain", "contracts"])],
  ["app", new Set(["app", "client", "domain", "contracts"])],
  ["worker", new Set(["worker", "server"])],
]);
const clientSharedAreas = new Set(["api", "ui"]);
const serverSharedAreas = new Set(["db"]);
const serverCompositionRoots = new Set([
  "src/server/router.ts",
  "src/server/services.ts",
]);
const legacyServerEdges = new Set([
  "src/server/db/training-store.ts->src/server/services.ts",
]);
const requiredCoverageSettings = new Map([
  ["all", true],
  ["check-coverage", true],
  ["per-file", true],
  ["statements", 100],
  ["branches", 100],
  ["functions", 100],
  ["lines", 100],
]);

const violations = [];
const projectConfig = readProjectConfig();
const aliases = readAliases(projectConfig.options);
const sourceSymlinks = [];
const allTypeScriptFiles = findFiles(
  root,
  (file) => /\.(?:[cm]?ts|tsx)$/u.test(file),
  (file) => {
    if (isWithin(sourceRoot, file)) sourceSymlinks.push(file);
  },
);
const sourceFiles = allTypeScriptFiles.filter(
  (file) => isWithin(sourceRoot, file) && !ignoredSourceFiles.has(relative(file)),
);
const featureGraphs = {
  client: createFeatureGraph(),
  server: createFeatureGraph(),
};

for (const file of sourceSymlinks) {
  violations.push({
    file,
    line: 1,
    kind: "source-symlink",
    message: "source-tree symlinks are not allowed because they can bypass lexical boundaries",
  });
}

for (const file of allTypeScriptFiles) {
  if (!isWithin(sourceRoot, file) && !isAllowedOutsideSource(file)) {
    violations.push({
      file,
      line: 1,
      kind: "source-location",
      message: "authored TypeScript runtime code must live under src/",
    });
  }
}

for (const file of sourceFiles) {
  const sourceLayer = layerFor(file);
  if (!sourceLayer) {
    violations.push({
      file,
      line: 1,
      kind: "source-layer",
      message: "source file is outside the supported app, client, contracts, domain, server, or worker layers",
    });
    continue;
  }

  const sourceText = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );

  if (sourceLayer === "contracts") checkContractStatements(file, parsed);

  for (const imported of importedSpecifiers(parsed)) {
    const resolution = resolveLocalImport(file, imported.specifier);
    if (!resolution.local) {
      if (sourceLayer === "domain" || sourceLayer === "contracts") {
        violations.push({
          file,
          line: imported.line,
          kind: "external-dependency",
          message: `${sourceLayer} must not import external packages: ${JSON.stringify(imported.specifier)}`,
        });
      }
      continue;
    }
    if (resolution.files.length === 0) {
      violations.push({
        file,
        line: imported.line,
        kind: "unresolved-import",
        message: `cannot resolve local import ${JSON.stringify(imported.specifier)}`,
      });
      continue;
    }

    for (const target of resolution.files) {
      const targetLayer = layerFor(target);
      if (!targetLayer) {
        violations.push({
          file,
          line: imported.line,
          kind: "boundary",
          message: `${JSON.stringify(imported.specifier)} resolves outside the supported source layers (${relative(target)})`,
        });
        continue;
      }
      if (!allowedImports.get(sourceLayer)?.has(targetLayer)) {
        violations.push({
          file,
          line: imported.line,
          kind: "boundary",
          message: `${sourceLayer} may not import ${targetLayer}: ${JSON.stringify(imported.specifier)} -> ${relative(target)}`,
        });
        continue;
      }
      if (sourceLayer === "contracts" && !imported.typeOnly) {
        violations.push({
          file,
          line: imported.line,
          kind: "contract-runtime-import",
          message: `contracts may only use type-only imports: ${JSON.stringify(imported.specifier)}`,
        });
      }
      if (sourceLayer === targetLayer && (sourceLayer === "client" || sourceLayer === "server")) {
        checkFeatureBoundary(sourceLayer, file, target, imported);
      }
    }
  }
}

for (const side of ["client", "server"]) {
  for (const cycle of findFeatureCycles(featureGraphs[side])) {
    const evidence = featureGraphs[side].evidence.get(`${cycle[0]}->${cycle[1]}`);
    violations.push({
      file: evidence?.file ?? path.join(sourceRoot, side),
      line: evidence?.line ?? 1,
      kind: "feature-cycle",
      message: `${side} feature dependency cycle: ${cycle.join(" -> ")}`,
    });
  }
}

checkCoverageConfiguration();

violations.sort((left, right) =>
  relative(left.file).localeCompare(relative(right.file)) ||
  left.line - right.line ||
  left.kind.localeCompare(right.kind) ||
  left.message.localeCompare(right.message));

if (violations.length > 0) {
  console.error(`Architecture lint failed with ${violations.length} violation${violations.length === 1 ? "" : "s"}:`);
  for (const violation of violations) {
    console.error(`- [${violation.kind}] ${relative(violation.file)}:${violation.line} ${violation.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Architecture lint passed (${sourceFiles.length} source files checked).`);
}

function checkContractStatements(file, sourceFile) {
  for (const statement of sourceFile.statements) {
    if (isTypeOnlyContractStatement(statement)) continue;
    const location = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
    violations.push({
      file,
      line: location.line + 1,
      kind: "contract-runtime-code",
      message: "contracts may declare and re-export types only; move runtime behavior to domain, client, or server",
    });
  }
}

function isTypeOnlyContractStatement(statement) {
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  ) {
    return true;
  }
  if (hasDeclareModifier(statement)) return true;
  if (ts.isImportDeclaration(statement)) return importDeclarationIsTypeOnly(statement);
  if (ts.isImportEqualsDeclaration(statement)) return Boolean(statement.isTypeOnly);
  if (ts.isExportDeclaration(statement)) return exportDeclarationIsTypeOnly(statement);
  return false;
}

function hasDeclareModifier(node) {
  return Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword));
}

function checkFeatureBoundary(side, source, target, imported) {
  const sourceArea = areaFor(side, source);
  const targetArea = areaFor(side, target);
  if (
    side === "server" &&
    sourceArea === "db" &&
    relative(target) === "src/server/services.ts"
  ) {
    const edge = `${relative(source)}->${relative(target)}`;
    if (!legacyServerEdges.has(edge)) {
      violations.push({
        file: source,
        line: imported.line,
        kind: "feature-boundary",
        message: `database infrastructure may not add a dependency on service composition: ${JSON.stringify(imported.specifier)} -> ${relative(target)}`,
      });
    }
    return;
  }
  if (!targetArea || sourceArea === targetArea) return;

  const sharedAreas = side === "client" ? clientSharedAreas : serverSharedAreas;
  const sourceIsFeature = Boolean(sourceArea && !sharedAreas.has(sourceArea));
  const targetIsFeature = !sharedAreas.has(targetArea);
  if (!targetIsFeature) return;

  if (sourceIsFeature) {
    recordFeatureEdge(side, sourceArea, targetArea, source, imported.line);
    if (isPublicEntrypoint(side, targetArea, target)) return;
    violations.push({
      file: source,
      line: imported.line,
      kind: "feature-boundary",
      message: `${side}/${sourceArea} may import ${side}/${targetArea} only through ${side}/${targetArea}/public.ts: ${JSON.stringify(imported.specifier)} -> ${relative(target)}`,
    });
    return;
  }

  if (side === "server" && serverCompositionRoots.has(relative(source))) return;
  violations.push({
    file: source,
    line: imported.line,
    kind: "feature-boundary",
    message: `shared ${side} code may not depend on feature internals: ${JSON.stringify(imported.specifier)} -> ${relative(target)}`,
  });
}

function recordFeatureEdge(side, sourceArea, targetArea, file, line) {
  const graph = featureGraphs[side];
  if (!graph.edges.has(sourceArea)) graph.edges.set(sourceArea, new Set());
  graph.edges.get(sourceArea).add(targetArea);
  const key = `${sourceArea}->${targetArea}`;
  if (!graph.evidence.has(key)) graph.evidence.set(key, { file, line });
}

function createFeatureGraph() {
  return { edges: new Map(), evidence: new Map() };
}

function findFeatureCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = new Map();

  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const target of graph.edges.get(node) ?? []) {
      if ((state.get(target) ?? 0) === 0) {
        visit(target);
      } else if (state.get(target) === 1) {
        const start = stack.lastIndexOf(target);
        const cycle = [...stack.slice(start), target];
        cycles.set(canonicalCycleKey(cycle), canonicalCycle(cycle));
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  const nodes = new Set([
    ...graph.edges.keys(),
    ...[...graph.edges.values()].flatMap((targets) => [...targets]),
  ]);
  for (const node of [...nodes].sort()) {
    if ((state.get(node) ?? 0) === 0) visit(node);
  }
  return [...cycles.values()].sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function canonicalCycle(cycle) {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
  rotations.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
  return [...rotations[0], rotations[0][0]];
}

function canonicalCycleKey(cycle) {
  return canonicalCycle(cycle).join("->");
}

function isPublicEntrypoint(side, area, file) {
  const areaRoot = path.join(sourceRoot, side, area);
  const areaRelative = path.relative(areaRoot, file).split(path.sep).join("/");
  return /^public(?:\.(?:native|web|android|ios))?\.(?:[cm]?ts|tsx)$/u.test(areaRelative);
}

function areaFor(side, file) {
  const sideRoot = path.join(sourceRoot, side);
  if (!isWithin(sideRoot, file)) return null;
  const relation = path.relative(sideRoot, file).split(path.sep).join("/");
  if (!relation.includes("/")) return null;
  return relation.split("/")[0];
}

function checkCoverageConfiguration() {
  const configPath = path.join(root, ".c8rc.json");
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    violations.push({
      file: configPath,
      line: 1,
      kind: "coverage-config",
      message: `cannot read valid coverage configuration: ${errorMessage(error)}`,
    });
    return;
  }

  for (const [key, expected] of requiredCoverageSettings) {
    if (config[key] === expected) continue;
    violations.push({
      file: configPath,
      line: 1,
      kind: "coverage-config",
      message: `${JSON.stringify(key)} must be ${JSON.stringify(expected)}`,
    });
  }

  if (!Array.isArray(config.include) || config.include.length !== 1 || config.include[0] !== "src/**/*.ts") {
    violations.push({
      file: configPath,
      line: 1,
      kind: "coverage-config",
      message: "coverage include must be exactly [\"src/**/*.ts\"] so new executable TypeScript is covered by default",
    });
  }

  if (!Array.isArray(config.exclude)) {
    violations.push({
      file: configPath,
      line: 1,
      kind: "coverage-config",
      message: "coverage exclude must be an array of exact source file paths",
    });
    return;
  }

  const seen = new Set();
  for (const entry of config.exclude) {
    const normalized = typeof entry === "string" ? entry.split(path.sep).join("/") : "";
    if (!normalized || path.isAbsolute(normalized) || hasGlobSyntax(normalized) ||
        !normalized.startsWith("src/") || !normalized.endsWith(".ts")) {
      violations.push({
        file: configPath,
        line: 1,
        kind: "coverage-config",
        message: `coverage exclusion must be one exact src/**/*.ts path: ${JSON.stringify(entry)}`,
      });
      continue;
    }
    if (seen.has(normalized)) {
      violations.push({
        file: configPath,
        line: 1,
        kind: "coverage-config",
        message: `duplicate coverage exclusion: ${JSON.stringify(normalized)}`,
      });
      continue;
    }
    seen.add(normalized);
    if (!isFile(path.join(root, ...normalized.split("/")))) {
      violations.push({
        file: configPath,
        line: 1,
        kind: "coverage-config",
        message: `stale coverage exclusion does not name an existing file: ${JSON.stringify(normalized)}`,
      });
    }
  }
}

function hasGlobSyntax(value) {
  return /[*?{}[\]!]/u.test(value);
}

function readProjectConfig() {
  // TypeScript 6 asserts that the diagnostic filename uses the same slash
  // convention as the supplied config filename on Windows.
  const configPath = path.join(root, "tsconfig.json").split(path.sep).join("/");
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    recordTypeScriptDiagnostic(configPath, loaded.error);
    return { options: {} };
  }
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root, undefined, configPath);
  for (const diagnostic of parsed.errors) recordTypeScriptDiagnostic(configPath, diagnostic);
  return parsed;
}

function recordTypeScriptDiagnostic(configPath, diagnostic) {
  const file = diagnostic.file?.fileName ?? configPath;
  let line = 1;
  if (diagnostic.file && diagnostic.start !== undefined) {
    line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
  }
  violations.push({
    file,
    line,
    kind: "typescript-config",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  });
}

function findFiles(directory, include, onSymlink = () => {}) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      onSymlink(fullPath);
      continue;
    }
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...findFiles(fullPath, include, onSymlink));
    } else if (entry.isFile() && include(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function isAllowedOutsideSource(file) {
  const relativePath = relative(file);
  const segments = relativePath.split("/");
  if (segments[0] === "tests" || segments[0] === "scripts") return true;
  if (segments.length !== 1) return false;
  return file.endsWith(".d.ts") || /(?:^|\.)config\.(?:[cm]?ts|tsx)$/u.test(path.basename(file));
}

function layerFor(file) {
  if (!isWithin(sourceRoot, file)) return null;
  const relativePath = path.relative(sourceRoot, file).split(path.sep).join("/");
  if (/^worker(?:\.(?:[cm]?ts|tsx))?\//u.test(relativePath) || /^worker\.(?:[cm]?ts|tsx)$/u.test(relativePath)) {
    return "worker";
  }
  const [topLevel] = relativePath.split("/");
  return allowedImports.has(topLevel) ? topLevel : null;
}

function importedSpecifiers(sourceFile) {
  const imports = [];
  const record = (literal, typeOnly = false) => {
    if (!literal || !ts.isStringLiteralLike(literal)) return;
    const location = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
    imports.push({ specifier: literal.text, line: location.line + 1, typeOnly });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      record(node.moduleSpecifier, importDeclarationIsTypeOnly(node));
    } else if (ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier, exportDeclarationIsTypeOnly(node));
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression, Boolean(node.isTypeOnly));
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) record(argument.literal, true);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) record(node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function importDeclarationIsTypeOnly(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function exportDeclarationIsTypeOnly(node) {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly);
}

function resolveLocalImport(importer, specifier) {
  let bases = [];
  if (specifier.startsWith(".")) {
    bases = [path.resolve(path.dirname(importer), specifier)];
  } else {
    bases = aliasTargets(specifier);
    if (bases.length === 0) return { local: false, files: [] };
  }

  const files = new Set();
  for (const base of bases) {
    for (const candidate of resolutionCandidates(base)) {
      if (isFile(candidate)) files.add(path.normalize(candidate));
    }
  }
  return { local: true, files: [...files] };
}

function resolutionCandidates(unmodifiedBase) {
  const candidates = [];
  const explicitExtension = path.extname(unmodifiedBase).toLowerCase();
  let base = unmodifiedBase;
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(explicitExtension)) {
    base = unmodifiedBase.slice(0, -explicitExtension.length);
  } else if (sourceExtensions.includes(explicitExtension)) {
    return [unmodifiedBase];
  } else if (explicitExtension && explicitExtension !== ".native" && explicitExtension !== ".web" &&
      explicitExtension !== ".android" && explicitExtension !== ".ios") {
    return isFile(unmodifiedBase) ? [unmodifiedBase] : [];
  }

  const hasPlatformSuffix = /\.(?:native|web|android|ios)$/u.test(base);
  const suffixes = hasPlatformSuffix ? [""] : platformSuffixes;
  for (const suffix of suffixes) {
    for (const extension of sourceExtensions) candidates.push(`${base}${suffix}${extension}`);
  }
  for (const suffix of suffixes) {
    for (const extension of sourceExtensions) {
      candidates.push(path.join(base, `index${suffix}${extension}`));
    }
  }
  candidates.push(`${base}.d.ts`, path.join(base, "index.d.ts"));
  return candidates;
}

function readAliases(compilerOptions) {
  const baseDirectory = path.resolve(root, compilerOptions.baseUrl ?? ".");
  return Object.entries(compilerOptions.paths ?? {}).flatMap(([pattern, targets]) => {
    if (!Array.isArray(targets)) return [];
    const wildcardIndex = pattern.indexOf("*");
    return [{
      pattern,
      prefix: wildcardIndex < 0 ? pattern : pattern.slice(0, wildcardIndex),
      suffix: wildcardIndex < 0 ? "" : pattern.slice(wildcardIndex + 1),
      wildcard: wildcardIndex >= 0,
      targets: targets.map((target) => path.resolve(baseDirectory, target)),
    }];
  });
}

function aliasTargets(specifier) {
  const targets = [];
  for (const alias of aliases) {
    let wildcardValue = "";
    if (alias.wildcard) {
      if (!specifier.startsWith(alias.prefix) || !specifier.endsWith(alias.suffix)) continue;
      wildcardValue = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length);
    } else if (specifier !== alias.pattern) {
      continue;
    }
    for (const target of alias.targets) targets.push(target.replace("*", wildcardValue));
  }
  return targets;
}

function scriptKindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isWithin(directory, file) {
  const relation = path.relative(directory, file);
  return relation === "" || (!relation.startsWith(`..${path.sep}`) && relation !== "..");
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
