/**
 * Client-side profanity filter for Spanish & English.
 * Catches common slurs, insults and offensive language with leet-speak variants.
 */

const PROFANITY_ES = [
  "puta", "puto", "mierda", "joder", "coño", "cojones", "hostia", "cabrón",
  "cabrona", "gilipollas", "imbécil", "imbecil", "idiota", "subnormal",
  "maricón", "maricon", "marica", "zorra", "pendejo", "pendeja", "verga",
  "chingar", "chingada", "culero", "culera", "mamón", "mamon", "pinche",
  "hijoputa", "hijo de puta", "hija de puta", "hdp", "ctm", "conchetumadre",
  "perra", "bastardo", "bastarda", "estúpido", "estupido", "estúpida",
  "estupida", "tarado", "tarada", "boludo", "boluda", "pelotudo", "pelotuda",
  "carajo", "coger", "follar", "joputa", "comepollas", "comemierda",
  "malparido", "malparida", "gonorrea", "huevón", "huevon", "webón", "webon",
  "chupapollas", "mamaguevo", "chúpame", "chupame", "vete a la mierda",
];

const PROFANITY_EN = [
  "fuck", "shit", "bitch", "asshole", "bastard", "damn", "cunt", "dick",
  "pussy", "cock", "whore", "slut", "nigger", "nigga", "faggot", "fag",
  "retard", "motherfucker", "bullshit", "dumbass", "jackass", "dipshit",
  "wtf", "stfu", "lmfao", "gtfo",
];

const ALL_WORDS = [...PROFANITY_ES, ...PROFANITY_EN];

// Build regex patterns that handle common leet-speak substitutions
function buildPattern(word: string): RegExp {
  const leetMap: Record<string, string> = {
    a: "[a@4àáâãä]", e: "[e3èéêë]", i: "[i1!ìíîï]", o: "[o0òóôõö]",
    u: "[uùúûü]", s: "[s$5]", t: "[t7]", l: "[l1]", b: "[b8]",
  };
  const pattern = word
    .split("")
    .map(ch => leetMap[ch.toLowerCase()] || ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s._-]*");
  return new RegExp(`\\b${pattern}\\b`, "gi");
}

const PATTERNS = ALL_WORDS.map(w => buildPattern(w));

/**
 * Returns true if text contains profanity.
 */
export function containsProfanity(text: string): boolean {
  if (!text) return false;
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return PATTERNS.some(p => p.test(normalized) || p.test(text));
}

/**
 * Returns cleaned text with profanity replaced by asterisks.
 */
export function censorProfanity(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, (match) => "*".repeat(match.length));
  }
  return result;
}
