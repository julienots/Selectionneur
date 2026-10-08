// Copie les dépendances front (three.js + polices) depuis node_modules vers www/ pour que le jeu
// tourne 100% hors-ligne (APK Android, PWA). À relancer après un `npm install` qui change ces versions.
import { copyFileSync, writeFileSync, mkdirSync } from "node:fs";
const nm = "node_modules";
mkdirSync("www/vendor", { recursive: true });
mkdirSync("www/fonts", { recursive: true });
copyFileSync(`${nm}/three/build/three.min.js`, "www/vendor/three.min.js");
const fonts = [
  ["Bebas Neue", "bebas-neue", [400]],
  ["Barlow", "barlow", [400, 600, 700]],
  ["Barlow Condensed", "barlow-condensed", [600, 700]],
];
let css = "/* Polices embarquées (générées par scripts/vendor.mjs, ne pas éditer à la main) */\n";
for (const [family, slug, weights] of fonts) {
  for (const w of weights) {
    for (const subset of ["latin", "latin-ext"]) {
      const file = `${slug}-${subset}-${w}-normal.woff2`;
      copyFileSync(`${nm}/@fontsource/${slug}/files/${file}`, `www/fonts/${file}`);
      css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(./${file}) format('woff2');}\n`;
    }
  }
}
writeFileSync("www/fonts/fonts.css", css);
console.log("vendor OK");
