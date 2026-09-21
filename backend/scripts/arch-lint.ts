/**
 * Arch lint: keeps the modular monolith boundaries intact.
 *
 * Rules:
 *  1. backend/app/* may only import backend/modules/*\/api (never a module's internal/root).
 *  2. backend/modules/<a>/* must not import backend/modules/<b>/internal (b != a).
 *  3. backend/kernel/* must not import backend/app/* or backend/modules/*.
 *
 * Run: bun run arch:lint
 */
import { Glob } from "bun";
import { dirname, join, normalize, relative, resolve } from "path";

const root = resolve(import.meta.dir, "../..");
const posix = (p: string) => p.replace(/\\/g, "/");

type Area = { area: "app" | "kernel" | "module" | "other"; module?: string; kind?: "api" | "internal" | "root" };

function classify(rel: string): Area {
  if (rel.startsWith("backend/app/")) return { area: "app" };
  if (rel.startsWith("backend/kernel/")) return { area: "kernel" };
  const m = rel.match(/^backend\/modules\/([^/]+)\/(api|internal)(\/|$)/);
  if (m) return { area: "module", module: m[1], kind: m[2] as "api" | "internal" };
  const m2 = rel.match(/^backend\/modules\/([^/]+)\//);
  if (m2) return { area: "module", module: m2[1], kind: "root" };
  return { area: "other" };
}

const files: string[] = [];
for (const dir of ["backend/app", "backend/kernel", "backend/modules"]) {
  for await (const f of new Glob(`${dir}/**/*.ts`).scan(root)) files.push(posix(f));
}

const violations: string[] = [];
const importRe = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

for (const file of files) {
  const src = await Bun.file(join(root, file)).text();
  const from = classify(file);

  for (const match of src.matchAll(importRe)) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue;

    const targetRel = posix(relative(root, normalize(join(root, dirname(file), spec))));
    const to = classify(targetRel);

    if (from.area === "app" && to.area === "module" && to.kind !== "api") {
      violations.push(`${file}\n    -> ${spec}\n    apps may only import modules/*/api`);
      continue;
    }
    if (from.area === "module" && to.area === "module" && to.kind === "internal" && from.module !== to.module) {
      violations.push(`${file}\n    -> ${spec}\n    cross-module imports of internal/ are forbidden (use the module's api)`);
      continue;
    }
    if (from.area === "kernel" && (to.area === "app" || to.area === "module")) {
      violations.push(`${file}\n    -> ${spec}\n    kernel must be domain-free (no imports from apps/modules)`);
      continue;
    }
  }
}

if (violations.length > 0) {
  console.error(`\n[x] ${violations.length} boundary violation(s):\n`);
  for (const v of violations) console.error(`  - ${v}\n`);
  process.exit(1);
}

console.log(`[+] arch-lint OK (${files.length} files checked, 0 violations)`);
