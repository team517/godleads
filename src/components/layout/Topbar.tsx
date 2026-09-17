import { Bell, BellOff, Clock, Menu, Volume2, Moon, Sun, Zap, Crown, Rocket, Coins, Smartphone, PanelLeftClose, PanelLeftOpen, Sparkles, ChevronDown, Settings, LogOut, LifeBuoy } from "lucide-react";
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
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { Wordmark } from "@/components/Wordmark";
import { clearKeepSession } from "@/components/KeepSessionBanner";
import { prefetchRoute } from "@/lib/route-prefetch";
import { useTheme } from "@/hooks/use-theme";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import coinIcon from "@/assets/coin-icon.png";
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
const TOPBAR_ICON = "relative flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";

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
  const { isTrialing, trialDaysLeft, tier, subscribed } = useSubscription();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { profile: profileData } = useProfile();
  const { theme, toggleTheme } = useTheme();
  const [notifyEnabled, setNotifyEnabled] = useState(_notifEnabled);
  const [volume, setVolume] = useState(_notifVolume);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [coinLoading, setCoinLoading] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

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
  }, [user, pushEnabled, refreshPushState]);

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

  const handleSignOut = async () => {
    clearKeepSession();
    await signOut();
    navigate("/");
  };

  // Barra de programa: el índigo oscuro del diseño, a todo el ancho y por encima del menú lateral.
  // h + pt: en iOS a pantalla completa la vista corre bajo la barra de estado, así que la
  // cabecera crece con el área segura (0 en el resto) y la pinta del mismo índigo.
  return (
    <header className="topbar-surface fixed inset-x-0 top-0 z-50 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-3 border-b border-white/10 px-3 pt-[env(safe-area-inset-top)] text-[15px] font-medium text-topbar-foreground shadow-[0_2px_10px_rgba(21,17,60,.18)] md:px-4">
      <span className="topbar-sheen" aria-hidden="true" />
      <div className="relative flex min-w-0 items-center gap-2 md:gap-3">
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
          {profileData.logo_url ? (
            <span className="flex h-8 items-center rounded-md bg-white px-2 shadow-rest">
              <img src={profileData.logo_url} alt={profileData.company_name || "Logo"} className="h-5 max-w-[120px] object-contain" />
            </span>
          ) : (
            <>
              <span className="block h-[26px] w-[26px] rounded-[7px] bg-[linear-gradient(135deg,#8B6BFF_0%,#3B89E9_100%)] shadow-[0_2px_8px_rgba(139,107,255,.45),inset_0_1px_0_rgba(255,255,255,.35)]" />
              <Wordmark className="hidden h-[22px] sm:inline-block" colorClassName="text-white" />
            </>
          )}
        </Link>
        {!isMobile && <span className="mx-1 hidden h-5 w-px bg-white/15 lg:block" />}
        {!isMobile && <div className="hidden lg:block"><GlobalSearch /></div>}
      </div>

      <div className="relative flex items-center gap-1 md:gap-1.5">
        {isTrialing && trialDaysLeft !== null && (
          <Badge
            variant="outline"
            className={`mr-1 gap-1.5 px-2 py-1 text-xs font-semibold md:px-3 md:text-[13px] ${
              trialDaysLeft < 1
                ? "border-red-300/50 bg-red-500/20 text-red-100"
                : "border-white/20 bg-white/10 text-white/90"
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
            className="mr-1 hidden h-8 items-center gap-1.5 rounded-md bg-white px-3 text-[13px] font-semibold text-[#33298F] shadow-[0_2px_6px_rgba(21,17,60,.18)] transition-transform hover:-translate-y-px active:translate-y-0 sm:inline-flex"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#6E58F1]" /> Pregunta a la IA
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
          {theme === "dark" ? <Sun className="h-[18px] w-[18px] text-amber-300" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        {/* Coin / Credits button */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={TOPBAR_ICON} title="Monedas">
              <img src={coinIcon} alt="Monedas" className="h-7 w-7" />
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

        {/* Notifications */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={TOPBAR_ICON} aria-label="Notificaciones">
              {notifyEnabled ? (
                <Bell className="!h-[18px] !w-[18px]" />
              ) : (
                <BellOff className="!h-[18px] !w-[18px] text-white/55" />
              )}
              {notifyEnabled && (
                <span className="live-dot absolute right-2 top-2 h-2 w-2 rounded-full bg-[#05D17F] ring-2 ring-[hsl(var(--topbar))]" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-4" align="end">
            <div className="space-y-4">
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
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Cuenta" className="ml-1 flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-1.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
              <Avatar className="h-8 w-8 ring-2 ring-white/25">
                <AvatarImage src={profileData.avatar_url || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(user?.email || 'user')}&backgroundColor=b6e3f4`} />
                <AvatarFallback className="bg-white/15 text-sm font-bold text-white">
                  {(profileData.full_name || user?.email || "U").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="hidden h-3.5 w-3.5 text-white/70 sm:block" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="end">
            <div className="border-b p-3.5">
              <p className="truncate text-[14px] font-semibold text-foreground">{profileData.full_name || "Sin nombre"}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">{user?.email}</p>
              <span className="mt-2 inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">Plan {currentPlanLabel}</span>
            </div>
            <div className="p-1.5 text-[14px]">
              <Link to="/settings" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground">
                <Settings className="h-4 w-4 text-muted-foreground" /> Configuración
              </Link>
              <a href="mailto:support@onepulso.online" className="flex items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary hover:text-foreground">
                <LifeBuoy className="h-4 w-4 text-muted-foreground" /> Ayuda
              </a>
              <button type="button" onClick={handleSignOut} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 font-medium text-secondary-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                <LogOut className="h-4 w-4" /> Cerrar sesión
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
