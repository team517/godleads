import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Mail,
  ScrollText,
  UserCheck,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { LOG_STATUS_LABELS } from "./types";

interface LogRow {
  id: string;
  to_email: string;
  subject: string;
  draft_subject: string | null;
  ai_response: string;
  status: string;
  mode: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  reviewed_at: string | null;
}

const STATUS_ORDER = ["draft", "sent", "discarded", "failed", "skipped"] as const;

function StatusBadge({ status }: { status: string }) {
  const label = LOG_STATUS_LABELS[status] || status;
  if (status === "sent")
    return <Badge variant="default" className="gap-1 text-[10.5px] font-semibold"><CheckCircle2 className="h-3 w-3" />{label}</Badge>;
  if (status === "failed")
    return <Badge variant="destructive" className="gap-1 text-[10.5px] font-semibold"><XCircle className="h-3 w-3" />{label}</Badge>;
  if (status === "draft")
    return <Badge variant="outline" className="gap-1 border-primary/40 text-[10.5px] font-semibold text-primary"><FileText className="h-3 w-3" />{label}</Badge>;
  return <Badge variant="secondary" className="text-[10.5px] font-semibold">{label}</Badge>;
}

export function ReplyAgentLog() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("auto_reply_log")
      .select("id, to_email, subject, draft_subject, ai_response, status, mode, error_message, created_at, sent_at, reviewed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error) setLogs((data || []) as unknown as LogRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  // El agente de prospección escribe en client_service_log (solo service-role).
  // Espejamos esas filas en segundo plano (idempotente) SIN bloquear el primer
  // pintado: la tabla sale al instante y se refresca sola cuando termina.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    supabase.functions
      .invoke("sync-auto-reply-log", {})
      .then(() => { if (alive) loadLogs(); })
      .catch(() => { /* no crítico */ });
    return () => { alive = false; };
  }, [user, loadLogs]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("reply-agent-log-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "auto_reply_log", filter: `user_id=eq.${user.id}` }, () => { loadLogs(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, loadLogs]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    logs.forEach((l) => { c[l.status] = (c[l.status] || 0) + 1; });
    return c;
  }, [logs]);

  const visible = useMemo(() => (filter ? logs.filter((l) => l.status === filter) : logs), [logs, filter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <ScrollText className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-display tracking-[-0.03em] mb-2 text-lg font-semibold">Sin actividad del agente</h3>
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Aquí verás cada respuesta que el agente redacte o envíe.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter(null)}
          className={cn(
            "rounded-md border px-3 py-1.5 text-[13px] font-semibold leading-none shadow-rest transition-colors",
            filter === null ? "border-transparent bg-primary text-primary-foreground shadow-btn" : "border-border bg-card text-muted-foreground hover:bg-muted/60",
          )}
        >
          Todas ({logs.length})
        </button>
        {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(filter === s ? null : s)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[13px] font-semibold leading-none shadow-rest transition-colors",
              filter === s ? "border-transparent bg-primary text-primary-foreground shadow-btn" : "border-border bg-card text-muted-foreground hover:bg-muted/60",
            )}
          >
            {LOG_STATUS_LABELS[s]} ({counts[s]})
          </button>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[150px]">Fecha</TableHead>
              <TableHead>Destinatario</TableHead>
              <TableHead>Asunto</TableHead>
              <TableHead className="w-[120px]">Modo</TableHead>
              <TableHead className="w-[120px] text-center">Estado</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((log) => (
              <Fragment key={log.id}>
                <TableRow
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {format(new Date(log.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{log.to_email}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-sm">
                    {log.draft_subject || log.subject || "(sin asunto)"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {log.mode === "auto"
                        ? <><Bot className="h-3 w-3" /> Automático</>
                        : <><UserCheck className="h-3 w-3" /> Borrador</>}
                    </span>
                  </TableCell>
                  <TableCell className="text-center"><StatusBadge status={log.status} /></TableCell>
                  <TableCell className="text-muted-foreground">
                    {expandedId === log.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </TableCell>
                </TableRow>
                {expandedId === log.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30 p-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Respuesta del agente:</p>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {log.ai_response || "(vacía)"}
                        </p>
                        {log.error_message && (
                          <div className="pt-1">
                            <p className="text-sm font-medium text-destructive">Error:</p>
                            <p className="text-sm text-destructive/80">{log.error_message}</p>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-muted-foreground">
                          {log.sent_at && <span>Enviada: {format(new Date(log.sent_at), "dd MMM yyyy HH:mm:ss", { locale: es })}</span>}
                          {log.reviewed_at && <span>Revisada: {format(new Date(log.reviewed_at), "dd MMM yyyy HH:mm:ss", { locale: es })}</span>}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export default ReplyAgentLog;
