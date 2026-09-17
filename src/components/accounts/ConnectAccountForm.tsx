import { useState } from "react";
import { Eye, EyeOff, ExternalLink, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConnectForm, ConnectProvider } from "@/lib/account-connect";

interface Props {
  provider: ConnectProvider;
  form: ConnectForm;
  onChange: (patch: Partial<ConnectForm>) => void;
  disabled?: boolean;
}

const HELP: Record<Exclude<ConnectProvider, "custom">, { text: string; linkLabel: string; href: string }> = {
  gmail: {
    text: "Gmail se conecta con una contraseña de aplicación (16 letras), no con tu contraseña normal. Necesitas tener activada la verificación en 2 pasos.",
    linkLabel: "Crear contraseña de aplicación en Google",
    href: "https://myaccount.google.com/apppasswords",
  },
  outlook: {
    text: "Outlook se conecta con una contraseña de aplicación de Microsoft. Aviso: Microsoft ha desactivado el acceso por contraseña en muchas cuentas; si la conexión falla, esa cuenta no admite este método.",
    linkLabel: "Crear contraseña de aplicación en Microsoft",
    href: "https://account.live.com/proofs/AppPassword",
  },
};

function PasswordInput({ id, value, onChange, placeholder, disabled }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoComplete="new-password" spellCheck={false} disabled={disabled} className="pr-10" />
      <button type="button" tabIndex={-1} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        onClick={() => setShow((s) => !s)}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Formulario de "Conectar una cuenta" según el proveedor elegido: Gmail y Outlook sólo piden
 *  email + contraseña de aplicación (los servidores van puestos); SMTP pide los dos servidores. */
export default function ConnectAccountForm({ provider, form, onChange, disabled }: Props) {
  const [sameCreds, setSameCreds] = useState(true);
  const help = provider === "custom" ? null : HELP[provider];

  const identity = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_150px]">
      <div className="space-y-1">
        <Label htmlFor="acc-first-name">Nombre del remitente</Label>
        <Input id="acc-first-name" value={form.first_name} onChange={(e) => onChange({ first_name: e.target.value })} placeholder="Ana" disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="acc-last-name">Apellido</Label>
        <Input id="acc-last-name" value={form.last_name} onChange={(e) => onChange({ last_name: e.target.value })} placeholder="García" disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="acc-limit">Límite diario</Label>
        <Input id="acc-limit" type="number" min={1} value={form.daily_limit} onChange={(e) => onChange({ daily_limit: e.target.value })} disabled={disabled} />
      </div>
    </div>
  );

  if (provider !== "custom") {
    return (
      <div className="space-y-4">
        {help && (
          <div className="flex gap-2.5 rounded-md border border-primary/20 bg-primary/5 p-3 text-[13px] leading-relaxed text-foreground/80">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="space-y-1.5">
              <p>{help.text}</p>
              <a href={help.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                {help.linkLabel} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="acc-email">Email</Label>
          <Input id="acc-email" type="email" value={form.email} onChange={(e) => onChange({ email: e.target.value })}
            placeholder={provider === "gmail" ? "tu@gmail.com" : "tu@outlook.com"} autoComplete="off" spellCheck={false} disabled={disabled} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acc-app-password">Contraseña de aplicación</Label>
          <PasswordInput id="acc-app-password" value={form.imap_password} disabled={disabled}
            onChange={(v) => onChange({ imap_password: v, smtp_password: v })}
            placeholder={provider === "gmail" ? "abcd efgh ijkl mnop" : "Contraseña de aplicación"} />
        </div>
        {identity}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="acc-email">Email</Label>
        <Input id="acc-email" type="email" value={form.email} onChange={(e) => onChange({ email: e.target.value })}
          placeholder="tu@tudominio.com" autoComplete="off" spellCheck={false} disabled={disabled} />
      </div>
      {identity}

      <div className="space-y-3 rounded-md border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SMTP · envío</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
          <div className="space-y-1">
            <Label htmlFor="acc-smtp-host">Servidor SMTP</Label>
            <Input id="acc-smtp-host" value={form.smtp_host} onChange={(e) => onChange({ smtp_host: e.target.value })} placeholder="smtp.tudominio.com" spellCheck={false} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acc-smtp-port">Puerto</Label>
            <Input id="acc-smtp-port" inputMode="numeric" value={form.smtp_port} onChange={(e) => onChange({ smtp_port: e.target.value })} placeholder="587" disabled={disabled} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="acc-smtp-user">Usuario</Label>
            <Input id="acc-smtp-user" value={form.smtp_username} onChange={(e) => onChange({ smtp_username: e.target.value })} placeholder={form.email || "Tu email, normalmente"} autoComplete="off" spellCheck={false} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acc-smtp-pass">Contraseña</Label>
            <PasswordInput id="acc-smtp-pass" value={form.smtp_password} onChange={(v) => onChange({ smtp_password: v })} disabled={disabled} />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">IMAP · recepción</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
          <div className="space-y-1">
            <Label htmlFor="acc-imap-host">Servidor IMAP</Label>
            <Input id="acc-imap-host" value={form.imap_host} onChange={(e) => onChange({ imap_host: e.target.value })} placeholder="imap.tudominio.com" spellCheck={false} disabled={disabled} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acc-imap-port">Puerto</Label>
            <Input id="acc-imap-port" inputMode="numeric" value={form.imap_port} onChange={(e) => onChange({ imap_port: e.target.value })} placeholder="993" disabled={disabled} />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground/80">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={sameCreds} disabled={disabled}
            onChange={(e) => {
              setSameCreds(e.target.checked);
              // Al volver a "los mismos", lo escrito para IMAP deja de contar.
              if (e.target.checked) onChange({ imap_username: "", imap_password: "" });
            }} />
          Mismo usuario y contraseña que en SMTP
        </label>
        {!sameCreds && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="acc-imap-user">Usuario</Label>
              <Input id="acc-imap-user" value={form.imap_username} onChange={(e) => onChange({ imap_username: e.target.value })} autoComplete="off" spellCheck={false} disabled={disabled} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acc-imap-pass">Contraseña</Label>
              <PasswordInput id="acc-imap-pass" value={form.imap_password} onChange={(v) => onChange({ imap_password: v })} disabled={disabled} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
