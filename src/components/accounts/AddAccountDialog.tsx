import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, Download, FileSpreadsheet, Loader2, Mail, Upload, Zap, ShieldCheck, Layers, Server, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AddAccountMode = "single" | "bulk";
/** Providers offered for a single account. "custom" = any SMTP/IMAP server. */
export type AccountProvider = "gmail" | "outlook" | "custom";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which option is pre-selected when the dialog opens. */
  initialMode?: AddAccountMode;
  /** The connection form for the chosen provider (state lives in the page). */
  renderForm: (provider: AccountProvider) => ReactNode;
  /** Prepare the page's form for the chosen provider (hosts/ports pre-filled). */
  onPickProvider: (provider: AccountProvider) => void;
  /** Submit the single-account form. */
  onSubmitSingle: () => void | Promise<void>;
  /** True while the account is being saved and its connection verified. */
  submitting?: boolean;
  /** Why the last attempt failed (validation or the mail server's answer), shown above the button. */
  submitError?: string | null;
  /** Import a CSV file (Bulk connect). */
  onCsvFile: (file: File) => void;
  /** Download the header-only CSV template. */
  onDownloadTemplate: () => void;
  /** Export the user's connected mailboxes ("Descargar mails"). */
  onDownloadAccounts: () => void;
  accountsCount: number;
}

/** Gmail mark (multi-colour "M"). */
export function GmailLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 193" className={className} aria-hidden="true" focusable="false" data-logo="gmail">
      <path fill="#4285F4" d="M58.182 192.05V93.14L27.507 65.077 0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455z" />
      <path fill="#34A853" d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.505l-31.156 17.837-27.026 25.798z" />
      <path fill="#EA4335" d="m58.182 93.14-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.669 34.992-4.669 40.644L128 145.504z" />
      <path fill="#FBBC04" d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945z" />
      <path fill="#C5221F" d="m0 49.504 26.759 20.07L58.182 93.14V17.504L41.89 5.286C24.61-7.66 0 4.646 0 26.23z" />
    </svg>
  );
}

/** Outlook mark (blue tile with the "O" over an envelope). */
export function OutlookLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false" data-logo="outlook">
      <rect x="11" y="4" width="19" height="23" rx="2" fill="#1490DF" />
      <path d="M11 11h19v14a2 2 0 0 1-2 2H11z" fill="#28A8EA" />
      <path d="M11 17l9.5 6 9.5-6v8a2 2 0 0 1-2 2H11z" fill="#50D9FF" opacity=".55" />
      <rect x="2" y="8" width="17" height="17" rx="2.6" fill="#0F6CBD" />
      <ellipse cx="10.5" cy="16.5" rx="4.1" ry="4.6" fill="none" stroke="#fff" strokeWidth="2.3" />
    </svg>
  );
}

const PROVIDERS: Array<{ key: AccountProvider; name: string; hint: string }> = [
  { key: "gmail", name: "Gmail", hint: "Email + contraseña de aplicación" },
  { key: "outlook", name: "Outlook", hint: "Email + contraseña de aplicación" },
  { key: "custom", name: "SMTP", hint: "Cualquier servidor SMTP / IMAP" },
];

function ProviderMark({ provider, className }: { provider: AccountProvider; className?: string }) {
  if (provider === "gmail") return <GmailLogo className={className} />;
  if (provider === "outlook") return <OutlookLogo className={className} />;
  return <Send className={cn(className, "text-primary")} />;
}

function Chip({ icon: Icon, children, tone }: { icon: React.ComponentType<{ className?: string }>; children: ReactNode; tone: "violet" | "teal" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold",
      tone === "violet" ? "bg-primary/10 text-primary" : "bg-success/10 text-success",
    )}>
      <Icon className="h-3 w-3" /> {children}
    </span>
  );
}

/** "Añadir cuenta" — una sola puerta de entrada para el usuario del SaaS:
 *  conectar una cuenta (Gmail / Outlook / SMTP), Bulk connect (CSV + plantilla) y descargar sus mails. */
export default function AddAccountDialog({
  open, onOpenChange, initialMode = "single", renderForm, onPickProvider, onSubmitSingle, submitting = false, submitError = null, onCsvFile, onDownloadTemplate, onDownloadAccounts, accountsCount,
}: Props) {
  const [mode, setMode] = useState<AddAccountMode>(initialMode);
  const [step, setStep] = useState<1 | 2>(1);
  const [provider, setProvider] = useState<AccountProvider>("custom");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // The form can be taller than the dialog: bring a new error into view instead of leaving it below the fold.
  useEffect(() => { if (submitError) errorRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [submitError]);

  // Every time it opens, start from the chooser with the requested option selected.
  useEffect(() => { if (open) { setMode(initialMode); setStep(1); setDragOver(false); } }, [open, initialMode]);

  const takeFile = (file?: File | null) => {
    if (!file) return;
    onCsvFile(file);
    onOpenChange(false);
  };

  const pick = (p: AccountProvider) => {
    setProvider(p);
    onPickProvider(p);
    setStep(2);
  };

  const optionCard = (key: AddAccountMode, selected: boolean) => cn(
    "w-full rounded-md border p-4 text-left transition-colors",
    selected
      ? (key === "single" ? "border-primary/50 bg-primary/5" : "border-success/50 bg-success/5")
      : "border-border bg-card hover:bg-muted/40",
  );

  const providerName = PROVIDERS.find((p) => p.key === provider)?.name || "SMTP";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && submitting) return; onOpenChange(o); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted/40">
              <Mail className="h-5 w-5 text-foreground" />
            </span>
            <div>
              <DialogTitle className="font-display text-lg">Añadir cuenta de email</DialogTitle>
              <DialogDescription className="text-[13px]">Conecta una cuenta o sube muchas de golpe con un CSV.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          {/* Stepper */}
          <div className="flex items-center justify-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[13px] font-semibold">
            <span className={cn("inline-flex items-center gap-2", step === 1 ? "text-foreground" : "text-muted-foreground")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>1</span>
              Elige cómo conectar
            </span>
            <span className="h-px w-8 bg-border" />
            <span className={cn("inline-flex items-center gap-2", step === 2 ? "text-foreground" : "text-muted-foreground")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>2</span>
              Conectar
            </span>
          </div>

          {step === 1 ? (
            <>
              {/* Opción 1 — una cuenta */}
              <div className={optionCard("single", mode === "single")}>
                <button type="button" className="block w-full text-left" onClick={() => setMode("single")} aria-pressed={mode === "single"}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10"><Server className="h-4 w-4 text-primary" /></span>
                      <div>
                        <p className="font-display text-[15px] font-semibold text-foreground">Conectar una cuenta</p>
                        <p className="text-[13px] text-muted-foreground">Con las credenciales de tu proveedor: Gmail, Outlook o cualquier servidor SMTP.</p>
                      </div>
                    </div>
                    <span className={cn("mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", mode === "single" ? "border-primary" : "border-border")}>
                      {mode === "single" && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Chip icon={Zap} tone="violet">1 minuto</Chip>
                    <Chip icon={Server} tone="violet">SMTP + IMAP</Chip>
                    <Chip icon={ShieldCheck} tone="violet">Cualquier proveedor</Chip>
                  </div>
                </button>

                {mode === "single" && (
                  <div className="mt-4 border-t border-primary/15 pt-3">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Elige tu proveedor</p>
                    <div className="flex flex-wrap gap-2">
                      {PROVIDERS.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => pick(p.key)}
                          title={p.hint}
                          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[14px] font-semibold text-foreground shadow-rest transition-colors hover:border-primary/50 hover:bg-primary/5"
                        >
                          <ProviderMark provider={p.key} className="h-4 w-4" />
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Opción 2 — Bulk connect */}
              <button type="button" className={optionCard("bulk", mode === "bulk")} onClick={() => setMode("bulk")} aria-pressed={mode === "bulk"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-success/10"><Layers className="h-4 w-4 text-success" /></span>
                    <div>
                      <p className="font-display text-[15px] font-semibold text-foreground">Bulk connect</p>
                      <p className="text-[13px] text-muted-foreground">Sube un CSV y conecta decenas o cientos de cuentas a la vez.</p>
                    </div>
                  </div>
                  <span className={cn("mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", mode === "bulk" ? "border-success" : "border-border")}>
                    {mode === "bulk" && <span className="h-2 w-2 rounded-full bg-success" />}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Chip icon={FileSpreadsheet} tone="teal">CSV</Chip>
                  <Chip icon={Layers} tone="teal">Cientos de cuentas</Chip>
                </div>
              </button>

              {mode === "bulk" && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]); }}
                  className={cn("rounded-md border border-dashed p-4 transition-colors", dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/10")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-[14px] font-semibold text-foreground">Sube tu CSV de cuentas</p>
                        <p className="text-[13px] text-muted-foreground">
                          Arrastra y suelta tu CSV aquí, o{" "}
                          <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={() => fileRef.current?.click()}>elige un archivo</button>
                        </p>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px] text-primary hover:text-primary" onClick={onDownloadTemplate}>
                      <Download className="h-3.5 w-3.5" /> Descargar plantilla
                    </Button>
                  </div>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Archivo CSV de cuentas"
                    onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ""; }} />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => setStep(1)} disabled={submitting}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Volver
                </button>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[13px] font-semibold">
                  <ProviderMark provider={provider} className="h-4 w-4" /> Conectar con {providerName}
                </span>
              </div>
              {renderForm(provider)}
              {submitError && (
                <div ref={errorRef} role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[13px] leading-relaxed text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span className="break-words">{submitError}</span>
                </div>
              )}
              <Button type="button" className="w-full gap-2" onClick={() => void onSubmitSingle()} disabled={submitting}>
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Conectando y verificando…</> : "Añadir cuenta"}
              </Button>
            </div>
          )}
        </div>

        {/* Pie: exportar las cuentas ya conectadas */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-6 py-3">
          <p className="text-[13px] text-muted-foreground">
            {accountsCount > 0 ? `Tienes ${accountsCount} ${accountsCount === 1 ? "cuenta conectada" : "cuentas conectadas"}.` : "Aún no tienes cuentas conectadas."}
          </p>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-[13px]" onClick={onDownloadAccounts} disabled={accountsCount === 0}>
            <Download className="h-3.5 w-3.5" /> Descargar mails
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
