import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
    child.once("error", reject);
  });
}

await rm("dist", { recursive: true, force: true });
await run(process.execPath, [
  "node_modules/expo/bin/cli",
  "export",
  "--platform",
  "web",
  "--output-dir",
  "dist/client",
  "--clear",
]);

const webIndexPath = "dist/client/index.html";
const webIndex = await readFile(webIndexPath, "utf8");
await writeFile(
  webIndexPath,
  webIndex.replace(
    "</head>",
    [
      '  <meta name="description" content="A focused private workout tracker for routines, guided workouts, and recovery-aware recommendations.">',
      '  <meta name="mobile-web-app-capable" content="yes">',
      '  <meta name="apple-mobile-web-app-capable" content="yes">',
      '  <link rel="manifest" href="/manifest.webmanifest">',
      '  <link rel="apple-touch-icon" href="/icons/icon-192.png">',
      "</head>",
    ].join("\n"),
  ),
);

await mkdir("dist/server", { recursive: true });
await build({
  entryPoints: ["worker/index.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["cloudflare:workers"],
  sourcemap: false,
  minify: false,
});

await mkdir("dist/.openai", { recursive: true });
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
