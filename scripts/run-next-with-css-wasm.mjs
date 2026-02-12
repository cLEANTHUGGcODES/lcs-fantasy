import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  throw new Error("Expected Next.js command arguments (for example: dev, build, start).");
}

const nextBinPath = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.toUpperCase() === "CSS_TRANSFORMER_WASM") {
    delete env[key];
  }
}
env.CSS_TRANSFORMER_WASM = "";

const child = spawn(process.execPath, [nextBinPath, ...args], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
