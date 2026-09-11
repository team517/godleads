import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Two files are duplicated on purpose: the frontend imports from src/lib, and Supabase Edge
// Functions can only bundle files under supabase/. Duplication is only safe if it cannot DRIFT,
// so this test fails the build the moment the copies diverge.
const PAIRS: [string, string][] = [
  ["src/lib/classify.ts", "supabase/functions/_shared/classify.ts"],
  ["src/lib/inbox-filters.ts", "supabase/functions/_shared/inbox-filters.ts"],
  ["src/lib/campaign-copy.ts", "supabase/functions/_shared/campaign-copy.ts"],
  ["src/lib/reply-text.ts", "supabase/functions/_shared/reply-text.ts"],
];

describe("shared copies stay byte-identical", () => {
  for (const [a, b] of PAIRS) {
    it(`${a} === ${b}`, () => {
      const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
      expect(read(b), `\n${b} has drifted from ${a}. Copy the source file over it.`).toBe(read(a));
    });
  }
});
