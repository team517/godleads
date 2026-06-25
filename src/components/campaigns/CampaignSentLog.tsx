import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Mail, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, Reply } from "lucide-react";
import { format } from "date-fns";
import DOMPurify from "dompurify";
import { es } from "date-fns/locale";

interface Props {
  campaignId: string;
}

interface SentEmail {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  sent_at: string | null;
  replied_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
  error_message: string | null;
  campaign_step_id: string | null;
  lead_id: string | null;
  account_id: string | null;
  transport: string | null;
  account_email?: string;
}

interface StepInfo {
  id: string;
  step_order: number;
  subject: string;
  delay_days: number;
}

type SentEmailQueryResult = Promise<{ data: SentEmail[] | null; error: { message: string } | null }>;
type SentEmailQueryBuilder = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      order: (column: string, options: { ascending: boolean; nullsFirst: boolean }) => SentEmailQueryResult;
    };
  };
};

export default function CampaignSentLog({ campaignId }: Props) {
  const [emails, setEmails] = useState<SentEmail[]>([]);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const baseEmailSelect = "id, to_email, subject, body, status, sent_at, replied_at, opened_at, bounced_at, error_message, campaign_step_id, lead_id, account_id";
      const emailsQuery = (select: string) => supabase
        .from("sent_emails")
        .select(select)
        .eq("campaign_id", campaignId)
        .order("sent_at", { ascending: false, nullsFirst: false });

      const [emailsResWithTransport, stepsRes, accountsRes] = await Promise.all([
        (supabase.from("sent_emails") as unknown as SentEmailQueryBuilder)
          .select(`${baseEmailSelect}, transport`)
          .eq("campaign_id", campaignId)
          .order("sent_at", { ascending: false, nullsFirst: false }),
        supabase
          .from("campaign_steps")
          .select("id, step_order, subject, delay_days")
          .eq("campaign_id", campaignId)
          .order("step_order"),
        supabase
          .from("email_accounts")
          .select("id, email"),
      ]);
      const emailsRes = emailsResWithTransport.error ? await emailsQuery(baseEmailSelect) : emailsResWithTransport;
      const accountMap = new Map((accountsRes.data || []).map(a => [a.id, a.email]));
      const enriched = ((emailsRes.data || []) as SentEmail[]).map(e => ({
        ...e,
        account_email: e.account_id ? accountMap.get(e.account_id) || undefined : undefined,
      }));
      setEmails(enriched);
      setSteps(stepsRes.data || []);
      setLoading(false);
    };
    load();
  }, [campaignId]);

  const getStepForEmail = (stepId: string | null) =>
    steps.find((s) => s.id === stepId);

  const getNextStep = (currentStepId: string | null) => {
    const current = getStepForEmail(currentStepId);
    if (!current) return null;
    return steps.find((s) => s.step_order === current.step_order + 1) || null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-medium mb-1">Sin emails enviados</h3>
          <p className="text-sm text-muted-foreground">
            Aún no se han enviado emails en esta campaña.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground mb-3">
        {emails.length} email{emails.length !== 1 ? "s" : ""} enviado{emails.length !== 1 ? "s" : ""}
      </p>

      {emails.map((email) => {
        const step = getStepForEmail(email.campaign_step_id);
        const nextStep = getNextStep(email.campaign_step_id);
        const isExpanded = expandedId === email.id;

        return (
          <Card
            key={email.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setExpandedId(isExpanded ? null : email.id)}
          >
            <CardContent className="p-4">
              {/* Header row */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Status icon */}
                {email.replied_at ? (
                  <Reply className="h-4 w-4 text-primary shrink-0" />
                ) : email.status === "sent" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : email.status === "failed" ? (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                )}

                {/* To email */}
                <span className="font-medium text-sm truncate max-w-[200px]">
                  {email.to_email}
                </span>

                {/* Step badge */}
                {step && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    Step {step.step_order}
                  </Badge>
                )}

                {/* Transport badge (SMTP / Instantly) */}
                {email.transport === "instantly" ? (
                  <Badge className="text-xs shrink-0 bg-purple-100 text-purple-700 hover:bg-purple-100 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800">
                    Instantly
                  </Badge>
                ) : (email.status === "sent" || email.status === "failed" || email.status === "bounced") ? (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    SMTP
                  </Badge>
                ) : null}

                {/* Reply badge */}
                {email.replied_at && (
                  <Badge className="text-xs shrink-0">
                    Respondido
                  </Badge>
                )}

                {email.status === "failed" && (
                  <Badge variant="destructive" className="text-xs shrink-0 max-w-[300px] truncate" title={email.error_message || undefined}>
                    Fallido{email.error_message
                      ? `: ${email.error_message.length > 50 ? email.error_message.slice(0, 50) + "…" : email.error_message}`
                      : ""}
                  </Badge>
                )}

                {/* Sent time */}
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {email.sent_at
                    ? format(new Date(email.sent_at), "dd MMM yyyy, HH:mm", { locale: es })
                    : "Pendiente"}
                </span>

                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </div>

              {/* Next step info */}
              {nextStep && !email.replied_at && email.status === "sent" && (
                <p className="text-xs text-muted-foreground mt-1.5 ml-7">
                  Próximo email (Step {nextStep.step_order}) en {nextStep.delay_days} día{nextStep.delay_days !== 1 ? "s" : ""}
                </p>
              )}

              {/* Expanded content */}
              {isExpanded && (
                <div className="mt-4 ml-7 space-y-3 border-t pt-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Asunto</p>
                    <p className="text-sm">{email.subject}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Mensaje</p>
                    <div
                      className="text-sm bg-muted/50 rounded-lg p-3 prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.body) }}
                    />
                  </div>

                  {email.error_message && (
                    <div>
                      <p className="text-xs font-medium text-destructive mb-1">Error</p>
                      <p className="text-sm text-destructive">{email.error_message}</p>
                    </div>
                  )}

                  {email.account_email && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Enviado desde</p>
                      <p className="text-sm">{email.account_email}</p>
                    </div>
                  )}

                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {email.sent_at && (
                      <span>Enviado: {format(new Date(email.sent_at), "dd/MM/yyyy HH:mm")}</span>
                    )}
                    {email.replied_at && (
                      <span className="text-primary font-medium">
                        Respondido: {format(new Date(email.replied_at), "dd/MM/yyyy HH:mm")}
                      </span>
                    )}
                    {email.bounced_at && (
                      <span className="text-destructive">
                        Rebotado: {format(new Date(email.bounced_at), "dd/MM/yyyy HH:mm")}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
