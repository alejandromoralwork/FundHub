// Checks that a change only added or edited COMMENTS, never code.
//
//   node scripts/check-comments-only.mjs <file> [<file> ...]
//
// For each file it compares the version in the last git commit (HEAD) with the
// working copy after removing every comment from both, using the TypeScript
// compiler's own printer. If anything other than comments changed, it prints the
// file and exits with code 1.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

/** Re-prints source code without comments, so formatting and comments don't matter. */
function codeOnly(text, fileName) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  const printed = ts.createPrinter({ removeComments: true }).printFile(source);
  // A JSX comment {/* … */} leaves an empty "{}" behind; ignore those too.
  return printed.replace(/\{\s*\}(?=\s*[<)\n])/g, "").replace(/\s+/g, " ");
}

let failed = 0;
for (const file of process.argv.slice(2)) {
  let before;
  try {
    before = execFileSync("git", ["show", `HEAD:${file.replace(/\\/g, "/")}`], { encoding: "utf8" });
  } catch {
    continue; // new file: nothing to compare with
  }
  const after = readFileSync(file, "utf8");
  if (codeOnly(before, file) !== codeOnly(after, file)) {
    console.log(`CODE CHANGED: ${file}`);
    failed++;
  }
}
console.log(failed ? `${failed} file(s) changed code` : "OK: only comments changed");
process.exit(failed ? 1 : 0);
