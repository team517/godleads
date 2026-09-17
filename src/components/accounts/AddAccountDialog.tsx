import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Download, FileSpreadsheet, Mail, Upload, Zap, ShieldCheck, Layers, Server } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AddAccountMode = "single" | "bulk";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which option is pre-selected when the dialog opens. */
  initialMode?: AddAccountMode;
  /** The page's existing SMTP/IMAP form fields (state lives in the page). */
  renderForm: () => ReactNode;
  /** Submit the single-account form. */
  onSubmitSingle: () => void | Promise<void>;
  /** Import a CSV file (Bulk connect). */
  onCsvFile: (file: File) => void;
  /** Download the header-only CSV template. */
  onDownloadTemplate: () => void;
  /** Export the user's connected mailboxes ("Descargar mails"). */
  onDownloadAccounts: () => void;
  accountsCount: number;
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
 *  conectar una cuenta (SMTP/IMAP), Bulk connect (CSV + plantilla) y descargar sus mails. */
export default function AddAccountDialog({
  open, onOpenChange, initialMode = "single", renderForm, onSubmitSingle, onCsvFile, onDownloadTemplate, onDownloadAccounts, accountsCount,
}: Props) {
  const [mode, setMode] = useState<AddAccountMode>(initialMode);
  const [step, setStep] = useState<1 | 2>(1);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Every time it opens, start from the chooser with the requested option selected.
  useEffect(() => { if (open) { setMode(initialMode); setStep(1); setDragOver(false); } }, [open, initialMode]);

  const takeFile = (file?: File | null) => {
    if (!file) return;
    onCsvFile(file);
    onOpenChange(false);
  };

  const optionCard = (key: AddAccountMode, selected: boolean) => cn(
    "w-full rounded-md border p-4 text-left transition-colors",
    selected
      ? (key === "single" ? "border-primary/50 bg-primary/5" : "border-success/50 bg-success/5")
      : "border-border bg-card hover:bg-muted/40",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <button type="button" className={optionCard("single", mode === "single")} onClick={() => setMode("single")} aria-pressed={mode === "single"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10"><Server className="h-4 w-4 text-primary" /></span>
                    <div>
                      <p className="font-display text-[15px] font-semibold text-foreground">Conectar una cuenta</p>
                      <p className="text-[13px] text-muted-foreground">Con los datos SMTP e IMAP de tu proveedor (IONOS, Google, Outlook, el que sea).</p>
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

              {mode === "bulk" ? (
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
              ) : (
                <Button type="button" className="w-full" onClick={() => setStep(2)}>Continuar</Button>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Volver
              </button>
              {renderForm()}
              <Button type="button" className="w-full" onClick={() => void onSubmitSingle()}>Añadir cuenta</Button>
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
