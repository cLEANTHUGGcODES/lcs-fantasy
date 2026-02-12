import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

if (process.platform !== "win32") {
  process.exit(0);
}

const projectRoot = process.cwd();
const lightningcssPackagePath = path.join(
  projectRoot,
  "node_modules",
  "lightningcss",
  "package.json",
);
const winPackageDir = path.join(
  projectRoot,
  "node_modules",
  "lightningcss-win32-x64-msvc",
);
const winNativeBinding = path.join(
  winPackageDir,
  "lightningcss.win32-x64-msvc.node",
);
const lightningcssFallbackBinding = path.join(
  projectRoot,
  "node_modules",
  "lightningcss",
  "lightningcss.win32-x64-msvc.node",
);
const lightningcssNodeIndexPath = path.join(
  projectRoot,
  "node_modules",
  "lightningcss",
  "node",
  "index.js",
);

if (!existsSync(lightningcssPackagePath)) {
  process.exit(0);
}

let version = "latest";
try {
  const lightningcssPackage = JSON.parse(readFileSync(lightningcssPackagePath, "utf8"));
  version =
    lightningcssPackage.optionalDependencies?.["lightningcss-win32-x64-msvc"] ??
    lightningcssPackage.version ??
    version;
} catch {
  // Keep fallback version.
}

const packageSpec = `lightningcss-win32-x64-msvc@${version}`;
const npmExecPath = process.env.npm_execpath;

const runNpmInstall = () => {
  const args = [
    "install",
    "--no-save",
    "--include=optional",
    "--no-audit",
    "--no-fund",
    packageSpec,
  ];

  if (npmExecPath && existsSync(npmExecPath)) {
    execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    return;
  }

  execFileSync("npm.cmd", args, {
    cwd: projectRoot,
    stdio: "inherit",
  });
};

try {
  if (!existsSync(winPackageDir) || !existsSync(winNativeBinding)) {
    runNpmInstall();
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : "Unknown error";
  throw new Error(
    `Failed to install ${packageSpec}. Try running: npm install --include=optional ${packageSpec}\n${reason}`,
  );
}

if (!existsSync(winPackageDir) || !existsSync(winNativeBinding)) {
  throw new Error(
    `Installed ${packageSpec}, but native binding is still missing at ${winNativeBinding}.`,
  );
}

if (!existsSync(lightningcssFallbackBinding)) {
  copyFileSync(winNativeBinding, lightningcssFallbackBinding);
}

if (existsSync(lightningcssNodeIndexPath)) {
  const source = readFileSync(lightningcssNodeIndexPath, "utf8");
  const needle = "if (process.env.CSS_TRANSFORMER_WASM) {";
  const replacement = "if (false && process.env.CSS_TRANSFORMER_WASM) {";
  if (source.includes(needle) && !source.includes(replacement)) {
    writeFileSync(lightningcssNodeIndexPath, source.replace(needle, replacement), "utf8");
  }
}
