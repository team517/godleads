// Monta la landing exportada de Claude Design a partir de sus trozos.
//
// El archivo del propietario pesa ~10 MB y la subida a GitHub de un único objeto de ese tamaño
// se cortaba siempre desde esta conexión, así que vive en el repositorio partido en trozos de
// 1,5 MB (landing-src/*.part-NN). Aquí se vuelven a unir SIN tocar nada y se comprueba que el
// resultado es, byte a byte, el archivo original (tamaño + SHA-256). Si no coincide, la
// construcción falla: mejor no desplegar que desplegar una landing alterada.
//
// Se ejecuta solo antes de `npm run dev` y `npm run build` (predev / prebuild).
// Para cambiar la landing:  node scripts/build-landing.mjs --split "ruta/al/nuevo.html"
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(root, "landing-src");
const OUT = join(root, "public", "landing", "onepulso-landing.html");
const MANIFEST = join(SRC_DIR, "manifest.json");
const PART_SIZE = 1_500_000;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const partFiles = () => readdirSync(SRC_DIR).filter((f) => /\.part-\d+$/.test(f)).sort();

export function assembleLanding() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
  const whole = Buffer.concat(partFiles().map((f) => readFileSync(join(SRC_DIR, f))));
  if (whole.length !== manifest.size) throw new Error(`landing: tamaño ${whole.length} ≠ ${manifest.size} del original`);
  if (sha256(whole) !== manifest.sha256) throw new Error("landing: la huella SHA-256 no coincide con el archivo original");
  return { whole, manifest };
}

const splitArg = process.argv.indexOf("--split");
if (splitArg >= 0) {
  const source = process.argv[splitArg + 1];
  if (!source) throw new Error("uso: node scripts/build-landing.mjs --split <archivo.html>");
  const buf = readFileSync(source);
  for (const f of partFiles()) rmSync(join(SRC_DIR, f));
  mkdirSync(SRC_DIR, { recursive: true });
  let n = 0;
  for (let off = 0; off < buf.length; off += PART_SIZE, n++) {
    writeFileSync(join(SRC_DIR, `onepulso-landing.html.part-${String(n).padStart(2, "0")}`), buf.subarray(off, off + PART_SIZE));
  }
  writeFileSync(MANIFEST, JSON.stringify({ size: buf.length, sha256: sha256(buf), parts: n }, null, 2) + "\n");
  console.log(`landing: ${n} trozos, ${buf.length} bytes`);
} else if (process.argv[1] && process.argv[1].endsWith("build-landing.mjs")) {
  const { whole } = assembleLanding();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, whole);
  console.log(`landing: montada (${whole.length} bytes, huella verificada)`);
}
