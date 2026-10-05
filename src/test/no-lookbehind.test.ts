import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { warmupPairCount } from "@/lib/inbox-filters";
import { classifyMessage } from "@/lib/classify";
import { contentHints, spamWords } from "@/lib/placement";

// iOS Safari < 16.4 cannot PARSE a regex lookbehind ("Invalid regular expression: invalid group
// specifier name"): the whole chunk that contains it fails to load, so the installed phone app
// (/m) died on open. The three regexes below were rewritten WITHOUT lookbehind; these tests pin
// that they behave exactly like the originals (which Node can still run) and that no lookbehind
// creeps back into the code the mobile app loads.

/* ── 1) Nothing the mobile app (or the shared libs) loads uses a lookbehind ── */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
function codeLines(file: string): string[] {
  // Comments may MENTION a lookbehind; only real code lines count.
  return readFileSync(file, "utf8").split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  });
}
describe("no lookbehind in the code the phone app loads", () => {
  const roots = ["src/lib", "src/pages/mobile", "src/components", "src/contexts", "src/hooks", "src/integrations", "supabase/functions/_shared"]
    .map((d) => resolve(process.cwd(), d));
  for (const root of roots) {
    it(`${root.replace(process.cwd(), "").replace(/\\/g, "/")} has no (?<= / (?<! in code`, () => {
      const offenders: string[] = [];
      for (const f of sourceFiles(root)) {
        for (const line of codeLines(f)) if (/\(\?<[!=]/.test(line)) offenders.push(`${f}: ${line.trim().slice(0, 120)}`);
      }
      expect(offenders).toEqual([]);
    });
  }
});

/* ── 2) inbox-filters: WARMUP_PAIR_RE ── */
const ORIGINAL_PAIR_RE = new RegExp("(?<![a-zÀ-ɏ-])[a-z]{3,9}-[a-z]{3,9}(?![a-zÀ-ɏ-])", "g");
const HYPHEN_WHITELIST = /\b(e-?mail|follow-?up|cold-?email|in-?house|third-?party|up-to-date|long-?term|short-?term|on-?site|real-?time|co-?founder|opt-?in|opt-?out|sign-?up|log-?in|check-?in|one-on-one|face-to-face|end-to-end|know-?how|start-?up|pop-?up|add-?on|plug-?in|built-?in|hands-?on|drop-?down|e-?commerce|re-?engagement|self-?service|well-?known|state-of-the-art|b2b|b2c|non-?profit|part-?time|full-?time|high-?level|low-?cost|out-of-office|pre-?sales|post-?sales|cross-?sell|up-?sell|go-to-market|multi-?channel|omni-?channel|open-?source|white-?label|pay-?as-you-go|well-?being|decision-?makers?|high-?speed|high-?end|top-?notch|first-?class|world-?class|user-?friendly|cost-?effective|data-?driven|time-?consuming|long-?standing|cutting-?edge|problem-?solving|auto-?reply|auto-?response|auto-?respuesta|auto-?responder|time-?sensitive|non-?urgent|tele-?trabajo|video-?llamada|pre-?venta|post-?venta|semi-?presencial|out-of-the-office)\b/i;
const COMPOUND_SIDE_RE = /(ed|ing|ly|ive|able|ible|ful|less|ness|ous|al|er|est|ic|ish|ward|wise|free|based|like|proof|wide|ready|made|led|tech|time|term)$/i;
/** The ORIGINAL warmupPairCount, verbatim, with the lookbehind regex. */
function originalWarmupPairCount(text: string | null, strict = true): number {
  const t = (text || "").slice(0, 1200)
    .replace(/\S+@\S+/g, " ")
    .replace(/(https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[a-z0-9][a-z0-9-]*\.(com|es|eu|net|org|io|info|store|online|cat|fr|it|de|uk|co|ai|app|dev|pro|group|tech|biz)\b/gi, " ");
  let n = 0;
  for (const m of t.match(ORIGINAL_PAIR_RE) || []) {
    if (HYPHEN_WHITELIST.test(m)) continue;
    if (strict) { const [a, b] = m.split("-"); if (COMPOUND_SIDE_RE.test(a) || COMPOUND_SIDE_RE.test(b)) continue; }
    n++;
  }
  return n;
}

const PAIR_SAMPLES = [
  "noise-waste and clock-speed",
  "noise-waste,clock-speed;sugar-place",
  "noise-waste clock-speed sugar-place write-clear",
  "Somos un perfil técnico-comercial con experiencia socio-económica",
  "el área técnico-comercial y el socio-económico",
  "técnico-comercial",
  "ñoño-comercial y año-nuevo",
  "state-of-the-art solution with a cost-effective, data-driven approach",
  "Noise-waste Clock-speed",
  "abcdefghijk-xyz abc-defghijklmn",
  "ab-cd abc-def",
  "a.lombardi@tecno-group.eu tecno-group",
  "https://www.tecno-group.eu/blog/noise-waste",
  "-noise-waste- noise-waste-",
  "x-noise-waste clock-speed-y",
  "follow-up e-mail check-in",
  "writeclear-noise waste-sugar",
  "hello-world\nnoise-waste\tclock-speed",
  "",
  "sin guiones por ninguna parte",
  "we offer well-being and know-how plus noise-waste",
  "ópera-rock música-clásica rock-pop",
];
describe("WARMUP_PAIR_RE without lookbehind behaves exactly like the original", () => {
  for (const s of PAIR_SAMPLES) {
    it(`strict + non-strict: ${JSON.stringify(s)}`, () => {
      expect(warmupPairCount(s, true)).toBe(originalWarmupPairCount(s, true));
      expect(warmupPairCount(s, false)).toBe(originalWarmupPairCount(s, false));
    });
  }
  it("representative values (so a regression in BOTH would still show)", () => {
    expect(warmupPairCount("noise-waste and clock-speed", false)).toBe(2);
    expect(warmupPairCount("noise-waste,clock-speed;sugar-place", false)).toBe(3);
    expect(warmupPairCount("Somos un perfil técnico-comercial con experiencia socio-económica", false)).toBe(0);
    expect(warmupPairCount("cost-effective and data-driven", true)).toBe(0);
    expect(warmupPairCount("x-noise-waste clock-speed-y", false)).toBe(0);
  });
  it("is reusable across calls (global regex state is reset)", () => {
    expect(warmupPairCount("noise-waste", false)).toBe(1);
    expect(warmupPairCount("noise-waste", false)).toBe(1);
    expect(warmupPairCount("clock-speed noise-waste", false)).toBe(2);
  });
});

/* ── 3) classify: "estoy/estamos disponible(s)" unless preceded by "no " ── */
const ORIGINAL_AVAIL_RE = new RegExp("(?<!\\bno\\s)est(oy|amos)\\s+disponibl\\w*", "i");
const NEW_AVAIL_RE = /(?:^|\S|(?:^|[^o])\s|(?:^|[^n])o\s|\wno\s)est(oy|amos)\s+disponibl\w*/i;
const AVAIL_SAMPLES = [
  "estoy disponible",
  "Estoy disponible mañana",
  "estamos disponibles el lunes",
  "no estoy disponible",
  "No estoy disponible",
  "NO ESTAMOS DISPONIBLES",
  "Hoy no estoy disponible. Respondere a mi vuelta.",
  "hoy no\nestoy disponible",
  "no  estoy disponible",
  "mono estoy disponible",
  "sino estoy disponible",
  "o estoy disponible",
  "xestoy disponible",
  "yo estoy disponible",
  "Sí, estoy disponible el jueves",
  "sí: estamos disponibles",
  "no, estoy disponible",
  "no estoy disponible, pero estamos disponibles el martes",
  "ahora mismo no estoy disponible pero estoy disponible mañana",
  "estoydisponible",
  "estoy  disponible",
  "estás disponible",
  "disponible estoy",
  "",
  "El lunes o martes a las 16:00 estamos disponibles. Pasanos convocatoria.",
];
describe("availability pattern without lookbehind behaves exactly like the original", () => {
  for (const s of AVAIL_SAMPLES) {
    it(JSON.stringify(s), () => {
      expect(NEW_AVAIL_RE.test(s)).toBe(ORIGINAL_AVAIL_RE.test(s));
    });
  }
  it("representative values", () => {
    expect(NEW_AVAIL_RE.test("estoy disponible")).toBe(true);
    expect(NEW_AVAIL_RE.test("Sí, estoy disponible el jueves")).toBe(true);
    expect(NEW_AVAIL_RE.test("no estoy disponible")).toBe(false);
    expect(NEW_AVAIL_RE.test("Hoy no estoy disponible. Respondere a mi vuelta.")).toBe(false);
    expect(NEW_AVAIL_RE.test("no estoy disponible, pero estamos disponibles el martes")).toBe(true);
  });
  it("the regex in classify.ts is the one tested here", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/classify.ts"), "utf8");
    expect(src).toContain(NEW_AVAIL_RE.source);
  });
  it("end to end: 'no estoy disponible' is an absence, 'estamos disponibles' is interest", () => {
    expect(classifyMessage(null, "Gracias por tu mensaje. Hoy no estoy disponible. Respondere a tu correo a mi vuelta. Un saludo.")).toBe("out_of_office");
    expect(classifyMessage("Re: Javier - Cartronic", "Buenos dias Javier, ya estamos operativos tras el periodo vacacional, tendrias un hueco para contarnos sobre vuestra herramienta la semana que viene? El lunes o martes a las 16:00 estamos disponibles. Pasanos convocatoria.")).toBe("interested");
    expect(classifyMessage("Re: Lucy - Empresa", "Hola Lucy, sí, estoy disponible el jueves por la tarde para una llamada.")).toBe("interested");
  });
});

/* ── 4) placement: SPAM_WORDS ── */
const ORIGINAL_SPAM_RE = new RegExp("(?<![\\p{L}\\p{N}])(gratis|100\\s?%|garantizad[oa]s?|ofertas?|descuentos?|urgente|gana dinero|sin compromiso|haz clic|clic aqu[ií]|click aqu[ií]|free|guaranteed?|act now|limited time|winner|cash)(?![\\p{L}\\p{N}])", "giu");
const originalSpamWords = (text: string) => [...new Set((text.match(ORIGINAL_SPAM_RE) || []).map((w) => w.toLowerCase()))];
const SPAM_SAMPLES = [
  "Prueba GRATIS y sin compromiso: haz clic aquí",
  "Resultados garantizados al 100 % — oferta urgente",
  "ingratis gratisimo descuentos2 2descuentos ofertas",
  "nuestras ofertas, descuentos y más ofertas",
  "Free trial, guaranteed results. Act now! Limited time winner cash",
  "freelance cashier winnerless",
  "¡Gratis! «Gratis» (gratis) gratis.",
  "aquí: clic aquí — click aqui",
  "Todo normal, nada que ver",
  "",
  "gana dinero\ngratis\tcash",
];
describe("SPAM_WORDS without lookbehind behaves exactly like the original", () => {
  for (const s of SPAM_SAMPLES) {
    it(JSON.stringify(s), () => {
      expect(spamWords(s)).toEqual(originalSpamWords(s));
    });
  }
  it("representative values", () => {
    // "haz clic" swallows "clic", so "clic aquí" can't ALSO match — same as the original.
    expect(spamWords("Prueba GRATIS y sin compromiso: haz clic aquí")).toEqual(["gratis", "sin compromiso", "haz clic"]);
    expect(spamWords("Prueba GRATIS: clic aquí")).toEqual(["gratis", "clic aquí"]);
    expect(spamWords("ingratis gratisimo descuentos2 2descuentos")).toEqual([]);
    expect(spamWords("freelance cashier winnerless")).toEqual([]);
    expect(spamWords("gratis gratis GRATIS")).toEqual(["gratis"]);
  });
  it("contentHints still lists the words", () => {
    const h = contentHints("Oferta GRATIS", "Resultados garantizados. Sin compromiso. Escríbenos cuando quieras y te contamos con calma cómo lo hacemos.");
    expect(h.find((x) => x.text.startsWith("Palabras que suelen activar filtros"))?.text).toBe("Palabras que suelen activar filtros: oferta, gratis, garantizados, sin compromiso.");
  });
});
