import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, MailCheck, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";

type CheckStatus = "pass" | "warn" | "fail";

type CheckItem = {
  status: CheckStatus;
  summary: string;
  suggestions: string[];
  records?: string[];
  selectorsTested?: string[];
  passingSelectors?: string[];
};

type DomainAuthResult = {
  domain: string;
  checkedAt: string;
  overallStatus: CheckStatus;
  spf: CheckItem;
  dkim: CheckItem;
  dmarc: CheckItem;
};

const statusMeta: Record<CheckStatus, { label: string; badgeClass: string; icon: typeof ShieldQuestion }> = {
  pass: { label: "OK", badgeClass: "bg-primary/15 text-primary border-primary/30", icon: ShieldCheck },
  warn: { label: "Revisar", badgeClass: "bg-accent text-accent-foreground border-border", icon: ShieldQuestion },
  fail: { label: "Fallo", badgeClass: "bg-destructive/10 text-destructive border-destructive/30", icon: ShieldAlert },
};

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function formatSelectorList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .join(", ");
}

function CheckCard({ title, item }: { title: string; item: CheckItem }) {
  const meta = statusMeta[item.status];
  const Icon = meta.icon;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-base">{title}</CardTitle>
            <CardDescription className="mt-1">{item.summary}</CardDescription>
          </div>
          <Badge variant="outline" className={meta.badgeClass}>
            <Icon className="mr-1 h-3.5 w-3.5" />
            {meta.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {item.selectorsTested && item.selectorsTested.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground">Selectors probados</p>
            <p className="text-xs text-muted-foreground">{item.selectorsTested.join(", ")}</p>
          </div>
        )}

        {item.passingSelectors && item.passingSelectors.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground">Selectors válidos</p>
            <p className="text-xs text-muted-foreground">{item.passingSelectors.join(", ")}</p>
          </div>
        )}

        {item.records && item.records.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Registros detectados</p>
            <div className="space-y-1">
              {item.records.map((record) => (
                <div key={record} className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground break-all">
                  {record}
                </div>
              ))}
            </div>
          </div>
        )}

        {item.suggestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Sugerencias</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {item.suggestions.map((suggestion) => (
                <li key={suggestion} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/70" />
                  <span>{suggestion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EmailDomainHealthCard({ initialDomain = "" }: { initialDomain?: string }) {
  const [domain, setDomain] = useState(initialDomain);
  const [selectors, setSelectors] = useState("google, selector1, selector2");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DomainAuthResult | null>(null);

  useEffect(() => {
    if (!domain && initialDomain) {
      setDomain(initialDomain);
    }
  }, [initialDomain, domain]);

  const overallMeta = useMemo(() => {
    if (!result) return null;
    return statusMeta[result.overallStatus];
  }, [result]);

  const handleCheck = async () => {
    const cleanDomain = normalizeDomain(domain);
    if (!cleanDomain) {
      toast.error("Introduce un dominio válido");
      return;
    }

    setLoading(true);
    try {
      const selectorList = formatSelectorList(selectors)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const { data, error } = await supabase.functions.invoke("check-email-domain-auth", {
        body: {
          domain: cleanDomain,
          selectors: selectorList,
        },
      });

      if (error) throw error;
      setResult(data as DomainAuthResult);
      toast.success("Diagnóstico completado");
    } catch (error: any) {
      toast.error(error.message || "No se pudo comprobar el dominio");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base flex items-center gap-2">
          <MailCheck className="h-4 w-4 text-primary" />
          Estado SPF, DKIM y DMARC
        </CardTitle>
        <CardDescription>
          Comprueba la autenticación de tu dominio y recibe sugerencias accionables si algo falla.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="email-domain-check">Dominio</Label>
            <Input
              id="email-domain-check"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="ejemplo.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-domain-selectors">Selectors DKIM</Label>
            <Input
              id="email-domain-selectors"
              value={selectors}
              onChange={(e) => setSelectors(e.target.value)}
              placeholder="google, selector1, selector2"
            />
          </div>
          <Button onClick={handleCheck} disabled={loading} className="gap-2 md:min-w-36">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
            Verificar
          </Button>
        </div>

        <Alert>
          <AlertTitle>Consejo</AlertTitle>
          <AlertDescription>
            Si DKIM falla, añade aquí el selector real de tu proveedor. En Google y Microsoft suelen usarse selectors como <b>google</b>, <b>selector1</b> o <b>selector2</b>.
          </AlertDescription>
        </Alert>

        {result && overallMeta && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Diagnóstico del dominio {result.domain}</p>
                <p className="text-xs text-muted-foreground">
                  Última comprobación: {new Date(result.checkedAt).toLocaleString("es-ES")}
                </p>
              </div>
              <Badge variant="outline" className={overallMeta.badgeClass}>
                {overallMeta.label}
              </Badge>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <CheckCard title="SPF" item={result.spf} />
              <CheckCard title="DKIM" item={result.dkim} />
              <CheckCard title="DMARC" item={result.dmarc} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}