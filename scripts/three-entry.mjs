// Point d'entrée du bundle three.js (v52) : three + les modules de post-traitement utilisés par
// le stade (bloom, SMAA, GTAO, pass de sortie, environnement PBR). scripts/vendor.mjs le compile
// en www/vendor/three.min.js (format IIFE, global window.THREE) avec esbuild.
export * from "three";
export { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
export { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
export { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
export { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
export { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
export { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
export { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
export { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
