import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  throw new Error("Expected Next.js command arguments (for example: dev, build, start).");
}

const nextBinPath = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const env = { ...process.env };

const nextArgs = [...args];
const isDevCommand = nextArgs[0] === "dev";
const hasBundlerFlag = nextArgs.some(
  (arg) => arg === "--webpack" || arg === "--turbopack" || arg === "--turbo",
);
const forceTurbopack = env.NEXT_DEV_BUNDLER?.toLowerCase() === "turbopack";
const debugLauncher = env.NEXT_LAUNCHER_DEBUG === "1";

if (process.platform === "win32" && isDevCommand && !hasBundlerFlag && !forceTurbopack) {
  // Work around sporadic Turbopack early-exit behavior on Windows.
  nextArgs.push("--webpack");
}

const useNoAddonsFallback =
  process.platform === "win32" &&
  isDevCommand &&
  env.NEXT_FORCE_WINDOWS_NO_ADDONS === "1";
const nodeArgs = useNoAddonsFallback ? ["--no-addons"] : [];

const parsedNodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
const shouldUseWindowsUndiciShim =
  process.platform === "win32" &&
  Number.isFinite(parsedNodeMajor) &&
  parsedNodeMajor === 20;
if (shouldUseWindowsUndiciShim) {
  nodeArgs.push("--require", path.join(process.cwd(), "scripts", "shims", "undici-globals.cjs"));
}

if (process.platform === "win32") {
  // Default to native Lightning CSS on Windows. Opt in to wasm only when requested.
  delete env.CSS_TRANSFORMER_WASM;
  if (env.NEXT_FORCE_WINDOWS_CSS_WASM === "1") {
    env.CSS_TRANSFORMER_WASM = "1";
  } else {
    env.CSS_TRANSFORMER_WASM = "";
  }
}

const forceWindowsSwcWasm =
  process.platform === "win32" &&
  isDevCommand &&
  env.NEXT_FORCE_WINDOWS_SWC_WASM === "1";
if (process.platform === "win32" && isDevCommand) {
  // Avoid leaking NEXT_TEST_WASM from the parent shell unless explicitly forced.
  delete env.NEXT_TEST_WASM;
  if (forceWindowsSwcWasm && useNoAddonsFallback) {
    env.NEXT_TEST_WASM = "1";
  } else if (forceWindowsSwcWasm && !useNoAddonsFallback) {
    console.warn(
      "[next-launcher] Ignoring NEXT_FORCE_WINDOWS_SWC_WASM because NEXT_FORCE_WINDOWS_NO_ADDONS is not enabled.",
    );
  }
}

if (debugLauncher) {
  console.log(
    `[next-launcher] ${process.execPath} ${nodeArgs.join(" ")} ${nextBinPath} ${nextArgs.join(
      " ",
    )}`,
  );
  if (process.platform === "win32" && isDevCommand) {
    console.log(
      `[next-launcher] windows-flags swc_wasm=${env.NEXT_TEST_WASM === "1" ? "on" : "off"} no_addons=${useNoAddonsFallback ? "on" : "off"} css_wasm=${
        env.CSS_TRANSFORMER_WASM === "1" ? "on" : "off"
      }`,
    );
  }
}

const child = spawn(process.execPath, [...nodeArgs, nextBinPath, ...nextArgs], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("error", (error) => {
  console.error(
    `Failed to launch Next.js via ${nextBinPath}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (debugLauncher) {
    console.log(
      `[next-launcher] child exit code=${code === null ? "null" : String(code)} signal=${
        signal ?? "none"
      }`,
    );
  }
  if (signal) {
    process.exit(1);
    return;
  }

  if (process.platform === "win32" && code === 3221225477) {
    console.error(
      "[next-launcher] Windows access violation (0xC0000005). If this persists, switch to Node 20 LTS and retry.",
    );
  }

  process.exit(code ?? 1);
});
