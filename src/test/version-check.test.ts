import { describe, expect, it } from "vitest";
import { bundleInHtml, checkForNewVersion, runningBundle, userIsTyping } from "@/lib/version-check";

const docWith = (bundle: string): Document => {
  const d = document.implementation.createHTMLDocument("t");
  const s = d.createElement("script");
  s.setAttribute("type", "module");
  s.setAttribute("src", `/assets/${bundle}`);
  d.head.appendChild(s);
  return d;
};
const html = (bundle: string) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/${bundle}"></script></head><body></body></html>`;
const fetchReturning = (body: string, ok = true) => (async () => ({ ok, text: async () => body })) as unknown as typeof fetch;

describe("vigilante de versión (recarga tras «Implementar»)", () => {
  it("lee el hash del bundle que corre y el que sirve el servidor", () => {
    expect(runningBundle(docWith("index-CLSdVAD6.js"))).toBe("/assets/index-CLSdVAD6.js");
    expect(bundleInHtml(html("index-Zz9.js"))).toBe("/assets/index-Zz9.js");
    expect(bundleInHtml("<html>no bundle</html>")).toBe("");
  });
  it("mismo hash → nada que hacer", async () => {
    expect(await checkForNewVersion(fetchReturning(html("index-AAA.js")), docWith("index-AAA.js"))).toBe("same");
  });
  it("hash distinto → recargar", async () => {
    expect(await checkForNewVersion(fetchReturning(html("index-BBB.js")), docWith("index-AAA.js"))).toBe("reload");
  });
  it("hash distinto pero alguien está escribiendo → esperar", async () => {
    // focus() only works on the live document in jsdom, so build the case there.
    const s = document.createElement("script");
    s.setAttribute("src", "/assets/index-AAA.js");
    document.head.appendChild(s);
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    try {
      expect(userIsTyping(document)).toBe(true);
      expect(await checkForNewVersion(fetchReturning(html("index-BBB.js")), document)).toBe("typing");
    } finally {
      ta.remove(); s.remove();
    }
  });
  it("servidor caído o respuesta rara → no recarga nunca por error", async () => {
    expect(await checkForNewVersion(fetchReturning("", false), docWith("index-AAA.js"))).toBe("unknown");
    expect(await checkForNewVersion((async () => { throw new Error("offline"); }) as unknown as typeof fetch, docWith("index-AAA.js"))).toBe("unknown");
    expect(await checkForNewVersion(fetchReturning(html("index-BBB.js")), docWith("nothing.js"))).toBe("unknown");
  });
});
