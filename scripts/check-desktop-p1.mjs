import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const checks = [
  "check-desktop-categories.mjs",
  "check-desktop-exhibit.mjs",
  "check-desktop-category-ui.mjs",
  "check-desktop-p1-workflow.mjs",
  "check-desktop-p1-visual.mjs",
];
const results = [];
for (const name of checks) {
  console.log("Running " + name);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, "scripts/" + name],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (d) => {
      output += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      output += d;
      process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ script: name, code, output }));
  });
  results.push(result);
  if (result.code !== 0)
    throw Error(name + " failed with exit code " + result.code);
}
await mkdir("verification/p1", { recursive: true });
await writeFile(
  "verification/p1/suite-result.json",
  JSON.stringify({ passed: true, checks: results }, null, 2) + "\n",
);
