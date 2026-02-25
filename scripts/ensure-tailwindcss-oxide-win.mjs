import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

if (process.platform !== "win32") {
  process.exit(0);
}

const projectRoot = process.cwd();
const oxidePackageJsonPath = path.join(
  projectRoot,
  "node_modules",
  "@tailwindcss",
  "oxide",
  "package.json",
);

if (!existsSync(oxidePackageJsonPath)) {
  process.exit(0);
}

const scopeDir = path.join(projectRoot, "node_modules", "@tailwindcss");
const winPackageName = "@tailwindcss/oxide-win32-x64-msvc";
const winPackageDir = path.join(scopeDir, "oxide-win32-x64-msvc");
const winNativeBindingName = "tailwindcss-oxide.win32-x64-msvc.node";
const winNativeBindingPath = path.join(winPackageDir, winNativeBindingName);
const winPackageJsonPath = path.join(winPackageDir, "package.json");

let version = "latest";
try {
  const oxidePackage = JSON.parse(readFileSync(oxidePackageJsonPath, "utf8"));
  version =
    oxidePackage.optionalDependencies?.[winPackageName] ??
    oxidePackage.version ??
    version;
} catch {
  // Keep fallback version.
}

const packageSpec = `${winPackageName}@${version}`;
const npmExecPath = process.env.npm_execpath;

const hasRequiredPackageFiles = () =>
  existsSync(winNativeBindingPath) && existsSync(winPackageJsonPath);

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

const writeMinimalPackageJson = () => {
  const packageJson = {
    name: winPackageName,
    version,
    main: winNativeBindingName,
    files: [winNativeBindingName],
    os: ["win32"],
    cpu: ["x64"],
  };
  writeFileSync(
    winPackageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
};

const tryHydrateFromTempInstall = () => {
  if (!existsSync(scopeDir)) {
    return false;
  }

  const candidates = readdirSync(scopeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(".oxide-win32-x64-msvc-"));

  for (const candidate of candidates) {
    const sourceBindingPath = path.join(scopeDir, candidate, winNativeBindingName);
    if (!existsSync(sourceBindingPath)) {
      continue;
    }

    mkdirSync(winPackageDir, { recursive: true });
    copyFileSync(sourceBindingPath, winNativeBindingPath);
    if (!existsSync(winPackageJsonPath)) {
      writeMinimalPackageJson();
    }
    return true;
  }

  return false;
};

if (!hasRequiredPackageFiles()) {
  let installError = null;
  try {
    runNpmInstall();
  } catch (error) {
    installError = error;
  }

  if (!hasRequiredPackageFiles()) {
    tryHydrateFromTempInstall();
  }

  if (!hasRequiredPackageFiles()) {
    const reason =
      installError instanceof Error ? `\n${installError.message}` : "";
    throw new Error(
      `Tailwind Oxide Windows native binding is missing at ${winNativeBindingPath}. ` +
        `Try running: npm install --include=optional ${packageSpec}${reason}`,
    );
  }
}

if (existsSync(winNativeBindingPath) && !existsSync(winPackageJsonPath)) {
  writeMinimalPackageJson();
}
