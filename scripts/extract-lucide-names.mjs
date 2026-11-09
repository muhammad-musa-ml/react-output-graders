// Usage: node scripts/extract-lucide-names.mjs <path to lucide-react dist/lucide-react.d.ts> <version>
// Writes data/lucide-react-names.txt: every name the package exports, one per line.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [declPath, version] = process.argv.slice(2);
if (!declPath || !version) {
  console.error("usage: node scripts/extract-lucide-names.mjs <lucide-react.d.ts> <version>");
  process.exit(2);
}

const text = readFileSync(declPath, "utf8");
const exportLines = text.split("\n").filter((l) => l.startsWith("export {") || l.startsWith("export type {"));
if (exportLines.length === 0) {
  console.error("no export { ... } line found; the file layout changed");
  process.exit(2);
}

const names = new Set();
for (const line of exportLines) {
  const inner = line.slice(line.indexOf("{") + 1, line.lastIndexOf("}"));
  for (const part of inner.split(",")) {
    const token = part.trim().replace(/^type\s+/, "");
    if (!token) continue;
    const exported = token.includes(" as ") ? token.split(" as ").pop().trim() : token;
    names.add(exported);
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "lucide-react-names.txt");
mkdirSync(dirname(out), { recursive: true });
const sorted = [...names].sort();
writeFileSync(out, `# names exported by lucide-react ${version} (from dist/lucide-react.d.ts)\n${sorted.join("\n")}\n`);
console.log(`${sorted.length} names written to data/lucide-react-names.txt`);
