import { useMemo, useState } from "react";
import {
  CheckCircle, XCircle, Loader2, Pencil, RefreshCw, Trash2, Wand2, ShieldCheck, ShieldAlert, ShieldQuestion,
  Server, X, Plus, TrendingUp,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GmailLogo, OutlookLogo } from "@/components/accounts/AddAccountDialog";
import { configVerdict, type ConfigLevel, type DomainAuthLike } from "@/lib/account-health";
import { cn } from "@/lib/utils";

export interface ImapCheckLike { loading?: boolean; ok?: boolean; error?: string; reverifying?: boolean; unverified?: boolean }

interface Props {
  accounts: any[];
  selectedIds: Set<string>;
  allSelected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  imapChecks: Record<string, ImapCheckLike>;
  domainAuth: Record<string, DomainAuthLike>;
  dnsConfiguring: Record<string, boolean>;
  verifying: string | null;
  onConfigureDns: (domain: string) => void;
  onRecheckDomain: (domain: string) => void;
  onRecheckImap: (id: string) => void;
  onEdit: (account: any) => void;
  onVerify: (id: string) => void;
  onDelete: (id: string) => void;
  onAddTag: (id: string, value: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
  allTags: string[];
  filterTag: string | null;
  /** Rampa de la cuenta si está activada: día en curso, límite de hoy y objetivo.
   *  Es lo que decide el "0 / 2" de la columna y la etiqueta "Slow ramp". */
  rampOf: (account: any) => { day: number; eff: number; target: number } | null;
}

const domainOf = (email: string) => (email || "").split("@")[1]?.trim().toLowerCase() || "";

/** Proveedor deducido del servidor de envío, como la columna "Vendors" de Smartlead. */
function providerOf(account: any): { name: string; mark: JSX.Element } {
  const host = String(account?.smtp_host || account?.imap_host || "").toLowerCase();
  if (host.includes("gmail") || host.includes("google")) return { name: "Gmail", mark: <GmailLogo className="h-4 w-4" /> };
  if (host.includes("office365") || host.includes("outlook") || host.includes("hotmail")) return { name: "Outlook", mark: <OutlookLogo className="h-4 w-4" /> };
  if (host.includes("ionos") || host.includes("1and1")) return { name: "IONOS", mark: <Server className="h-4 w-4 text-[#003D8F]" /> };
  if (host.includes("zoho")) return { name: "Zoho", mark: <Server className="h-4 w-4 text-[#E42527]" /> };
  return { name: "SMTP", mark: <Server className="h-4 w-4 text-primary" /> };
}

const AUTH_CHIP: Record<string, string> = {
  pass: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  fail: "border-destructive/30 bg-destructive/10 text-destructive",
  none: "border-border bg-muted text-muted-foreground",
};

/** SPF / DKIM / DMARC en tres pastillas mínimas: el registro y su estado por color. */
function AuthPills({ auth }: { auth: DomainAuthLike | undefined }) {
  return (
    <span className="inline-flex flex-nowrap gap-1">
      {(["spf", "dkim", "dmarc"] as const).map((k) => {
        const st = auth?.[k];
        const cls = AUTH_CHIP[st ?? "none"];
        const text = st === "pass" ? "correcto" : st === "warn" ? "a revisar" : st === "fail" ? "no encontrado" : "sin datos";
        return (
          <span key={k} title={`${k.toUpperCase()}: ${text}`} className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", cls)}>
            {k}
          </span>
        );
      })}
    </span>
  );
}

const LEVEL_META: Record<ConfigLevel, { cls: string; Icon: typeof ShieldCheck }> = {
  ok: { cls: "border-success/30 bg-success/10 text-success", Icon: ShieldCheck },
  warn: { cls: "border-warning/30 bg-warning/10 text-warning", Icon: ShieldQuestion },
  bad: { cls: "border-destructive/30 bg-destructive/10 text-destructive", Icon: ShieldAlert },
  checking: { cls: "border-border bg-muted text-muted-foreground", Icon: Loader2 },
  unknown: { cls: "border-border bg-muted text-muted-foreground", Icon: ShieldQuestion },
};

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-semibold text-secondary-foreground", className)}>
      {children}
    </th>
  );
}

/** Tabla de cuentas conectadas al estilo del panel de Smartlead, pero con la AUTENTICACIÓN
 *  DEL DOMINIO (SPF · DKIM · DMARC) y el estado del DNS donde ellos ponen el warm-up. */
export default function AccountsTable(p: Props) {
  const [tagFor, setTagFor] = useState<string | null>(null);

  const rows = useMemo(() => p.accounts.map((a) => {
    const domain = domainOf(a.email);
    return { account: a, domain, auth: p.domainAuth[domain], verdict: configVerdict(domain, p.domainAuth[domain]) };
  }), [p.accounts, p.domainAuth]);

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-card shadow-rest">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border bg-accent/60 dark:bg-secondary">
              <Th className="w-10 pl-4 pr-0">
                <Checkbox checked={p.allSelected} onCheckedChange={p.onToggleAll} aria-label="Seleccionar todas las cuentas" />
              </Th>
              <Th>Cuenta</Th>
              <Th>Proveedor</Th>
              <Th>Límite diario</Th>
              <Th>Autenticación</Th>
              <Th>Configuración</Th>
              <Th>Conexión</Th>
              <Th>Etiquetas</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody className="rows-in">
            {rows.map(({ account, domain, auth, verdict }) => {
              const prov = providerOf(account);
              const ic = p.imapChecks[account.id];
              const ramp = p.rampOf(account);
              const limit = ramp ? ramp.eff : (account.daily_limit || 30);
              const used = account.sent_today || 0;
              const meta = LEVEL_META[verdict.level];
              const dimmed = p.filterTag && !(account.tags || []).includes(p.filterTag);
              return (
                <tr
                  key={account.id}
                  data-state={p.selectedIds.has(account.id) ? "selected" : undefined}
                  className={cn(
                    "border-b border-border/70 transition-colors last:border-0 hover:bg-accent/30 dark:hover:bg-secondary/60",
                    p.selectedIds.has(account.id) && "bg-accent/70 shadow-[inset_3px_0_0_hsl(var(--primary))]",
                    dimmed && "opacity-55",
                  )}
                >
                  <td className="pl-4 pr-0 align-middle">
                    <Checkbox
                      checked={p.selectedIds.has(account.id)}
                      onCheckedChange={() => p.onToggleSelect(account.id)}
                      aria-label={`Seleccionar ${account.email}`}
                    />
                  </td>

                  {/* Cuenta: nombre del remitente + dirección, con el punto de estado real */}
                  <td className="max-w-[280px] px-3 py-2.5 align-middle">
                    <p className="flex items-center gap-1.5 text-[14.5px] font-semibold text-foreground">
                      <span
                        title={account.status === "connected" ? "Conectada" : account.status === "error" ? "Con error" : "Pendiente de verificar"}
                        className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
                          account.status === "connected" ? "bg-[#05D17F]" : account.status === "error" ? "bg-destructive" : "bg-warning")}
                      />
                      <span className="truncate">{[account.first_name, account.last_name].filter(Boolean).join(" ") || account.email}</span>
                    </p>
                    <p className="truncate pl-3 text-[12.5px] text-muted-foreground">{account.email}</p>
                  </td>

                  <td className="px-3 py-2.5 align-middle">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-secondary-foreground">
                      {prov.mark} {prov.name}
                    </span>
                  </td>

                  {/* Límite diario, como "0 / 30" de Smartlead, con su barra. Si la cuenta está en
                      slow ramp, el tope de hoy es el de la rampa y se dice con su etiqueta. */}
                  <td className="w-[132px] px-3 py-2.5 align-middle">
                    <p className="whitespace-nowrap text-[13.5px] font-semibold tabular text-foreground">{used} / {limit}</p>
                    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.min((used / Math.max(1, limit)) * 100, 100)}%` }} />
                    </span>
                    {ramp && (
                      <span
                        title={`Slow ramp activado · día ${ramp.day} · hoy ${ramp.eff} correos, objetivo ${ramp.target}`}
                        className="mt-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-primary"
                      >
                        <TrendingUp className="h-2.5 w-2.5" /> Slow ramp · día {ramp.day}
                      </span>
                    )}
                  </td>

                  {/* Donde Smartlead pone el warm-up: los registros del dominio */}
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle"><AuthPills auth={auth} /></td>

                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex flex-col items-start gap-1">
                      <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", meta.cls)}>
                        <meta.Icon className={cn("h-3 w-3", verdict.level === "checking" && "animate-spin")} /> {verdict.label}
                      </span>
                      {verdict.canFix && (
                        <button
                          type="button"
                          onClick={() => p.onConfigureDns(domain)}
                          disabled={!domain || p.dnsConfiguring[domain]}
                          title="Configura SPF, DKIM y DMARC en el dominio"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                        >
                          {p.dnsConfiguring[domain] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Configurar DNS
                        </button>
                      )}
                      {verdict.level === "ok" && (
                        <button
                          type="button"
                          onClick={() => p.onRecheckDomain(domain)}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                        >
                          <RefreshCw className="h-3 w-3" /> Comprobar
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Conexión real del buzón (prueba de login IMAP) */}
                  <td className="px-3 py-2.5 align-middle">
                    {!ic || ic.loading ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Comprobando…</span>
                    ) : ic.ok ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-success"><CheckCircle className="h-3.5 w-3.5" /> Conectada</span>
                    ) : ic.unverified ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] text-muted-foreground" title={ic.error || "No se pudo comprobar ahora mismo"}>
                        <ShieldQuestion className="h-3.5 w-3.5" /> Sin comprobar
                        <button onClick={() => p.onRecheckImap(account.id)} className="underline decoration-dotted">reintentar</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold text-destructive" title={ic.error || "Fallo de conexión IMAP"}>
                        <XCircle className="h-3.5 w-3.5" /> Sin conexión
                        <button onClick={() => p.onRecheckImap(account.id)} className="underline decoration-dotted">reintentar</button>
                      </span>
                    )}
                  </td>

                  <td className="max-w-[200px] px-3 py-2.5 align-middle">
                    <div className="flex flex-wrap items-center gap-1">
                      {(account.tags || []).map((tag: string) => (
                        <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-[11px] font-semibold text-secondary-foreground">
                          {tag}
                          <button onClick={() => p.onRemoveTag(account.id, tag)} aria-label={`Quitar ${tag}`} className="rounded-full p-0.5 hover:bg-foreground/10">
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      {tagFor === account.id ? (
                        <>
                          <Input
                            autoFocus
                            placeholder="etiqueta"
                            className="h-6 w-24 border-dashed px-1.5 text-[11px]"
                            list={`tags-${account.id}`}
                            onBlur={() => setTagFor(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { p.onAddTag(account.id, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ""; setTagFor(null); }
                              if (e.key === "Escape") setTagFor(null);
                            }}
                          />
                          <datalist id={`tags-${account.id}`}>
                            {p.allTags.filter((t) => !(account.tags || []).includes(t)).map((t) => <option key={t} value={t} />)}
                          </datalist>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTagFor(account.id)}
                          aria-label={`Añadir etiqueta a ${account.email}`}
                          className="inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 text-[11px] font-semibold text-muted-foreground hover:border-primary hover:text-primary"
                        >
                          <Plus className="h-2.5 w-2.5" /> tag
                        </button>
                      )}
                    </div>
                  </td>

                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar" aria-label={`Editar ${account.email}`} onClick={() => p.onEdit(account)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Verificar la conexión" aria-label={`Verificar ${account.email}`} onClick={() => p.onVerify(account.id)} disabled={p.verifying === account.id}>
                        <RefreshCw className={cn("h-3.5 w-3.5", p.verifying === account.id && "animate-spin")} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" title="Eliminar" aria-label={`Eliminar ${account.email}`} onClick={() => p.onDelete(account.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
