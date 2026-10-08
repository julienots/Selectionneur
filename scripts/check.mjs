// Vérifie la syntaxe JS de tous les scripts inline de www/index.html + des modules js/*.js
// (cf. guide en tête de index.html : à lancer après CHAQUE modification).
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const html = readFileSync("www/index.html", "utf8");
const open = "<scr" + "ipt>", close = "</scr" + "ipt>";
const dir = mkdtempSync(join(tmpdir(), "selcheck-"));
let i = 0, n = 0, pos = 0;
while ((i = html.indexOf(open, pos)) !== -1) {
  const j = html.indexOf(close, i);
  const f = join(dir, `inline-${n++}.js`);
  writeFileSync(f, html.slice(i + open.length, j));
  execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });
  pos = j + close.length;
}
for (const f of readdirSync("www/js")) execFileSync(process.execPath, ["--check", join("www/js", f)], { stdio: "inherit" });
console.log(`Syntaxe OK (${n} scripts inline + www/js/*.js)`);
