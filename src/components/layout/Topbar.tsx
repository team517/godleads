import { AlertTriangle, Bell, BellOff, Clock, Menu, Volume2, Moon, Sun, Zap, Crown, Rocket, Coins, Smartphone, PanelLeftClose, PanelLeftOpen, Sparkles, ChevronDown, Settings, LogOut, LifeBuoy, Building2, Undo2, PlayCircle, Home, Layers, Mail, Bot, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Slider } from "@/components/ui/slider";
import { useSubscription, PLAN_CONFIG, clientsFeature, emailsFeature } from "@/contexts/SubscriptionContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { supabase } from "@/integrations/supabase/client";
import { useState, useCallback, useEffect } from "react";
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getPushState } from "@/lib/push-notifications";
import { usePlanUsageAlert } from "@/hooks/usePlanUsageAlert";
import { planAlertCopy } from "@/lib/plan-alerts";
import { clientLogoutPath } from "@/lib/client-access";
import { CoBrand } from "@/components/clients/CoBrand";
import { CLIENT_WELCOME_EVENT } from "@/components/clients/ClientWelcome";
import { useAgencyBrand } from "@/hooks/useAgencyBrand";
import { toast } from "sonner";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Wordmark } from "@/components/Wordmark";
import { SparkMark } from "@/components/SparkMark";
import { clearKeepSession } from "@/components/KeepSessionBanner";
import { prefetchRoute } from "@/lib/route-prefetch";
import { useTheme } from "@/hooks/use-theme";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import coinIcon from "@/assets/coin-icon.png";
import { AccountSwitcherDialog } from "@/components/AccountSwitcherDialog";
import { canUseAccountSwitcher, returnToOwnAccount, stateMatchesUser, useImpersonation } from "@/lib/impersonation";
import { canReplayTour, openTour } from "@/lib/tour";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Global notification volume state
let _notifVolume = parseFloat(localStorage.getItem("notif_volume") ?? "0.3");
let _notifEnabled = localStorage.getItem("notif_enabled") !== "false";

export function getNotificationVolume() {
  return _notifEnabled ? _notifVolume : 0;
}
export function isNotificationEnabled() {
  return _notifEnabled;
}

interface TopbarProps {
  onMenuToggle?: () => void;
  isMobile?: boolean;
  /** Menú lateral plegado (sólo escritorio): el botón de la barra lo abre y lo cierra. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Botón de icono sobre la barra oscura. */
// Barra clara y flotante (12-11-2026, diseño del dueño): botones redondos en tinta oscura.
const TOPBAR_ICON = "relative flex h-10 w-10 items-center justify-center rounded-full text-[#3b3f6b] transition-colors hover:bg-[#f3f1fd] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white";

/** Accesos rápidos de la barra (en pantallas anchas). Sólo salen los que la cuenta puede abrir. */
const TOP_NAV = [
  { to: "/dashboard", label: "Inicio", icon: Home },
  { to: "/campaigns", label: "Campañas", icon: Layers },
  { to: "/email-accounts", label: "Buzones", icon: Mail },
  { to: "/ai-prompts", label: "Agentes IA", icon: Bot },
  { to: "/stats", label: "Reportes", icon: BarChart3 },
] as const;

const PLANS = [
  {
    key: "starter" as const,
    icon: Zap,
    color: "text-primary",
    features: ["1,000 leads", "3 cuentas email", "Campañas ilimitadas"],
  },
  {
    key: "growth" as const,
    icon: Rocket,
    color: "text-info",
    features: ["10,000 leads", "15 cuentas email", "A/B Testing IA"],
  },
  {
    key: "scale" as const,
    icon: Crown,
    color: "text-warning",
    features: ["Leads ilimitados", "Cuentas ilimitadas", "Todo incluido"],
  },
];

const COIN_PACKS = [
  { coins: 100, price: "6,75€", priceId: "price_1TECiI2ObXNkJIex6PVwIe5z" },
  { coins: 500, price: "18,30€", priceId: "price_1TECjy2ObXNkJIex11ihCBWX" },
  { coins: 1000, price: "27,99€", priceId: "price_1TECo52ObXNkJIexehQMdRx4" },
];

export function Topbar({ onMenuToggle, isMobile, collapsed, onToggleCollapse }: TopbarProps) {
  const { isTrialing, trialDaysLeft, tier, subscribed, status: subStatus, isAdmin } = useSubscription();
  // Mini tutorial: suscriptores y equipo pueden volver a verlo (sin cambiar lo que contestaron).
  const tourReplay = canReplayTour(subStatus, subStatus === "staff" || isAdmin);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile: profileData } = useProfile();
  const { theme, toggleTheme } = useTheme();
  const [notifyEnabled, setNotifyEnabled] = useState(_notifEnabled);
  const [volume, setVolume] = useState(_notifVolume);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [coinLoading, setCoinLoading] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  // Cambio de cuenta (sólo hello@ y equipo@): "Clientes" en el menú del perfil.
  const impersonation = useImpersonation();
  const insideClient = stateMatchesUser(impersonation, user?.id) ? impersonation : null;
  const switcherEnabled = canUseAccountSwitcher(insideClient, user?.email);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // Check push status on mount. The permission alone lies: it stays "granted" after unsubscribing
  // and after the row was pruned, so we ask for the real subscription state.
  const refreshPushState = useCallback(async () => {
    setPushEnabled((await getPushState()) === "on");
  }, []);

  useEffect(() => {
    if (!isPushSupported() || !user) return;
    void refreshPushState();
  }, [user, refreshPushState]);

  const handlePushToggle = useCallback(async () => {
    if (!user) return;
    if (insideClient) {
      toast.info("Los avisos al dispositivo están desactivados mientras estás dentro de la cuenta de un cliente.");
      return;
    }
    setPushLoading(true);
    try {
      if (pushEnabled) {
        const ok = await unsubscribeFromPush(user.id);
        if (ok) toast.success("Notificaciones push desactivadas");
        else toast.error("No se pudieron desactivar las notificaciones. Inténtalo de nuevo.");
      } else {
        const success = await subscribeToPush(user.id);
        if (success) toast.success("¡Notificaciones push activadas!");
        else toast.error("No se pudieron activar las notificaciones. Revisa los permisos del navegador.");
      }
      // Re-read instead of assuming: the button must reflect what the browser really has.
      await refreshPushState();
    } catch {
      toast.error("Error al cambiar notificaciones push");
      await refreshPushState();
    }
    setPushLoading(false);
  }, [user, pushEnabled, refreshPushState, insideClient]);

  const handleToggle = useCallback(() => {
    const newVal = !notifyEnabled;
    setNotifyEnabled(newVal);
    _notifEnabled = newVal;
    localStorage.setItem("notif_enabled", String(newVal));
    toast.success(newVal ? "Notificaciones activadas" : "Notificaciones desactivadas");
  }, [notifyEnabled]);

  const handleVolumeChange = useCallback((val: number[]) => {
    const v = val[0];
    setVolume(v);
    _notifVolume = v;
    localStorage.setItem("notif_volume", String(v));
    const preview = new Audio("/notification.mp3");
    preview.volume = v;
    preview.play().catch(() => {});
  }, []);

  const handleCheckout = useCallback(async (priceId: string) => {
    setCheckoutLoading(priceId);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { price_id: priceId },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
      else toast.error("No se pudo generar el enlace de pago");
    } catch (e: any) {
      toast.error(e.message || "Error al iniciar el pago");
    }
    setCheckoutLoading(null);
  }, []);

  const handleCoinPurchase = useCallback(async (priceId: string) => {
    setCoinLoading(priceId);
    try {
      const { data, error } = await supabase.functions.invoke("purchase-coins", {
        body: { price_id: priceId },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
      else toast.error("No se pudo generar el enlace de pago");
    } catch (e: any) {
      toast.error(e.message || "Error al iniciar la compra");
    }
    setCoinLoading(null);
  }, []);

  const handleManage = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
      else toast.error("No se pudo abrir el portal");
    } catch (e: any) {
      toast.error(e.message || "Error");
    }
  }, []);

  const currentPlanLabel = tier === "free"
    ? (isTrialing ? "Trial" : "Free")
    : PLAN_CONFIG[tier as keyof typeof PLAN_CONFIG]?.label || tier;

  const coinDisplay = profileData.infiniteCoins ? "∞" : (profileData.coins > 999 ? "999+" : profileData.coins);

  const allowed = profileData.allowed_routes;
  const canSeeAI = !allowed || allowed.includes("/ai-prompts");
  // Cuenta de un cliente: su agencia paga y gestiona el plan → ni planes, ni monedas, ni tutorial.
  const clientLogin = !!profileData.client_login_of;
  // Marca doble: logo de la agencia × logo del cliente.
  const agencyBrand = useAgencyBrand();
  const planAlert = usePlanUsageAlert();
  const planAlertText = planAlert ? planAlertCopy(planAlert) : null;

  const handleSignOut = async () => {
    // Dentro de la cuenta de un cliente, "Cerrar sesión" primero devuelve al equipo a su cuenta
    // (nunca deja abierta la sesión del cliente) y no toca su preferencia de mantener la sesión.
    if (insideClient) { await returnToOwnAccount(); return; }
    clearKeepSession();
    // El cliente vuelve a la entrada de SU agencia, no a la web de Funnyleads.
    const back = clientLogin ? await clientLogoutPath() : "/";
    await signOut();
    navigate(back);
  };

  // Barra flotante clara (12-11-2026): una "píldora" blanca con sombra violeta, por encima del menú
  // lateral. Alto en --topbar-h (index.css); en iOS crece con el área segura.
  const topNav = TOP_NAV.filter((n) => !allowed || allowed.length === 0 || allowed.includes(n.to));
  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + "/");
  return (
    <header className="topbar-float fixed inset-x-0 top-0 z-50 h-[calc(var(--topbar-h)+env(safe-area-inset-top))] px-2 pb-1.5 pt-[calc(env(safe-area-inset-top)+8px)] text-[15px] font-medium md:px-4">
      <div className="topbar-pill relative flex h-full items-center justify-between gap-2 overflow-hidden rounded-[22px] border border-[#ebe8f8] bg-white/90 px-2 shadow-[0_14px_34px_-18px_rgba(110,88,241,.45),0_2px_6px_rgba(16,24,64,.04)] backdrop-blur-xl dark:border-border dark:bg-card/90 md:gap-3 md:px-3">
      <span className="topbar-wave pointer-events-none absolute inset-y-0 right-[18%] hidden w-[420px] lg:block" aria-hidden="true" />
      <div className="relative flex min-w-0 flex-1 items-center gap-1.5 md:gap-2.5">
        {isMobile ? (
          <button type="button" onClick={onMenuToggle} aria-label="Abrir menú" className={TOPBAR_ICON}>
            <Menu className="h-5 w-5" />
          </button>
        ) : (
          <button type="button" onClick={onToggleCollapse} aria-label={collapsed ? "Expandir menú" : "Plegar menú"} title={collapsed ? "Expandir menú" : "Plegar menú"} className={TOPBAR_ICON}>
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          </button>
        )}
        <Link to="/dashboard" className="flex shrink-0 items-center gap-2.5" aria-label="Ir al panel">
          {clientLogin ? (
            <CoBrand
              tone="dark"
              agency={agencyBrand}
              client={{ name: profileData.company_name || "Tu empresa", logo: profileData.logo_url, color: profileData.brand_color }}
            />
          ) : profileData.logo_url ? (
            <span className="flex h-8 items-center rounded-md bg-white px-2 shadow-rest">
              <img src={profileData.logo_url} alt={profileData.company_name || "Logo"} className="h-5 max-w-[120px] object-contain" />
            </span>
          ) : (
            <>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#ebe8f8] bg-white shadow-[0_2px_6px_rgba(110,88,241,.12)] dark:border-border dark:bg-background">
                <SparkMark size={24} variant="star" />
              </span>
              <Wordmark className="hidden h-[22px] sm:inline-block" colorClassName="text-[#0b1040] dark:text-white" />
            </>
          )}
        </Link>
        {!isMobile && topNav.length > 0 && (
          <>
            <span className="mx-1 hidden h-7 w-px shrink-0 bg-[#e6e3f3] dark:bg-border 2xl:block" aria-hidden="true" />
            <nav aria-label="Accesos rápidos" className="hidden shrink-0 items-center gap-0.5 2xl:flex">
              {topNav.map(({ to, label, icon: Icon }) => {
                const on = isActive(to);
                return (
                  <Link
                    key={to}
                    to={to}
                    onMouseEnter={() => prefetchRoute(to)}
                    aria-current={on ? "page" : undefined}
                    className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[14.5px] font-semibold transition-colors ${on ? "bg-primary/10 text-primary" : "text-[#1b1f45] hover:bg-[#f5f3ff] hover:text-primary dark:text-foreground/85 dark:hover:bg-white/5"}`}
                  >
                    <Icon className={`h-[18px] w-[18px] ${on ? "" : "text-[#4b4f86] dark:text-muted-foreground"}`} strokeWidth={1.9} />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </>
        )}
        {!isMobile && <span className="mx-1 hidden h-7 w-px shrink-0 bg-[#e6e3f3] dark:bg-border lg:block" aria-hidden="true" />}
        {!isMobile && <div className="hidden min-w-0 max-w-[400px] flex-1 lg:block"><GlobalSearch /></div>}
      </div>

      <div className="relative flex shrink-0 items-center gap-1 md:gap-1.5">
        {isTrialing && trialDaysLeft !== null && (
          <Badge
            variant="outline"
            className={`mr-1 gap-1.5 px-2 py-1 text-xs font-semibold md:px-3 md:text-[13px] ${
              trialDaysLeft < 1
                ? "border-red-300 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
                : "border-[#e3e0f5] bg-[#f6f4ff] text-[#4b3fc4] dark:border-white/15 dark:bg-white/10 dark:text-white/90"
            }`}
          >
            <Clock className="h-3 w-3 md:h-3.5 md:w-3.5" />
            {trialDaysLeft === 0 ? "Expira hoy" : `${trialDaysLeft}d`}
          </Badge>
        )}

        {canSeeAI && (
          <Link
            to="/ai-prompts"
            onMouseEnter={() => prefetchRoute("/ai-prompts")}
            className="topbar-ai mr-1 hidden h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold text-white shadow-[0_10px_22px_-10px_rgba(110,88,241,.8)] transition-all hover:-translate-y-px hover:brightness-110 active:translate-y-0 sm:inline-flex"
          >
            <Sparkles className="h-4 w-4" /> Pregunta a la IA
          </Link>
        )}

        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === "dark" ? "Modo claro" : "Modo noche"}
          aria-label={theme === "dark" ? "Modo claro" : "Modo noche"}
          className={TOPBAR_ICON}
        >
          {theme === "dark" ? <Sun className="h-[19px] w-[19px] text-amber-300" /> : <Moon className="h-[19px] w-[19px]" />}
        </button>

        {!clientLogin && (<>
        {/* Coin / Credits button */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={TOPBAR_ICON} title="Monedas">
              <Coins className="h-[19px] w-[19px]" aria-label="Monedas" />
              {(profileData.coins > 0 || profileData.infiniteCoins) && (
                <span className="absolute -top-0.5 -right-1 bg-warning text-warning-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {coinDisplay}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[calc(100vw-1.5rem)] max-w-80 p-0 sm:w-80" align="end">
            <div className="p-4 border-b">
              <div className="flex items-center gap-2 mb-1">
                <img src={coinIcon} alt="" className="h-5 w-5" />
                <h3 className="font-display text-[15px] font-semibold">Monedas</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Saldo: <span className="font-semibold text-foreground">{profileData.infiniteCoins ? "∞ (ilimitadas)" : `${profileData.coins} monedas`}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plan: <span className="font-semibold text-foreground">{currentPlanLabel}</span>
              </p>
            </div>

            {/* Coin packs */}
            <div className="p-3 space-y-2 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recargar monedas</p>
              {COIN_PACKS.map(pack => (
                <div key={pack.priceId} className="flex items-center justify-between rounded-lg border p-2.5 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-warning" />
                    <div>
                      <span className="text-sm font-semibold">{pack.coins} monedas</span>
                      <span className="text-xs text-muted-foreground ml-2">{pack.price}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={coinLoading === pack.priceId}
                    onClick={() => handleCoinPurchase(pack.priceId)}
                  >
                    {coinLoading === pack.priceId ? "..." : "Comprar"}
                  </Button>
                </div>
              ))}
            </div>

            {/* Plan section */}
            {subscribed ? (
              <div className="p-3 space-y-2">
                <Button onClick={handleManage} variant="outline" className="w-full text-sm">
                  Gestionar suscripción
                </Button>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Planes</p>
                {PLANS.map((plan) => {
                  const config = PLAN_CONFIG[plan.key];
                  return (
                    <div
                      key={plan.key}
                      className="rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <plan.icon className={`h-4 w-4 ${plan.color}`} />
                          <span className="text-sm font-semibold">{config.label}</span>
                        </div>
                        <span className="text-sm font-bold text-foreground">
                          {/* € como en Ajustes: es el mismo PLAN_CONFIG y los precios se cobran en euros. */}
                          €{config.monthly.price}/mes
                        </span>
                      </div>
                      <ul className="text-[11px] text-muted-foreground space-y-0.5 mb-2.5">
                        {/* Clientes incluidos: sale de PLAN_CONFIG, como los leads y las cuentas. */}
                        {[emailsFeature(plan.key), ...plan.features, clientsFeature(plan.key)].map((f) => (
                          <li key={f} className="flex items-center gap-1.5">
                            <span className="text-primary">✓</span> {f}
                          </li>
                        ))}
                      </ul>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-7 text-xs"
                          disabled={checkoutLoading === config.monthly.priceId}
                          onClick={() => handleCheckout(config.monthly.priceId)}
                        >
                          {checkoutLoading === config.monthly.priceId ? "Cargando..." : "Mensual"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-xs"
                          disabled={checkoutLoading === config.annual.priceId}
                          onClick={() => handleCheckout(config.annual.priceId)}
                        >
                          {checkoutLoading === config.annual.priceId ? "Cargando..." : `Anual (-${Math.round(100 - (config.annual.price / (config.monthly.price * 12)) * 100)}%)`}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>

        </>)}

        {/* Notifications */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={TOPBAR_ICON} aria-label="Notificaciones">
              {notifyEnabled ? (
                <Bell className="!h-[19px] !w-[19px]" />
              ) : (
                <BellOff className="!h-[19px] !w-[19px] text-[#9aa0c4] dark:text-white/55" />
              )}
              {planAlert ? (
                <span className="absolute right-1.5 top-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#F43F5E] px-1 text-[9.5px] font-bold text-white ring-2 ring-white dark:ring-card">1</span>
              ) : notifyEnabled && (
                <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-white dark:ring-card" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-4" align="end">
            <div className="space-y-4">
              {planAlert && planAlertText && (
                <Link to="/settings?tab=plan" className="block rounded-xl border border-[#F6D7A8] bg-[#FFF7EB] p-3 text-left transition-colors hover:bg-[#FFF1DC] dark:border-warning/40 dark:bg-warning/10">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#B45309] dark:text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" /> Aviso de tu plan
                  </span>
                  <span className="mt-1 block text-[13.5px] font-semibold text-foreground">{planAlertText.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{planAlertText.text}</span>
                  <span className="mt-1.5 inline-block text-[12.5px] font-semibold text-primary">Mejorar plan →</span>
                </Link>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Sonido</span>
                <Button
                  variant={notifyEnabled ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleToggle}
                >
                  {notifyEnabled ? "Activado" : "Desactivado"}
                </Button>
              </div>
              {notifyEnabled && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Slider
                      min={0}
                      max={1}
                      step={0.05}
                      value={[volume]}
                      onValueChange={handleVolumeChange}
                      className="flex-1"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground text-center">
                    Volumen: {Math.round(volume * 100)}%
                  </p>
                </div>
              )}

              {/* Push notifications */}
              {isPushSupported() && (
                <>
                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Push</span>
                    </div>
                    <Button
                      variant={pushEnabled ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handlePushToggle}
                      disabled={pushLoading}
                    >
                      {pushLoading ? "..." : pushEnabled ? "Activado" : "Activar"}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {pushEnabled
                      ? "Recibirás notificaciones aunque la app esté cerrada"
                      : "Activa para recibir alertas en tu dispositivo"}
                  </p>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Cuenta: avatar + desplegable, como en cualquier programa. */}
        <Popover open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Cuenta" className="ml-1 flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 transition-colors hover:bg-[#f3f1fd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:bg-white/10">
              <span className="rounded-full border border-[#ebe8f8] bg-white p-[2px] shadow-[0_2px_6px_rgba(16,24,64,.08)] dark:border-border dark:bg-card"><Avatar className="h-9 w-9">
                <AvatarImage src={profileData.avatar_url || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(user?.email || 'user')}&backgroundColor=b6e3f4`} />
                <AvatarFallback className="bg-primary/10 text-sm font-bold text-primary">
                  {(profileData.full_name || user?.email || "U").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar></span>
              <ChevronDown className="hidden h-4 w-4 text-[#4b4f86] dark:text-white/70 sm:block" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="end">
            <div className="border-b p-3.5">
              <p className="truncate text-[14px] font-semibold text-foreground">{profileData.full_name || "Sin nombre"}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">{user?.email}</p>
              {clientLogin
                ? (profileData.company_name && <span className="mt-2 inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">{profileData.company_name}</span>)
                : <span className="mt-2 inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">Plan {currentPlanLabel}</span>}
            </div>
            {insideClient && (
              <div className="border-b bg-primary/5 px-3.5 py-2.5">
                <p className="text-[12px] text-muted-foreground">Estás dentro de</p>
                <p className="truncate text-[13.5px] font-semibold text-foreground">{insideClient.target.company || insideClient.target.email}</p>
                <button type="button" onClick={() => { setAccountMenuOpen(false); void returnToOwnAccount(); }}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-card px-2.5 py-1.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/10">
                  <Undo2 className="h-3.5 w-3.5" /> Quitar y volver a mi cuenta
                </button>
              </div>
            )}
            <div className="p-1.5 text-[14px]">
              {switcherEnabled && (
                <button type="button" onClick={() => { setAccountMenuOpen(false); setSwitcherOpen(true); }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <Building2 className="h-4 w-4 text-muted-foreground" /> Clientes
                </button>
              )}
              <Link to="/settings" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground">
                <Settings className="h-4 w-4 text-muted-foreground" /> Configuración
              </Link>
              {clientLogin && (
                <button type="button" onClick={() => { setAccountMenuOpen(false); window.dispatchEvent(new Event(CLIENT_WELCOME_EVENT)); }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <PlayCircle className="h-4 w-4 text-muted-foreground" /> Ver la bienvenida
                </button>
              )}
              {tourReplay && !clientLogin && (
                <button type="button" onClick={() => { setAccountMenuOpen(false); openTour(); }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <PlayCircle className="h-4 w-4 text-muted-foreground" /> Ver el tutorial
                </button>
              )}
              {!clientLogin && (
                <a href="mailto:support@onepulso.online" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <LifeBuoy className="h-4 w-4 text-muted-foreground" /> Ayuda
                </a>
              )}
              <button type="button" onClick={handleSignOut} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                <LogOut className="h-4 w-4" /> {insideClient ? "Salir del cliente" : "Cerrar sesión"}
              </button>
            </div>
          </PopoverContent>
        </Popover>
        {switcherEnabled && <AccountSwitcherDialog open={switcherOpen} onOpenChange={setSwitcherOpen} current={insideClient} />}
      </div>
      </div>
    </header>
  );
}
