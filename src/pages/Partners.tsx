import { Handshake, CheckCircle, DollarSign, Users, Megaphone, Gift, ArrowRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BENEFITS = [
  {
    icon: DollarSign,
    title: "Comisiones recurrentes del 30%",
    description: "Gana un 30% de comisión recurrente por cada cliente que traigas mientras mantenga su suscripción activa.",
  },
  {
    icon: Users,
    title: "Panel de partners exclusivo",
    description: "Accede a métricas en tiempo real de tus referidos, ingresos generados y pagos pendientes.",
  },
  {
    icon: Megaphone,
    title: "Materiales de marketing",
    description: "Recibe banners, landing pages, copys y recursos listos para promocionar GodLeads en tus canales.",
  },
  {
    icon: Gift,
    title: "Descuentos exclusivos para tus referidos",
    description: "Ofrece hasta un 20% de descuento a tus referidos para facilitar la conversión.",
  },
  {
    icon: Star,
    title: "Soporte prioritario",
    description: "Línea directa con nuestro equipo para resolver dudas y optimizar tus resultados como partner.",
  },
  {
    icon: Handshake,
    title: "Co-branding y colaboraciones",
    description: "Posibilidad de crear contenido conjunto, webinars y casos de éxito con la marca GodLeads.",
  },
];

const TIERS = [
  { name: "Silver", referrals: "1-10 clientes", commission: "30%", color: "text-muted-foreground" },
  { name: "Gold", referrals: "11-50 clientes", commission: "35%", color: "text-warning" },
  { name: "Platinum", referrals: "50+ clientes", commission: "40%", color: "text-primary" },
];

export default function Partners() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleApply = async () => {
    if (!name.trim()) { toast.error("Introduce tu nombre"); return; }
    setSubmitting(true);
    try {
      // Send application via email using send-email function
      const { data: accounts } = await supabase
        .from("email_accounts")
        .select("id")
        .eq("user_id", user?.id || "")
        .eq("status", "connected")
        .limit(1);

      // Store as community message for now (simple approach)
      await supabase.from("community_messages").insert({
        user_id: user?.id || "",
        user_name: name,
        content: `🤝 SOLICITUD PARTNER\n\nNombre: ${name}\nWeb: ${website || "N/A"}\nEmail: ${user?.email}\n\nMensaje:\n${message || "Sin mensaje adicional"}`,
        message_type: "text",
      });

      setSubmitted(true);
      toast.success("¡Solicitud enviada! Te contactaremos pronto.");
    } catch (e: any) {
      toast.error("Error al enviar la solicitud");
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto py-6 px-4">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium">
          <Handshake className="h-4 w-4" />
          Programa de Partners
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">
          ¿Quieres ser Partner de GodLeads?
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Únete a nuestro programa de partners y gana comisiones recurrentes recomendando 
          la plataforma de cold email más potente del mercado.
        </p>
      </div>

      {/* Benefits grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {BENEFITS.map((b) => (
          <Card key={b.title} className="border bg-card hover:shadow-md transition-shadow">
            <CardContent className="p-5 space-y-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <b.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">{b.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{b.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tiers */}
      <div className="space-y-4">
        <h2 className="text-xl font-display font-bold text-foreground text-center">Niveles de Partner</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TIERS.map((t) => (
            <Card key={t.name} className="border text-center">
              <CardContent className="p-5 space-y-2">
                <h3 className={`text-lg font-bold ${t.color}`}>{t.name}</h3>
                <p className="text-sm text-muted-foreground">{t.referrals}</p>
                <p className="text-2xl font-bold text-foreground">{t.commission}</p>
                <p className="text-xs text-muted-foreground">comisión recurrente</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Application form */}
      {submitted ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-8 text-center space-y-3">
            <CheckCircle className="h-12 w-12 text-primary mx-auto" />
            <h3 className="text-lg font-bold text-foreground">¡Solicitud enviada!</h3>
            <p className="text-sm text-muted-foreground">
              Revisaremos tu solicitud y te contactaremos en las próximas 48 horas a <span className="font-medium text-foreground">{user?.email}</span>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <ArrowRight className="h-5 w-5 text-primary" />
              Solicita ser Partner
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Nombre completo *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sitio web / LinkedIn</Label>
                <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">¿Por qué quieres ser partner?</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Cuéntanos sobre tu audiencia, canales de promoción, experiencia..."
                rows={3}
              />
            </div>
            <Button onClick={handleApply} disabled={submitting} className="w-full gap-2">
              {submitting ? "Enviando..." : "Enviar solicitud de partner"}
              <Handshake className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
