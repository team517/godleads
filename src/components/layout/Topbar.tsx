import { Bell, BellOff, Search, Clock, Menu, Volume2, Moon, Sun, Zap, Crown, Rocket, Coins, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Slider } from "@/components/ui/slider";
import { useSubscription, PLAN_CONFIG } from "@/contexts/SubscriptionContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { supabase } from "@/integrations/supabase/client";
import { useState, useCallback, useEffect } from "react";
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getPushPermission } from "@/lib/push-notifications";
import { toast } from "sonner";
import { Link } from "react-router-dom";
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
}

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

export function Topbar({ onMenuToggle, isMobile }: TopbarProps) {
  const { isTrialing, trialDaysLeft, tier, subscribed } = useSubscription();
  const { user } = useAuth();
  const { profile: profileData } = useProfile();
  const { theme, toggleTheme } = useTheme();
  const [notifyEnabled, setNotifyEnabled] = useState(_notifEnabled);
  const [volume, setVolume] = useState(_notifVolume);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [coinLoading, setCoinLoading] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  // Check push status on mount
  useEffect(() => {
    if (!isPushSupported() || !user) return;
    getPushPermission().then(perm => setPushEnabled(perm === "granted"));
  }, [user]);

  const handlePushToggle = useCallback(async () => {
    if (!user) return;
    setPushLoading(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush(user.id);
        setPushEnabled(false);
        toast.success("Notificaciones push desactivadas");
      } else {
        const success = await subscribeToPush(user.id);
        if (success) {
          setPushEnabled(true);
          toast.success("¡Notificaciones push activadas!");
        } else {
          toast.error("No se pudieron activar las notificaciones. Revisa los permisos del navegador.");
        }
      }
    } catch {
      toast.error("Error al cambiar notificaciones push");
    }
    setPushLoading(false);
  }, [user, pushEnabled]);

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

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/10 bg-topbar text-topbar-foreground px-4 md:px-6">
      <div className="flex items-center gap-3">
        {isMobile && (
          <Button variant="ghost" size="icon" onClick={onMenuToggle}>
            <Menu className="h-5 w-5" />
          </Button>
        )}
        {!isMobile && <GlobalSearch />}
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {isTrialing && trialDaysLeft !== null && (
          <Badge
            variant="outline"
            className={`gap-1.5 font-medium px-2 md:px-3 py-1 text-xs md:text-sm ${
              trialDaysLeft < 1
                ? "border-red-300/50 text-red-200 bg-red-500/15"
                : "border-white/30 text-white"
            }`}
          >
            <Clock className="h-3 w-3 md:h-3.5 md:w-3.5" />
            {trialDaysLeft === 0 ? "Expira hoy" : `${trialDaysLeft}d`}
          </Badge>
        )}

        {/* Dark mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title={theme === "dark" ? "Modo claro" : "Modo noche"}
        >
          {theme === "dark" ? (
            <Sun className="h-5 w-5 text-warning" />
          ) : (
            <Moon className="h-5 w-5 text-white/70" />
          )}
        </Button>

        {/* Coin / Credits button */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" title="Monedas">
              <img src={coinIcon} alt="Monedas" className="h-8 w-8" />
              {(profileData.coins > 0 || profileData.infiniteCoins) && (
                <span className="absolute -top-0.5 -right-1 bg-warning text-warning-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {coinDisplay}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="p-4 border-b">
              <div className="flex items-center gap-2 mb-1">
                <img src={coinIcon} alt="" className="h-5 w-5" />
                <h3 className="text-sm font-bold">Monedas</h3>
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
                          ${config.monthly.price}/mes
                        </span>
                      </div>
                      <ul className="text-[11px] text-muted-foreground space-y-0.5 mb-2.5">
                        {plan.features.map((f) => (
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
            <Button variant="ghost" size="icon" className="relative">
              {notifyEnabled ? (
                <Bell className="h-5 w-5 text-violet-300" />
              ) : (
                <BellOff className="h-5 w-5 text-white/70" />
              )}
              {notifyEnabled && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-violet-300 animate-pulse" />
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

        <Link to="/settings">
          <Avatar className="h-9 w-9 ring-2 ring-white/30 cursor-pointer hover:ring-white/60 transition-all">
            <AvatarImage src={profileData.avatar_url || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(user?.email || 'user')}&backgroundColor=b6e3f4`} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
              {(profileData.full_name || user?.email || "U").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>
      </div>
    </header>
  );
}
