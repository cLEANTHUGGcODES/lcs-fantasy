import { existsSync } from "node:fs";
import path from "node:path";

if (process.platform !== "win32") {
  process.exit(0);
}

const projectRoot = process.cwd();
const requiredPaths = [
  path.join(
    projectRoot,
    "node_modules",
    "lightningcss",
    "lightningcss.win32-x64-msvc.node",
  ),
  path.join(
    projectRoot,
    "node_modules",
    "lightningcss-win32-x64-msvc",
    "lightningcss.win32-x64-msvc.node",
  ),
];

const missing = requiredPaths.filter((target) => !existsSync(target));
if (missing.length === 0) {
  process.exit(0);
}

console.error("Missing Lightning CSS native files:");
for (const target of missing) {
  console.error(`- ${target}`);
}
console.error(
  "Run: node .\\scripts\\ensure-lightningcss-win.mjs, then npm run dev",
);
process.exit(1);
