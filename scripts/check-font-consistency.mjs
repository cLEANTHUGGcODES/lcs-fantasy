import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const scanRoot = path.join(projectRoot, "src");
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".sass"]);

const violations = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!allowedExtensions.has(path.extname(entry.name))) continue;
    checkFile(fullPath);
  }
}

function addViolation(filePath, lineNumber, message, lineText) {
  const relativePath = path.relative(projectRoot, filePath);
  violations.push({
    location: `${relativePath}:${lineNumber}`,
    message,
    lineText: lineText.trim(),
  });
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  const nextFontImport = /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']next\/font\/google["']/g;
  let importMatch;
  while ((importMatch = nextFontImport.exec(content)) !== null) {
    const imported = importMatch[1]
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => token.split(/\s+as\s+/i)[0].trim());
    for (const fontName of imported) {
      if (fontName !== "League_Spartan") {
        const lineNumber = content.slice(0, importMatch.index).split(/\r?\n/).length;
        addViolation(
          filePath,
          lineNumber,
          `Disallowed Google font import '${fontName}'. Only League_Spartan is allowed.`,
          lines[lineNumber - 1] ?? "",
        );
      }
    }
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/fonts\.googleapis\.com/i.test(line) && !/League\+Spartan/i.test(line)) {
      addViolation(
        filePath,
        lineNumber,
        "Disallowed Google Fonts URL. Only League Spartan may be loaded.",
        line,
      );
    }

    if (!/font-family\s*:/i.test(line)) return;
    const normalized = line.toLowerCase();
    const allowedLine =
      normalized.includes("var(--font-") ||
      normalized.includes("league spartan") ||
      normalized.includes("inherit") ||
      normalized.includes("initial") ||
      normalized.includes("unset") ||
      normalized.includes("revert");

    if (!allowedLine) {
      addViolation(
        filePath,
        lineNumber,
        "Disallowed font-family declaration. Use League Spartan variables or League Spartan directly.",
        line,
      );
    }
  });
}

if (!fs.existsSync(scanRoot)) {
  console.error(`Cannot find scan root: ${scanRoot}`);
  process.exit(1);
}

walk(scanRoot);

if (violations.length > 0) {
  console.error("Font consistency check failed:");
  for (const violation of violations) {
    console.error(`- ${violation.location} ${violation.message}`);
    if (violation.lineText) {
      console.error(`  ${violation.lineText}`);
    }
  }
  process.exit(1);
}

console.log("Font consistency check passed: only League Spartan usage detected.");
