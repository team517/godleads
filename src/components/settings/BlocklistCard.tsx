import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseCSVToObjects } from "@/lib/csv-parser";
import { toast } from "sonner";
import { ShieldBan, Upload, Download, Loader2 } from "lucide-react";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

export function BlocklistCard() {
  const { user } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadCount = async () => {
    if (!user) return;
    const { count } = await supabase
      .from("blocklist")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    setCount(count || 0);
  };

  useEffect(() => { loadCount(); /* eslint-disable-next-line */ }, [user]);

  // ── Export: download the whole suppression list as CSV ──
  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const { data, error } = await supabase
        .from("blocklist")
        .select("entry_type, value, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) { toast.info("Tu lista de bloqueados está vacía"); setExporting(false); return; }

      const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      const header = "tipo,valor,fecha";
      const body = rows.map((r: any) =>
        [esc(r.entry_type || ""), esc(r.value || ""), esc((r.created_at || "").slice(0, 10))].join(",")
      ).join("\n");
      const csv = "﻿" + header + "\n" + body;

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bloqueados-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${rows.length} entradas descargadas`);
    } catch (e: any) {
      toast.error(`Error al exportar: ${e.message || e}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Import: add emails/domains from any CSV (no replace, dedup) ──
  const handleImport = async (file: File) => {
    if (!user) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseCSVToObjects(text);
      if ("error" in parsed) { toast.error(parsed.error || "CSV no válido"); setImporting(false); return; }
      const rows = parsed.rows;
      if (!rows.length) { toast.error("El CSV está vacío"); setImporting(false); return; }

      const headers = parsed.headers;
      const domainCols = headers.filter((h) => /domain|dominio/i.test(h));
      const emails = new Set<string>();
      const domains = new Set<string>();

      for (const row of rows) {
        for (const [k, raw] of Object.entries(row)) {
          const val = String(raw ?? "").trim().toLowerCase();
          if (!val) continue;
          if (val.includes("@")) {
            if (EMAIL_RE.test(val)) emails.add(val);
          } else if (domainCols.includes(k) && DOMAIN_RE.test(val)) {
            domains.add(val);
          }
        }
      }

      const entries = [
        ...[...emails].map((value) => ({ user_id: user.id, entry_type: "email", value })),
        ...[...domains].map((value) => ({ user_id: user.id, entry_type: "domain", value })),
      ];
      if (entries.length === 0) {
        toast.error("No se encontraron emails ni dominios válidos en el CSV");
        setImporting(false);
        return;
      }

      // Upsert in chunks (dedup handled by the unique constraint).
      for (let i = 0; i < entries.length; i += 500) {
        const chunk = entries.slice(i, i + 500);
        const { error } = await supabase
          .from("blocklist")
          .upsert(chunk, { onConflict: "user_id,entry_type,value", ignoreDuplicates: true });
        if (error) throw error;
      }

      toast.success(`${emails.size} emails y ${domains.size} dominios añadidos a la lista`);
      await loadCount();
    } catch (e: any) {
      toast.error(`Error al importar: ${e.message || e}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldBan className="h-5 w-5 text-destructive" />
          Lista de bloqueados (supresión)
        </CardTitle>
        <CardDescription className="leading-relaxed">
          Emails y/o dominios que <strong>NO</strong> deben recibir correos (RGPD / opt-out; p. ej. exportados de Instantly).
          El motor de envío nunca escribe a quien esté en esta lista.{" "}
          {count !== null && <>Ahora mismo tienes <strong>{count}</strong> {count === 1 ? "entrada" : "entradas"}.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar CSV
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting || count === 0}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Descargar CSV
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          La importación <strong>añade</strong> a tu lista (no la reemplaza) y se deduplica automáticamente.
          La descarga exporta todas tus entradas (tipo, valor y fecha) en un CSV.
        </p>
      </CardContent>
    </Card>
  );
}
