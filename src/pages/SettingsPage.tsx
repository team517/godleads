import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { useSubscription, PLAN_CONFIG, FREE_LIMITS, TRIAL_LIMITS, PlanTier } from "@/contexts/SubscriptionContext";
import { toast } from "sonner";
import { Check, Crown, Zap, Loader2, ExternalLink, XCircle, Camera, Shield } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  getSessionDuration,
  setSessionDuration,
  isSessionKept,
  activateKeepSession,
  clearKeepSession,
  getSessionExpiresAt,
  DURATION_LABELS,
  type SessionDuration,
} from "@/components/KeepSessionBanner";
import { useSearchParams } from "react-router-dom";
import { EmailDomainHealthCard } from "@/components/settings/EmailDomainHealthCard";

const planCards: { tier: PlanTier; features: string[] }[] = [
  { tier: "starter", features: ["1,000 leads", "3 cuentas de email", "Campañas ilimitadas", "Follow-ups automáticos", "Soporte por email"] },
  { tier: "growth", features: ["10,000 leads", "15 cuentas de email", "A/B Testing", "Unibox centralizado", "Analytics avanzados", "Soporte prioritario"] },
  { tier: "scale", features: ["Leads ilimitados", "Cuentas ilimitadas", "API completa", "White label", "Account manager dedicado", "SLA garantizado"] },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const { updateProfile: updateGlobalProfile, refreshProfile } = useProfile();
  const { tier, subscribed, subscriptionEnd, loading: subLoading, refreshSubscription, isTrialing, trialEnd, trialDaysLeft } = useSubscription();
  const [profile, setProfile] = useState({ full_name: "", company_name: "", contact_email: "", avatar_url: "" });
  const [loading, setLoading] = useState(true);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("checkout") === "success") {
      toast.success("¡Suscripción activada! Puede tardar unos segundos en reflejarse.");
      refreshSubscription();
    }
    // Credit coins if returning from coin purchase
    if (searchParams.get("coins_purchased")) {
      supabase.functions.invoke("credit-coins").then(({ data }) => {
        if (data?.credited) {
          toast.success(`¡${data.coins_added} monedas añadidas! Saldo: ${data.new_balance}`);
          refreshProfile();
        }
      });
    }
  }, [searchParams, refreshSubscription, refreshProfile]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
      if (data) setProfile({ full_name: data.full_name || "", company_name: data.company_name || "", contact_email: data.contact_email || "", avatar_url: (data as any).avatar_url || "" });
      setLoading(false);
    };
    load();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({
      full_name: profile.full_name,
      company_name: profile.company_name,
      contact_email: profile.contact_email,
      avatar_url: profile.avatar_url || null,
    } as any).eq("user_id", user.id);
    if (error) { toast.error(error.message); return; }
    updateGlobalProfile({ full_name: profile.full_name, avatar_url: profile.avatar_url || null });
    toast.success("Perfil actualizado");
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setAvatarUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `avatars/${user.id}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("godtube-media").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("godtube-media").getPublicUrl(path);
      const avatar_url = urlData.publicUrl + `?t=${Date.now()}`;
      await supabase.from("profiles").update({ avatar_url } as any).eq("user_id", user.id);
      setProfile(prev => ({ ...prev, avatar_url }));
      updateGlobalProfile({ avatar_url });
      toast.success("Avatar actualizado");
    } catch (err: any) {
      toast.error(err.message || "Error al subir avatar");
    }
    setAvatarUploading(false);
  };

  const handleCancel = async () => {
    setCancelLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (e: any) {
      toast.error(e.message || "Error al abrir portal de cancelación");
    }
    setCancelLoading(false);
  };

  const handleCheckout = async (priceId: string, planTier: string) => {
    setCheckoutLoading(planTier);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { price_id: priceId },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (e: any) {
      toast.error(e.message || "Error al crear checkout");
    }
    setCheckoutLoading(null);
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (e: any) {
      toast.error(e.message || "Error al abrir portal");
    }
    setPortalLoading(false);
  };

  const KeepSessionCard = () => {
    const [keepEnabled, setKeepEnabled] = useState(isSessionKept());
    const [duration, setDuration] = useState<SessionDuration>(getSessionDuration());
    const [expiresAt, setExpiresAt] = useState<number | null>(getSessionExpiresAt());

    const refreshState = () => {
      setKeepEnabled(isSessionKept());
      setExpiresAt(getSessionExpiresAt());
    };

    const handleToggle = (checked: boolean) => {
      if (checked) {
        activateKeepSession();
        toast.success("Sesión mantenida activada");
      } else {
        clearKeepSession();
        toast.info("Sesión mantenida desactivada");
      }
      refreshState();
    };

    const handleDurationChange = (v: string) => {
      const newDur = v as SessionDuration;
      setDuration(newDur);
      setSessionDuration(newDur);
      if (isSessionKept()) {
        activateKeepSession();
      }
      refreshState();
      toast.success(`Duración actualizada a ${DURATION_LABELS[newDur]}`);
    };

    const formatExpiry = (ts: number) => {
      return new Date(ts).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Mantener sesión iniciada
          </CardTitle>
          <CardDescription>Accede directamente sin volver a iniciar sesión durante el tiempo configurado</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Sesión activa</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {keepEnabled
                  ? expiresAt
                    ? `Activa hasta ${formatExpiry(expiresAt)}`
                    : "Tu sesión se mantendrá activa"
                  : "No estás manteniendo la sesión"}
              </p>
            </div>
            <Switch checked={keepEnabled} onCheckedChange={handleToggle} />
          </div>
          <div className="space-y-2 max-w-xs">
            <Label>Duración</Label>
            <Select value={duration} onValueChange={handleDurationChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DURATION_LABELS) as SessionDuration[]).map((key) => (
                  <SelectItem key={key} value={key}>{DURATION_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Elige cuánto tiempo quieres mantener la sesión sin volver a iniciar sesión</p>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Configuración</h1>
        <p className="text-sm text-muted-foreground">Gestiona tu perfil, plan y preferencias</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Perfil</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="sending">Envío</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-base">Información de la cuenta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Avatar section */}
              <div className="flex items-center gap-5">
                <div className="relative group">
                  <Avatar className="h-20 w-20 ring-2 ring-primary/20">
                    <AvatarImage src={profile.avatar_url || `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(user?.email || 'user')}&backgroundColor=b6e3f4`} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                      {(profile.full_name || user?.email || "U").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    {avatarUploading ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Camera className="h-5 w-5 text-white" />}
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={avatarUploading} />
                  </label>
                </div>
                <div>
                  <p className="font-semibold text-lg">{profile.full_name || "Sin nombre"}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                  <p className="text-xs text-muted-foreground mt-1">Elige un avatar o sube tu propia foto</p>
                </div>
              </div>

              {/* Avatar picker grid */}
              <div className="space-y-2">
                <Label>Elige tu avatar</Label>
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
                  {[
                    { seed: "Aneka", bg: "b6e3f4" },
                    { seed: "Felix", bg: "d1f4a5" },
                    { seed: "Luna", bg: "ffd5dc" },
                    { seed: "Milo", bg: "ffdfbf" },
                    { seed: "Zoe", bg: "c0aede" },
                    { seed: "Leo", bg: "b6e3f4" },
                    { seed: "Nala", bg: "ffd5dc" },
                    { seed: "Max", bg: "d1f4a5" },
                    { seed: "Coco", bg: "ffdfbf" },
                    { seed: "Ruby", bg: "c0aede" },
                    { seed: "Kira", bg: "b6e3f4" },
                    { seed: "Sam", bg: "d1f4a5" },
                    { seed: "Pip", bg: "ffd5dc" },
                    { seed: "Jazz", bg: "ffdfbf" },
                    { seed: "Sky", bg: "c0aede" },
                    { seed: "Boo", bg: "b6e3f4" },
                    { seed: "Daisy", bg: "d1f4a5" },
                    { seed: "Bear", bg: "ffd5dc" },
                    { seed: "Sunny", bg: "ffdfbf" },
                    { seed: "Star", bg: "c0aede" },
                  ].map(({ seed, bg }) => {
                    const url = `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${seed}&backgroundColor=${bg}`;
                    const isSelected = profile.avatar_url === url;
                    return (
                      <button
                        key={seed}
                        type="button"
                        onClick={async () => {
                          setProfile(prev => ({ ...prev, avatar_url: url }));
                          await supabase.from("profiles").update({ avatar_url: url } as any).eq("user_id", user!.id);
                          updateGlobalProfile({ avatar_url: url });
                          toast.success("Avatar actualizado");
                        }}
                        className={`rounded-full p-0.5 transition-all hover:scale-110 ${isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:ring-2 hover:ring-muted-foreground/30"}`}
                      >
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={url} />
                        </Avatar>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nombre completo</Label>
                  <Input value={profile.full_name} onChange={e => setProfile({...profile, full_name: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Nombre de la empresa</Label>
                  <Input value={profile.company_name} onChange={e => setProfile({...profile, company_name: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Email de contacto</Label>
                  <Input type="email" value={profile.contact_email} onChange={e => setProfile({...profile, contact_email: e.target.value})} />
                </div>
              </div>
              <Button onClick={handleSave}>Guardar cambios</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plan" className="space-y-6 mt-4">
          {/* Current plan banner */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-4">
              <div className="flex items-center gap-3">
                <Crown className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold">
                    Plan actual: <span className="text-primary capitalize">{tier === "free" ? "Gratuito" : PLAN_CONFIG[tier as keyof typeof PLAN_CONFIG]?.label}</span>
                    {isTrialing && <Badge variant="secondary" className="ml-2 text-xs">Prueba gratuita</Badge>}
                  </p>
                  {isTrialing && trialDaysLeft !== null && (
                    <p className="text-xs text-muted-foreground">Prueba gratuita - {trialDaysLeft} días restantes</p>
                  )}
                  {!isTrialing && subscriptionEnd && <p className="text-xs text-muted-foreground">Válido hasta {new Date(subscriptionEnd).toLocaleDateString("es")}</p>}
                </div>
              </div>
              {subscribed && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handlePortal} disabled={portalLoading} className="gap-2">
                    {portalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    Gestionar suscripción
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleCancel} disabled={cancelLoading} className="gap-2">
                    {cancelLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    Cancelar plan
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => setBillingPeriod("monthly")} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${billingPeriod === "monthly" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>Mensual</button>
            <button onClick={() => setBillingPeriod("annual")} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${billingPeriod === "annual" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              Anual <span className="text-xs opacity-80">(-17%)</span>
            </button>
          </div>

          {/* Plan cards */}
          <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-3">
            {planCards.map(({ tier: planTier, features }) => {
              const config = PLAN_CONFIG[planTier as keyof typeof PLAN_CONFIG];
              const isCurrentPlan = tier === planTier;
              const price = billingPeriod === "monthly" ? config.monthly.price : config.annual.price;
              const priceId = billingPeriod === "monthly" ? config.monthly.priceId : config.annual.priceId;
              const popular = planTier === "growth";

              return (
                <Card key={planTier} className={`relative ${isCurrentPlan ? "border-primary ring-2 ring-primary/20" : popular ? "border-primary/40" : ""}`}>
                  {isCurrentPlan && <Badge className="absolute -top-2.5 left-4 bg-primary">Tu plan</Badge>}
                  {popular && !isCurrentPlan && <Badge className="absolute -top-2.5 left-4" variant="secondary">Popular</Badge>}
                  <CardHeader>
                    <CardTitle className="font-display">{config.label}</CardTitle>
                    <CardDescription>
                      <span className="text-3xl font-bold text-foreground">€{price}</span>
                      <span className="text-muted-foreground">/{billingPeriod === "monthly" ? "mes" : "año"}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {features.map(f => (
                        <li key={f} className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {isCurrentPlan ? (
                      <Button variant="outline" className="w-full" disabled>Plan actual</Button>
                    ) : (
                      <Button className="w-full gap-2" onClick={() => handleCheckout(priceId, planTier)} disabled={checkoutLoading === planTier}>
                        {checkoutLoading === planTier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                        {checkoutLoading === planTier ? "Redirigiendo…" : "Elegir plan"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="sending" className="space-y-4 mt-4">
          <EmailDomainHealthCard initialDomain={profile.contact_email.split("@")[1] || ""} />

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-base">Configuración de envío global</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Delay entre emails</Label>
                  <Input disabled value="6-8 min (aleatorio)" />
                  <p className="text-xs text-muted-foreground">Delay aleatorio entre 6-8 minutos para evitar spam</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Los límites diarios y horarios de envío se configuran por cuenta y por campaña.</p>
            </CardContent>
          </Card>

          <KeepSessionCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
