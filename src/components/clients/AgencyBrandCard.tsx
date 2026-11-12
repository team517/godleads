import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, ImagePlus, Link2, Loader2, Palette, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { BRAND_SWATCHES, HEX_RE, callClients, uploadBrandLogo, type AgencyBranding } from "@/lib/clients-api";
import { SLUG_RE, agencyLoginUrl, slugify } from "@/lib/client-access";
import { extractLogoColor } from "@/lib/logoColor";
import { cn } from "@/lib/utils";

/* "Tu marca de agencia" (12-11-2026): el logo, el nombre y el color que ven TUS clientes en su
   entrada exclusiva (/acceso/<tu-dirección>). Dentro del panel verán ya su propio logo. */

export function AgencyBrandCard({ onLoaded }: { onLoaded?: (a: AgencyBranding | null) => void }) {
  const [agency, setAgency] = useState<AgencyBranding | null>(null);
  const [form, setForm] = useState({ agency_name: "", logo_url: "", brand_color: "", slug: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (a: AgencyBranding | null) => {
    setAgency(a);
    onLoaded?.(a);
    if (a) setForm({ agency_name: a.agency_name || "", logo_url: a.logo_url || "", brand_color: a.brand_color || "", slug: a.slug });
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { status, body } = await callClients("get_agency").catch(() => ({ status: 0, body: {} as any }));
      if (!vivo) return;
      if (status === 200) apply(body?.agency || null);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const color = HEX_RE.test(form.brand_color) ? form.brand_color : "#6E58F1";
  const link = agencyLoginUrl(window.location.origin, agency?.slug || null);
  const dirty = !!agency && (
    form.agency_name !== (agency.agency_name || "") || form.logo_url !== (agency.logo_url || "")
    || form.brand_color !== (agency.brand_color || "") || form.slug !== agency.slug
  );
  const slugOk = SLUG_RE.test(form.slug);

  const pickLogo = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const { url, color: c } = await uploadBrandLogo(file, "agency-logos");
      setForm((f) => ({ ...f, logo_url: url, brand_color: f.brand_color || c || "" }));
    } catch (e) {
      toast.error((e as Error).message || "No se pudo subir el logo");
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    setError(null);
    if (!slugOk) { setError("La dirección debe tener entre 3 y 40 letras, números o guiones."); return; }
    if (form.brand_color && !HEX_RE.test(form.brand_color)) { setError("El color debe ser como #6E58F1."); return; }
    setSaving(true);
    const { status, body } = await callClients("set_agency", {
      agency_name: form.agency_name.trim(), logo_url: form.logo_url.trim(),
      brand_color: form.brand_color.trim().toUpperCase(), slug: form.slug.trim().toLowerCase(),
    }).catch((e) => ({ status: 0, body: { error: (e as Error).message } }));
    setSaving(false);
    if (status !== 200) { setError(body?.error || "No se pudo guardar tu marca."); return; }
    apply(body.agency || null);
    toast.success("Marca de agencia guardada");
  };

  const copy = async () => {
    try { await navigator.clipboard?.writeText(link); toast.success("Enlace copiado"); }
    catch { toast.error(`No se pudo copiar. Enlace: ${link}`); }
  };

  if (loading) {
    return <div className="h-[168px] animate-pulse rounded-[22px] border border-[#ECE9F6] bg-white/70 dark:border-border dark:bg-card/60" aria-label="Cargando tu marca" />;
  }
  if (!agency) return null;

  return (
    <section aria-labelledby="marca-agencia" className="relative overflow-hidden rounded-[22px] border border-[#E8E4F7] bg-white p-5 shadow-[0_18px_44px_-28px_rgba(46,30,140,.35)] dark:border-border dark:bg-card sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-60 blur-3xl" style={{ background: `radial-gradient(circle, ${color}33, transparent 70%)` }} />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#EFEBFF] to-[#E3F2FF] text-[#6E58F1] dark:from-primary/20 dark:to-primary/5">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="marca-agencia" className="font-display text-[17px] font-semibold tracking-[-0.02em] text-foreground">Tu marca de agencia</h2>
              <p className="text-[13px] text-muted-foreground">Lo que ven tus clientes al entrar por su enlace. Dentro, cada uno verá su propio logo y su color.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label={form.logo_url ? "Cambiar el logo de la agencia" : "Subir el logo de la agencia"}
              className="group relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-[#DCD6F2] bg-[#FBFAFF] transition-colors hover:border-[#6E58F1] dark:border-border dark:bg-background">
              {uploading ? <Loader2 className="h-5 w-5 animate-spin text-[#6E58F1]" />
                : form.logo_url ? <img src={form.logo_url} alt="Logo de la agencia" className="h-full w-full object-contain p-2" />
                : <ImagePlus className="h-6 w-6 text-[#9A93BD] group-hover:text-[#6E58F1]" />}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" aria-label="Archivo del logo de la agencia" onChange={(e) => void pickLogo(e.target.files?.[0])} />
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <label htmlFor="agencia-nombre" className="text-[12.5px] font-medium text-muted-foreground">Nombre de tu agencia</label>
              <Input id="agencia-nombre" value={form.agency_name} maxLength={80} placeholder="Tu agencia"
                onChange={(e) => setForm({ ...form, agency_name: e.target.value })} className="h-10 rounded-xl" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color de la agencia">
            {BRAND_SWATCHES.map((c) => {
              const on = form.brand_color.toUpperCase() === c;
              return (
                <button key={c} type="button" role="radio" aria-checked={on} aria-label={`Color ${c}`} onClick={() => setForm({ ...form, brand_color: c })}
                  className={cn("h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-110", on && "ring-2 ring-offset-2 ring-offset-background")}
                  style={{ background: c, ...(on ? { boxShadow: `0 0 0 2px ${c}` } : {}) }} />
              );
            })}
            <input type="color" aria-label="Otro color de la agencia" value={color} onChange={(e) => setForm({ ...form, brand_color: e.target.value.toUpperCase() })}
              className="ml-1 h-7 w-9 cursor-pointer rounded-md border border-border bg-background" />
            {form.logo_url && (
              <button type="button" className="ml-1 inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                onClick={async () => { const hex = await extractLogoColor(form.logo_url).catch(() => null); if (hex) setForm((f) => ({ ...f, brand_color: hex })); else toast.error("No pudimos sacar el color del logo."); }}>
                <Palette className="h-3.5 w-3.5" /> Del logo
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="agencia-slug" className="text-[12.5px] font-medium text-muted-foreground">Enlace de acceso de tus clientes</label>
            <div className="flex flex-wrap items-center gap-2">
              <div className={cn("flex h-10 min-w-0 flex-1 items-center rounded-xl border bg-[#FBFAFF] pl-3 text-[13px] dark:bg-background", slugOk ? "border-[#E2DEEF] dark:border-border" : "border-destructive")}>
                <Link2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="hidden shrink-0 text-muted-foreground sm:inline">{window.location.host}/acceso/</span>
                <input id="agencia-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) || e.target.value.toLowerCase() })}
                  className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] text-foreground outline-none" aria-invalid={!slugOk} />
              </div>
              <button type="button" onClick={copy} disabled={dirty} title={dirty ? "Guarda primero los cambios" : undefined}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E2DEEF] bg-white px-3 text-[13px] font-semibold text-foreground hover:bg-[#F6F4FD] disabled:opacity-50 dark:border-border dark:bg-card">
                <Copy className="h-3.5 w-3.5" /> Copiar
              </button>
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold text-[#6E58F1] hover:underline dark:text-primary">
                Ver <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {error && <p className="text-[13px] font-semibold text-destructive" role="alert">{error}</p>}
          <button type="button" onClick={save} disabled={!dirty || saving || uploading}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B5CF6] to-[#8B3CF5] px-4 text-[13.5px] font-semibold text-white shadow-[0_10px_22px_-10px_rgba(106,76,255,.7)] transition hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar marca
          </button>
        </div>

        {/* Vista previa de la entrada de tus clientes */}
        <div aria-hidden="true" className="hidden rounded-2xl border border-[#ECE9F6] p-4 lg:block" style={{ background: `radial-gradient(70% 60% at 20% 10%, ${color}22, transparent 70%), #F8F7FC` }}>
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#8A84AE]">Así lo verán tus clientes</p>
          <div className="overflow-hidden rounded-xl bg-white shadow-[0_14px_30px_-18px_rgba(30,20,90,.45)]">
            <div className="h-1" style={{ background: color }} />
            <div className="flex flex-col items-center px-4 pb-4 pt-5 text-center">
              {form.logo_url
                ? <span className="flex h-10 items-center justify-center rounded-lg border border-[#EEEBF7] bg-white px-2"><img src={form.logo_url} alt="" className="max-h-7 max-w-[130px] object-contain" /></span>
                : <span className="flex h-10 w-10 items-center justify-center rounded-lg text-[16px] font-bold text-white" style={{ background: color }}>{(form.agency_name.trim() || "A").charAt(0).toUpperCase()}</span>}
              <p className="mt-2 text-[9.5px] font-semibold uppercase tracking-[0.12em]" style={{ color }}>Acceso de clientes</p>
              <p className="mt-0.5 font-display text-[13px] font-semibold text-[#0F172B]">Entra en tu panel de {form.agency_name.trim() || "tu agencia"}</p>
              <span className="mt-3 block h-6 w-full rounded-md border border-[#ECE9F6]" />
              <span className="mt-1.5 block h-6 w-full rounded-md border border-[#ECE9F6]" />
              <span className="mt-2.5 block h-7 w-full rounded-md" style={{ background: color }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
