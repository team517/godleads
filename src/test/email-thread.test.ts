import { describe, it, expect } from "vitest";
import {
  angle,
  buildMimeMessage,
  buildThreadHeaders,
  dotStuff,
  extractMessageIds,
  foldHeader,
  formatDateHeader,
  fromHeader,
  mimeWord,
  newMessageId,
  normalizeMessageId,
  replySubject,
  sanitizeAddress,
  sanitizeHeaderValue,
  toCrlf,
} from "../../supabase/functions/_shared/emailThread";

describe("normalizeMessageId", () => {
  it("strips angle brackets and whitespace", () => {
    expect(normalizeMessageId("<abc123@mail.example.com>")).toBe("abc123@mail.example.com");
    expect(normalizeMessageId("  abc123@mail.example.com  ")).toBe("abc123@mail.example.com");
    expect(normalizeMessageId("Message-ID:\r\n <abc@x.com>")).toBe("abc@x.com");
  });
  it("rejects unusable values", () => {
    for (const bad of ["", "   ", null, undefined, "<>", "not-an-id", "a b@c.com"]) {
      expect(normalizeMessageId(bad as string)).toBeNull();
    }
  });
  it("is idempotent through angle()", () => {
    expect(angle("<a@b.com>")).toBe("<a@b.com>");
    expect(angle("a@b.com")).toBe("<a@b.com>");
    expect(angle("garbage")).toBe("");
  });
});

describe("extractMessageIds", () => {
  it("keeps chain order", () => {
    expect(extractMessageIds("<a@x.com> <b@x.com> <c@x.com>")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
  it("survives folded headers and bare tokens", () => {
    expect(extractMessageIds("<a@x.com>\r\n <b@x.com>")).toEqual(["a@x.com", "b@x.com"]);
    expect(extractMessageIds("a@x.com b@x.com")).toEqual(["a@x.com", "b@x.com"]);
  });
  it("returns [] for empty input", () => {
    expect(extractMessageIds(null)).toEqual([]);
    expect(extractMessageIds("   ")).toEqual([]);
  });
});

describe("buildThreadHeaders", () => {
  it("appends the parent id to the parent chain", () => {
    const h = buildThreadHeaders({ messageId: "c@x.com", refChain: "<a@x.com> <b@x.com>" });
    expect(h.inReplyTo).toBe("<c@x.com>");
    expect(h.references).toBe("<a@x.com> <b@x.com> <c@x.com>");
  });

  it("handles the first reply of a thread (no chain yet)", () => {
    const h = buildThreadHeaders({ messageId: "<first@x.com>", refChain: null });
    expect(h.inReplyTo).toBe("<first@x.com>");
    expect(h.references).toBe("<first@x.com>");
  });

  it("dedupes an id already present in the chain", () => {
    const h = buildThreadHeaders({ messageId: "b@x.com", refChain: "<a@x.com> <b@x.com>" });
    expect(h.references).toBe("<a@x.com> <b@x.com>");
    expect(h.inReplyTo).toBe("<b@x.com>");
  });

  it("falls back to the last chain id when the parent has no Message-ID", () => {
    const h = buildThreadHeaders({ messageId: null, refChain: "<a@x.com> <b@x.com>" });
    expect(h.inReplyTo).toBe("<b@x.com>");
    expect(h.references).toBe("<a@x.com> <b@x.com>");
  });

  it("returns nulls when there is nothing to thread against", () => {
    expect(buildThreadHeaders({ messageId: null, refChain: null })).toEqual({ inReplyTo: null, references: null });
    expect(buildThreadHeaders({ messageId: "bogus", refChain: "" })).toEqual({ inReplyTo: null, references: null });
  });

  it("trims a runaway chain but keeps the root and the newest ids", () => {
    const chain = Array.from({ length: 40 }, (_, i) => `<id${i}@x.com>`).join(" ");
    const h = buildThreadHeaders({ messageId: "new@x.com", refChain: chain });
    const ids = extractMessageIds(h.references);
    expect(ids.length).toBe(20);
    expect(ids[0]).toBe("id0@x.com"); // thread root — what groups the conversation
    expect(ids[ids.length - 1]).toBe("new@x.com");
    expect(ids[ids.length - 2]).toBe("id39@x.com");
  });
});

describe("replySubject", () => {
  it("prefixes once", () => {
    expect(replySubject("Cambio en la campaña")).toBe("Re: Cambio en la campaña");
  });
  it("never doubles an existing prefix", () => {
    for (const s of ["Re: algo", "RE: algo", "re : algo", "Re[2]: algo", "RV: algo", "Fwd: algo"]) {
      expect(replySubject(s)).toBe(s);
    }
  });
  it("uses the fallback for an empty subject", () => {
    expect(replySubject("", "tu campaña")).toBe("Re: tu campaña");
    expect(replySubject(null, "tu campaña")).toBe("Re: tu campaña");
  });
  it("strips newlines (header injection)", () => {
    expect(replySubject("hola\r\nBcc: victima@x.com")).toBe("Re: hola Bcc: victima@x.com");
  });
});

describe("mimeWord (RFC 2047)", () => {
  it("leaves pure ASCII untouched", () => {
    expect(mimeWord("Re: your campaign")).toBe("Re: your campaign");
  });
  it("encodes accents", () => {
    const out = mimeWord("Re: tu campaña");
    expect(out.startsWith("=?UTF-8?B?")).toBe(true);
    expect(out.endsWith("?=")).toBe(true);
    const decoded = Buffer.from(out.slice(10, -2), "base64").toString("utf8");
    expect(decoded).toBe("Re: tu campaña");
  });
  it("splits long values into words of at most 75 chars", () => {
    const long = ("Re: " + "cañón ".repeat(40)).trim();
    const out = mimeWord(long);
    const words = out.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    const decoded = words.map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8")).join("");
    expect(decoded).toBe(long);
  });
  it("never splits a multi-byte character in half", () => {
    const out = mimeWord("ñ".repeat(60));
    const decoded = out
      .split("\r\n ")
      .map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe("ñ".repeat(60));
  });
});

describe("fromHeader", () => {
  it("quotes an ASCII display name", () => {
    expect(fromHeader("OnePulso", "team@onepulso.online")).toBe('"OnePulso" <team@onepulso.online>');
  });
  it("quotes a name containing dots/at (the IONOS 554 case)", () => {
    expect(fromHeader("OnePulso.online", "a@b.com")).toBe('"OnePulso.online" <a@b.com>');
  });
  it("encodes a non-ASCII name", () => {
    expect(fromHeader("Atención", "a@b.com")).toMatch(/^=\?UTF-8\?B\?.+\?= <a@b\.com>$/);
  });
  it("falls back to the bare address", () => {
    expect(fromHeader("", "a@b.com")).toBe("<a@b.com>");
    expect(fromHeader(null, "a@b.com")).toBe("<a@b.com>");
  });
});

describe("foldHeader", () => {
  it("keeps a short header on one line", () => {
    expect(foldHeader("In-Reply-To", "<a@x.com>")).toBe("In-Reply-To: <a@x.com>");
  });
  it("folds a long References chain with CRLF + space", () => {
    const chain = Array.from({ length: 12 }, (_, i) => `<message-id-number-${i}@mail.example.com>`).join(" ");
    const folded = foldHeader("References", chain);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].startsWith("References: ")).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(78);
    for (const l of lines.slice(1)) expect(l.startsWith(" ")).toBe(true);
    // Unfolding must give the original chain back.
    expect(lines.join("").replace("References: ", "")).toBe(chain.replace(/ /g, " "));
  });
  it("returns empty for an empty value", () => {
    expect(foldHeader("References", "")).toBe("");
  });
});

describe("SMTP body safety", () => {
  it("normalises every line ending to CRLF", () => {
    expect(toCrlf("a\nb\r\nc\rd")).toBe("a\r\nb\r\nc\r\nd");
  });
  it("dot-stuffs lines that would terminate DATA", () => {
    expect(dotStuff("hola\n.\nadios")).toBe("hola\n..\nadios");
    expect(dotStuff(".hidden")).toBe("..hidden");
    expect(dotStuff("no. dot")).toBe("no. dot");
  });
});

describe("formatDateHeader / newMessageId", () => {
  it("emits an RFC 5322 date with a numeric offset", () => {
    const d = new Date(Date.UTC(2026, 7, 21, 10, 0, 0));
    expect(formatDateHeader(d)).toBe("Fri, 21 Aug 2026 10:00:00 +0000");
  });
  it("builds an id on the sender domain", () => {
    expect(newMessageId("support@onepulso.online", "seed1")).toBe("seed1@onepulso.online");
    expect(newMessageId("broken", "seed1")).toBe("seed1@localhost");
  });
  it("is unique without a seed", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newMessageId("a@b.com")));
    expect(ids.size).toBe(200);
  });
});

describe("buildMimeMessage", () => {
  const base = {
    from: "support@onepulso.online",
    fromName: "OnePulso",
    to: "cliente@empresa.com",
    subject: "Re: tu campaña",
    html: "<p>Hola</p>",
    date: new Date(Date.UTC(2026, 7, 21, 10, 0, 0)),
    messageId: "out1@onepulso.online",
  };

  const headersOf = (msg: string) => msg.split("\r\n\r\n")[0];
  const bodyOf = (msg: string) => Buffer.from(msg.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");

  it("carries the threading headers", () => {
    const msg = buildMimeMessage({ ...base, inReplyTo: "<in@x.com>", references: "<a@x.com> <in@x.com>" });
    const h = headersOf(msg);
    expect(h).toContain("In-Reply-To: <in@x.com>");
    expect(h).toContain("References: <a@x.com> <in@x.com>");
    expect(h).toContain("Message-ID: <out1@onepulso.online>");
    expect(h).toContain("Date: Fri, 21 Aug 2026 10:00:00 +0000");
  });

  it("omits the threading headers when there is no thread", () => {
    const h = headersOf(buildMimeMessage(base));
    expect(h).not.toContain("In-Reply-To");
    expect(h).not.toContain("References");
  });

  it("encodes an accented subject", () => {
    const h = headersOf(buildMimeMessage(base));
    expect(h).toContain("Subject: =?UTF-8?B?");
    expect(h).not.toContain("campaña");
  });

  it("round-trips the HTML body through base64", () => {
    const html = "<p>Hola, ¿cómo va la campaña?</p><p>Un saludo</p>";
    expect(bodyOf(buildMimeMessage({ ...base, html }))).toBe(html);
  });

  it("keeps base64 lines within the SMTP line limit", () => {
    const html = `<p>${"texto muy largo ".repeat(500)}</p>`;
    for (const line of buildMimeMessage({ ...base, html }).split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
  });

  it("cannot be terminated early by a dot line in the body", () => {
    const msg = buildMimeMessage({ ...base, html: "<p>uno</p>\n.\n<p>dos</p>" });
    const lines = msg.split("\r\n");
    expect(lines.some((l) => l === ".")).toBe(false);
  });

  it("uses CRLF everywhere", () => {
    const msg = buildMimeMessage({ ...base, html: "<p>a</p>\n<p>b</p>" });
    expect(/[^\r]\n/.test(msg)).toBe(false);
  });

  it("cannot be made to inject extra headers", () => {
    const h = headersOf(
      buildMimeMessage({
        ...base,
        to: "cliente@empresa.com>\r\nBcc: victima@x.com",
        subject: "hola\r\nBcc: otra@x.com",
        fromName: "OnePulso\r\nX-Evil: 1",
      }),
    );
    // The injected text survives as harmless CONTENT of To/Subject, but it must never
    // become a header line of its own.
    const names = h.split("\r\n").filter((l) => !l.startsWith(" ")).map((l) => l.split(":")[0]);
    expect(names).not.toContain("Bcc");
    expect(names).not.toContain("X-Evil");
    expect(h).toContain("To: <cliente@empresa.comBcc:victima@x.com>");
  });
});

// The exact sequence the customer-service agent produces for a copy_change: the client
// writes, the agent acks, and a LATER cron run sends the "ya está aplicado" confirmation.
// All three must end up in one conversation in the client's mailbox.
describe("full agent conversation stays in one thread", () => {
  it("chains client → ack → deferred confirmation", () => {
    // 1. What fetch-inbox stored for the client's email (id bare, chain in brackets).
    const inbound = { message_id: "client-1@empresa.com", ref_chain: "<root@empresa.com>" };

    // 2. The ack the agent sends now.
    const ackThread = buildThreadHeaders({ messageId: inbound.message_id, refChain: inbound.ref_chain });
    expect(ackThread.inReplyTo).toBe("<client-1@empresa.com>");
    expect(ackThread.references).toBe("<root@empresa.com> <client-1@empresa.com>");
    const ackId = newMessageId("support@onepulso.online", "ack1");

    // 3. The confirmation queued for a later run replies to OUR ack.
    const confirmThread = buildThreadHeaders({ messageId: ackId, refChain: ackThread.references });
    expect(confirmThread.inReplyTo).toBe("<ack1@onepulso.online>");
    expect(confirmThread.references).toBe("<root@empresa.com> <client-1@empresa.com> <ack1@onepulso.online>");

    // 4. Every message shares the same thread root, which is what groups them.
    for (const t of [ackThread, confirmThread]) {
      expect(extractMessageIds(t.references)[0]).toBe("root@empresa.com");
    }
  });

  it("survives a client whose mail server omitted the Message-ID", () => {
    const t = buildThreadHeaders({ messageId: null, refChain: "<root@empresa.com>" });
    expect(t.inReplyTo).toBe("<root@empresa.com>");
    expect(t.references).toBe("<root@empresa.com>");
  });

  it("starts a clean thread when the client's email carries nothing to thread on", () => {
    const t = buildThreadHeaders({ messageId: null, refChain: null });
    const h = buildMimeMessage({
      from: "support@onepulso.online",
      fromName: "OnePulso",
      to: "ana@empresa.com",
      subject: replySubject("Duda sobre la campaña"),
      html: "<p>Hola</p>",
      date: new Date(Date.UTC(2026, 7, 21, 10, 0, 0)),
      messageId: newMessageId("support@onepulso.online", "out1"),
      inReplyTo: t.inReplyTo,
      references: t.references,
    }).split("\r\n\r\n")[0];
    // No fake threading headers — but always our own Message-ID, so the client's answer
    // can thread back onto us.
    expect(h).not.toContain("In-Reply-To");
    expect(h).toContain("Message-ID: <out1@onepulso.online>");
    const encoded = h.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)![1];
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("Re: Duda sobre la campaña");
  });
});

// Round trip: what we put on the wire has to be readable by the platform's OWN IMAP
// parser (fetch-inbox), because the client's answer comes back through it. These are the
// exact header regexes fetch-inbox uses — if a folded References stopped matching them,
// the chain would silently break on the way back in.
describe("round trip through fetch-inbox's header parsing", () => {
  const headerVal = (raw: string, re: RegExp) => {
    const m = raw.match(re);
    return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
  };
  const parse = (raw: string) => {
    const msgIdRaw = headerVal(raw, /Message-ID:\s*(.+(?:\r?\n[ \t]+.+)*)/i);
    const referencesStr = headerVal(raw, /References:\s*(<[^\r\n]+(?:\r?\n[ \t]+[^\r\n]+)*)/i);
    const inReplyToStr = headerVal(raw, /In-Reply-To:\s*(<[^\r\n>]+>)/i);
    return {
      message_id: (msgIdRaw.match(/<([^<>\s]+)>/) || [])[1] || "",
      ref_chain: Array.from(new Set(`${referencesStr} ${inReplyToStr}`.match(/<[^<>\s]+>/g) || [])).join(" "),
      in_reply_to: inReplyToStr,
    };
  };

  const build = (thread: { inReplyTo: string | null; references: string | null }, id: string) =>
    buildMimeMessage({
      from: "support@onepulso.online",
      fromName: "OnePulso",
      to: "ana@empresa.com",
      subject: "Re: tu campaña",
      html: "<p>Hola</p>",
      date: new Date(Date.UTC(2026, 7, 21, 10, 0, 0)),
      messageId: id,
      inReplyTo: thread.inReplyTo,
      references: thread.references,
    });

  it("reads back our Message-ID and chain unchanged", () => {
    const thread = buildThreadHeaders({ messageId: "client-1@empresa.com", refChain: "<root@empresa.com>" });
    const parsed = parse(build(thread, "ack1@onepulso.online"));
    expect(parsed.message_id).toBe("ack1@onepulso.online");
    expect(parsed.in_reply_to).toBe("<client-1@empresa.com>");
    expect(parsed.ref_chain).toBe("<root@empresa.com> <client-1@empresa.com>");
  });

  it("reads back a FOLDED References chain unchanged", () => {
    const long = Array.from({ length: 12 }, (_, i) => `<message-id-number-${i}@mail.example.com>`).join(" ");
    const parsed = parse(build({ inReplyTo: "<message-id-number-11@mail.example.com>", references: long }, "ack2@onepulso.online"));
    expect(parsed.ref_chain).toBe(long);
  });

  it("keeps the chain growing correctly across a full round trip", () => {
    // Agent answers the client…
    const t1 = buildThreadHeaders({ messageId: "client-1@empresa.com", refChain: "<root@empresa.com>" });
    const ours = parse(build(t1, "ours@onepulso.online"));
    // …the client replies to us, and fetch-inbox stores THEIR headers…
    const theirReply = { message_id: "client-2@empresa.com", ref_chain: `${ours.ref_chain} <${ours.message_id}>` };
    // …and our next answer threads onto all of it.
    const t2 = buildThreadHeaders({ messageId: theirReply.message_id, refChain: theirReply.ref_chain });
    expect(extractMessageIds(t2.references)).toEqual([
      "root@empresa.com",
      "client-1@empresa.com",
      "ours@onepulso.online",
      "client-2@empresa.com",
    ]);
  });
});

describe("sanitizeAddress / sanitizeHeaderValue", () => {
  it("keeps a clean address untouched", () => {
    expect(sanitizeAddress(" cliente@empresa.com ")).toBe("cliente@empresa.com");
  });
  it("removes the characters that let an address escape its header", () => {
    expect(sanitizeAddress("a@b.com>\r\nBcc: c@d.com")).toBe("a@b.comBcc:c@d.com");
  });
  it("collapses whitespace in a header value", () => {
    expect(sanitizeHeaderValue("  hola\r\n  mundo\t")).toBe("hola mundo");
  });
});
