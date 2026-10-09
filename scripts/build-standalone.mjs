// Fabrique dist/selectionneur_vNN.html : le jeu complet en UN SEUL fichier HTML (three.js, module
// 3D et polices intégrés), à ouvrir directement dans un navigateur sans serveur ni installation.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const vNum = pkg.version.split(".").slice(0, 2).join("");          // "4.2.0" -> "42"
let html = readFileSync("www/index.html", "utf8");
const SC = "scr" + "ipt";
const inlineScript = (src) => {
  const code = readFileSync("www/" + src, "utf8").replace(new RegExp("</" + SC, "gi"), "<\\/" + SC);
  return `<${SC}>\n${code}\n</${SC}>`;
};
for (const src of ["vendor/three.min.js", "js/stade3d.js"]) {
  const tag = `<${SC} src="./${src}"></${SC}>`;
  if (!html.includes(tag)) throw new Error("balise introuvable : " + tag);
  html = html.replace(tag, () => inlineScript(src));
}
// polices en data: URI
let css = readFileSync("www/fonts/fonts.css", "utf8");
css = css.replace(/url\(\.\/([^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${readFileSync("www/fonts/" + f).toString("base64")})`);
html = html.replace(`<link rel="stylesheet" href="./fonts/fonts.css">`, () => `<style>\n${css}</style>`);
// images de l'écran de démarrage en data: URI
for (const img of ["img/superessence.png", "icons/icon-192.png"]) {
  html = html.split(`src="./${img}"`).join(`src="data:image/png;base64,${readFileSync("www/" + img).toString("base64")}"`);
}
mkdirSync("dist", { recursive: true });
const out = `dist/selectionneur_v${vNum}.html`;
writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024 / 1024).toFixed(2)} Mo)`);
