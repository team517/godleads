// Prueba de cable de imapLocate contra un servidor IMAP FALSO en local (nada sale de la máquina):
//   npx -y deno run --allow-net --no-check scripts/wire-test/imap-locate.test.ts
import { imapLocate, type Seed } from "../../supabase/functions/_shared/imap-locate.ts";

type Box = Record<string, string[]>; // carpeta → Message-IDs
interface Scenario { name: string; list: string[]; boxes: Box; promos?: string[]; password?: string; badLogin?: boolean; gmail?: boolean; expect: string }

const MID = "<abc.123@cliente.es>";
const BS = String.fromCharCode(92); // barra invertida
const JUNK = `${BS}Junk`;
const scenarios: Scenario[] = [
  { name: "bandeja", list: [`(${BS}HasNoChildren) "/" "INBOX"`, `(${BS}HasNoChildren ${JUNK}) "/" "[Gmail]/Spam"`], boxes: { INBOX: [MID] }, expect: "inbox" },
  { name: "spam por marca Junk con nombre localizado", list: [`() "/" "INBOX"`, `(${JUNK}) "/" "[Gmail]/Correo no deseado"`], boxes: { "[Gmail]/Correo no deseado": [MID] }, expect: "spam" },
  { name: "spam por nombre (sin marcas)", list: [`() "." INBOX`, `() "." INBOX.Junk`], boxes: { "INBOX.Junk": [MID] }, expect: "spam" },
  { name: "aun no ha llegado", list: [`() "/" "INBOX"`, `(${JUNK}) "/" "Spam"`], boxes: { INBOX: ["<otro@x.es>"] }, expect: "missing" },
  { name: "Gmail: Promociones", list: [`() "/" "INBOX"`, `(${JUNK}) "/" "[Gmail]/Spam"`], boxes: { INBOX: [MID] }, promos: [MID], gmail: true, expect: "promotions" },
  { name: "Gmail: Principal (no promo)", list: [`() "/" "INBOX"`, `(${JUNK}) "/" "[Gmail]/Spam"`], boxes: { INBOX: [MID] }, promos: [], gmail: true, expect: "inbox" },
  { name: "credenciales malas", list: [], boxes: {}, badLogin: true, expect: "error" },
  { name: "contrasena con comillas y barra", list: [`() "/" "INBOX"`], boxes: { INBOX: [MID] }, password: `a"b${BS}c`, expect: "inbox" },
];

// Quita las comillas de un string IMAP y deshace los escapes (barra + carácter).
function unquote(s: string): string {
  let t = s;
  if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  let out = "";
  for (let i = 0; i < t.length; i++) { if (t[i] === BS && i + 1 < t.length) { out += t[i + 1]; i++; } else out += t[i]; }
  return out;
}
// Trocea argumentos IMAP respetando comillas y escapes.
function splitArgs(rest: string): string[] {
  const args: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (inQ && ch === BS) { cur += ch + (rest[i + 1] ?? ""); i++; continue; }
    if (ch === '"') { inQ = !inQ; cur += ch; continue; }
    if (ch === " " && !inQ) { if (cur) args.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

function fakeImap(sc: Scenario): { port: number; close: () => void; log: string[] } {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const log: string[] = [];
  const goodPass = sc.password ?? "secreto";
  (async () => {
    for await (const conn of listener) {
      (async () => {
        const enc = new TextEncoder(), dec = new TextDecoder();
        const w = (s: string) => conn.write(enc.encode(s));
        await w("* OK fake IMAP ready\r\n");
        let selected = ""; let buf = "";
        const b = new Uint8Array(8192);
        try {
          while (true) {
            const n = await conn.read(b);
            if (!n) break;
            buf += dec.decode(b.subarray(0, n));
            let i: number;
            while ((i = buf.indexOf("\r\n")) >= 0) {
              const line = buf.slice(0, i); buf = buf.slice(i + 2);
              log.push(line);
              const sp = line.indexOf(" ");
              const tag = line.slice(0, sp);
              const args = splitArgs(line.slice(sp + 1));
              const cmd = (args.shift() || "").toUpperCase();
              if (cmd === "LOGIN") {
                const ok = !sc.badLogin && args.length === 2 && unquote(args[1]) === goodPass;
                await w(ok ? `${tag} OK LOGIN completed\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
              } else if (cmd === "LIST") {
                for (const l of sc.list) await w(`* LIST ${l}\r\n`);
                await w(`${tag} OK LIST completed\r\n`);
              } else if (cmd === "EXAMINE" || cmd === "SELECT") {
                if (cmd === "SELECT") log.push("!! SELECT");
                selected = unquote(args[0] || "");
                const exists = sc.list.some((l) => l.endsWith(`"${selected}"`) || l.endsWith(` ${selected}`));
                await w(exists ? `* 3 EXISTS\r\n${tag} OK [READ-ONLY] done\r\n` : `${tag} NO no such mailbox\r\n`);
              } else if (cmd === "SEARCH") {
                let hit = false;
                if ((args[0] || "").toUpperCase() === "HEADER") hit = (sc.boxes[selected] || []).includes(unquote(args[2] || ""));
                else if ((args[0] || "").toUpperCase() === "X-GM-RAW") {
                  const raw = unquote(args[1] || "");
                  hit = raw.includes("category:promotions") && (sc.promos || []).some((p) => raw.includes(p.slice(1, -1)));
                }
                await w(`* SEARCH${hit ? " 42" : ""}\r\n${tag} OK SEARCH completed\r\n`);
              } else if (cmd === "LOGOUT") {
                await w(`* BYE\r\n${tag} OK bye\r\n`);
              } else {
                log.push(`!! ${cmd}`);
                await w(`${tag} BAD unknown\r\n`);
              }
            }
          }
        } catch { /* el cliente cerró */ } finally { try { conn.close(); } catch { /* */ } }
      })();
    }
  })().catch(() => { /* listener cerrado */ });
  return { port: (listener.addr as Deno.NetAddr).port, close: () => listener.close(), log };
}

let failed = 0;
for (const sc of scenarios) {
  const srv = fakeImap(sc);
  const seed: Seed = { id: "s1", user_id: "u1", email: "semilla@gmail.com", imap_host: "127.0.0.1", imap_port: srv.port, imap_user: "semilla@gmail.com", imap_pass: sc.password ?? "secreto" };
  const got = await imapLocate(seed, { messageId: MID, gmail: sc.gmail });
  const wrote = srv.log.some((l) => l.startsWith("!!"));
  const ok = got === sc.expect && !wrote;
  if (!ok) { failed++; console.log(srv.log.join("\n")); }
  console.log(`${ok ? "OK  " : "FAIL"} ${sc.name}: esperado=${sc.expect} obtenido=${got}${wrote ? " (comando no permitido)" : ""}`);
  srv.close();
}
console.log(failed ? `\n${failed} fallo(s)` : `\nTodo OK: solo lectura y carpeta correcta en los ${scenarios.length} escenarios`);
Deno.exit(failed ? 1 : 0);
