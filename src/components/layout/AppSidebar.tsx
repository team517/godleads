import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  type LucideIcon, LayoutDashboard, Mail, Send, Users, Inbox, BarChart3, Settings, LogOut, Home, Brain, Shield, ShieldCheck, Sparkles, Rocket, Megaphone, Workflow, CalendarClock, Loader2, FileText, Building2, ChevronDown, Briefcase, X } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { SparkMark } from "@/components/SparkMark";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { supabase } from "@/integrations/supabase/client";
import { readCachedUniboxUnread, subscribeUniboxUnread } from "@/lib/uniboxBadge";
import { isAgencyAccount } from "@/lib/access";
import { clearKeepSession } from "@/components/KeepSessionBanner";
import { prefetchRoute, prefetchAllRoutesOnIdle } from "@/lib/route-prefetch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type NavEntry = { icon: LucideIcon; label: string; path: string; exact?: boolean };
type NavGroup = { id: string; title: string | null; items: NavEntry[] };

// El menú se agrupa por lo que se hace, no por "principal / herramientas": cada sección se
// pliega por su cuenta y recuerda su estado, como en cualquier programa de escritorio.
const NAV_GROUPS: NavGroup[] = [
  { id: "main", title: null, items: [
    { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
    { icon: Send, label: "Campañas", path: "/campaigns" },
    { icon: Inbox, label: "Unibox", path: "/unibox" },
    { icon: Mail, label: "Cuentas Email", path: "/email-accounts" },
    { icon: Users, label: "Leads", path: "/leads" },
  ] },
  { id: "ai", title: "Equipo IA", items: [
    { icon: Sparkles, label: "Personalización", path: "/personalizacion" },
    { icon: Brain, label: "IA", path: "/ai-prompts" },
    { icon: Workflow, label: "Automatización", path: "/automatizacion" },
    { icon: Megaphone, label: "Automatizar campaña", path: "/client-campaigns" },
    { icon: FileText, label: "Copy", path: "/copy" },
  ] },
  { id: "health", title: "Salud de envío", items: [
    { icon: ShieldCheck, label: "Entregabilidad", path: "/deliverability" },
  ] },
  { id: "clients", title: "Clientes", items: [
    { icon: Building2, label: "Clientes", path: "/clientes" },
    { icon: Briefcase, label: "Portal de Clientes", path: "/admin/clients" },
    { icon: Rocket, label: "Onboarding", path: "/onboarding" },
    { icon: CalendarClock, label: "Seguimiento", path: "/seguimiento" },
  ] },
  { id: "perf", title: "Rendimiento", items: [
    { icon: BarChart3, label: "Estadísticas", path: "/stats" },
  ] },
  { id: "admin", title: "Admin", items: [
    { icon: Shield, label: "Panel Admin", path: "/admin", exact: true },
  ] },
];

const GROUPS_KEY = "sidebarGroupsClosed";
const readClosedGroups = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}") || {}; } catch { return {}; }
};

interface AppSidebarProps {
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
}

export function AppSidebar({ isMobile, isOpen, onClose, collapsed }: AppSidebarProps) {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { profile: profileData } = useProfile();
  const navigate = useNavigate();
  // Real relevant-unread count, published by the Unibox (matches what it shows).
  // Counting raw unread rows here showed a fake "99+" of warm-up noise.
  const [unreadCount, setUnreadCount] = useState(readCachedUniboxUnread());
  // How many personalization jobs are generating right now → shows an "en curso" badge on the
  // Personalización item from ANY screen, so you always know a batch is still running.
  const [personalizing, setPersonalizing] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>(readClosedGroups);
  const isManager = !!profileData.is_client_manager;
  const allowedRoutes = profileData.allowed_routes;
  // Owner-only agency tools — never shown to clients/managers.
  const userEmail = (user?.email || "").toLowerCase();
  const isOwner = userEmail === "hello@onepulso.blog";
  // Automatización access: the owner PLUS equipo@onepulso.online (granted same access as support@
  // plus Automatización). Seguimiento stays owner-only.
  const canAutomation = isOwner || userEmail === "equipo@onepulso.online";
  // "Clientes" (gestión de clientes del usuario de pago) NO es para la agencia:
  // support@/equipo@/propietario/gestores tienen su propio Portal de Clientes.
  const isAgency = isAgencyAccount(userEmail, isManager) || isAdmin;

  /** Quién ve cada entrada. Las mismas reglas de siempre, en un solo sitio. */
  const canSee = (path: string): boolean => {
    // Admin / gestión: por rol, no por allowed_routes (un cliente nunca los tiene).
    if (path === "/admin") return isAdmin;
    if (path === "/admin/clients") return isAdmin || isManager;
    if (allowedRoutes && !allowedRoutes.includes(path)) return false;
    if (path === "/clientes") return !isAgency;
    if (path === "/automatizacion") return canAutomation;
    // Copy (enviar el copy de las campañas a cada cliente): agencia — owner, managers (support@) y equipo@.
    if (path === "/copy") return isOwner || isManager || userEmail === "equipo@onepulso.online";
    if (path === "/seguimiento") return isOwner;
    // Onboarding + Automatizar campaña: the owner AND client-managers (e.g. support@).
    if (path === "/onboarding" || path === "/client-campaigns") return isOwner || isManager;
    return true;
  };

  useEffect(() => {
    setUnreadCount(readCachedUniboxUnread());
    return subscribeUniboxUnread(setUnreadCount);
  }, []);

  useEffect(() => {
    if (!user) return;
    const checkAdmin = async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();
      setIsAdmin(data?.role === "admin");
    };
    checkAdmin();
  }, [user]);

  // Poll for a personalization job in progress (light head+count). Only runs when the user can
  // actually see the Personalización item, and refreshes when you change screen.
  useEffect(() => {
    if (!user) return;
    if (allowedRoutes && !allowedRoutes.includes("/personalizacion")) return;
    let alive = true;
    const check = async () => {
      const { count } = await (supabase as any)
        .from("personalization_csv_jobs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("status", ["pending", "running"]);
      if (alive) setPersonalizing(count || 0);
    };
    check();
    const t = setInterval(check, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [user, allowedRoutes, location.pathname]);

  // Prefetch all route chunks in the background after first render.
  useEffect(() => { prefetchAllRoutesOnIdle(); }, []);

  const handleSoftExit = () => {
    // Just navigate away without destroying the session
    navigate("/");
  };

  const handleSignOut = async () => {
    clearKeepSession();
    await signOut();
    navigate("/");
  };

  const handleNavClick = () => {
    if (isMobile && onClose) onClose();
  };

  const toggleGroup = (id: string) =>
    setClosedGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
      return next;
    });

  const isActivePath = (item: NavEntry) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

  // En escritorio el menú vive DEBAJO de la barra superior (que va a todo el ancho). En móvil
  // es un cajón que la tapa, con su propia cabecera para cerrarlo.
  const sidebarClasses = cn(
    "soft-sidebar fixed left-0 z-40 flex flex-col text-sidebar-foreground transition-[transform,width] duration-200",
    isMobile
      ? "top-0 z-[60] h-[100dvh] w-[272px] shadow-modal"
      : "top-[calc(3.5rem+env(safe-area-inset-top))] h-[calc(100dvh-3.5rem-env(safe-area-inset-top))]",
    !isMobile && (collapsed ? "w-16" : "w-[270px]"),
    isMobile && !isOpen && "-translate-x-full",
    isMobile && isOpen && "translate-x-0"
  );

  const NavItem = ({ item }: { item: NavEntry }) => {
    const isActive = isActivePath(item);
    return (
      <Link
        to={item.path}
        onClick={handleNavClick}
        onMouseEnter={() => prefetchRoute(item.path)}
        onFocus={() => prefetchRoute(item.path)}
        title={collapsed ? item.label : undefined}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "soft-nav-item group",
          collapsed && "mx-auto w-10 justify-center px-0",
          isActive && "soft-nav-item-on",
        )}
      >
        <span className={cn("soft-nav-icon shrink-0", collapsed && "mr-0")}>
          <item.icon strokeWidth={1.8} className="h-[19px] w-[19px]" />
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
        {item.path === "/unibox" && unreadCount > 0 && (
          collapsed ? (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-sidebar" />
          ) : (
            <span className="chip-pop soft-nav-badge ml-auto">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )
        )}
        {item.path === "/personalizacion" && personalizing > 0 && (
          collapsed ? (
            <span className="live-dot absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold text-primary">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> en curso
            </span>
          )
        )}
      </Link>
    );
  };

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => canSee(it.path)) }))
    .filter((g) => g.items.length > 0);

  const utilBtn = "flex h-8 flex-1 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground hover:shadow-rest";

  return (
    <aside className={sidebarClasses} aria-label="Menú principal">
      {/* Cajón móvil: cabecera propia (la barra superior queda debajo). */}
      {isMobile && (
        <div className="topbar-surface flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between px-4 pt-[env(safe-area-inset-top)]">
          {profileData.logo_url
            ? <span className="flex h-8 items-center rounded-md bg-white px-2"><img src={profileData.logo_url} alt={profileData.company_name || "Logo"} className="h-5 max-w-[130px] object-contain" /></span>
            : <span className="flex items-center gap-2.5"><SparkMark size={28} /><Wordmark className="h-[20px]" colorClassName="text-white" /></span>}
          <button onClick={onClose} aria-label="Cerrar menú" className="flex h-9 w-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      <nav className={cn("relative z-[1] flex-1 overflow-y-auto overflow-x-hidden py-[18px]", collapsed ? "px-2" : "px-3.5")}>
        {groups.map((group, gi) => {
          // Una sección plegada no esconde la pantalla en la que estás.
          const hasActive = group.items.some(isActivePath);
          const open = collapsed || !group.title || !closedGroups[group.id] || hasActive;
          return (
            <div key={group.id} className={cn(gi > 0 && "mt-3.5 border-t border-[rgba(116,128,180,.12)] pt-3.5 dark:border-sidebar-border/70")}>
              {group.title && !collapsed && (
                <button type="button" onClick={() => toggleGroup(group.id)} aria-expanded={open} className="soft-nav-section">
                  <span>{group.title}</span>
                  <span className="soft-nav-arrow">
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", !open && "-rotate-90")} />
                  </span>
                </button>
              )}
              <div className="collapse-grid" data-open={open}>
                <div className="flex flex-col gap-1">
                  {group.items.map((item) => <NavItem key={item.path} item={item} />)}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Pie: cuenta + fila de utilidades en una sola pieza, como en un programa de escritorio. */}
      <div className={cn("shrink-0 border-t border-sidebar-border/70 safe-area-bottom", collapsed ? "p-2" : "p-3")}>
        {!collapsed && (
          <Link
            to="/settings"
            onClick={handleNavClick}
            className="mb-2 flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-sidebar-accent/70"
          >
            <Avatar className="h-8 w-8 shrink-0 ring-2 ring-primary/15">
              <AvatarImage src={profileData.avatar_url || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(user?.email || 'user')}&backgroundColor=b6e3f4,c0aede,d1f4a5,ffd5dc,ffdfbf`} />
              <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                {(profileData.full_name || user?.email || "U").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground">{profileData.full_name || "Sin nombre"}</p>
              <p className="truncate text-[11.5px] text-muted-foreground">{user?.email}</p>
            </div>
          </Link>
        )}
        <div className={cn("flex gap-0.5 rounded-lg border border-sidebar-border/80 bg-secondary/70 p-0.5", collapsed && "flex-col")}>
          <Link
            to="/settings"
            onClick={handleNavClick}
            title="Configuración"
            aria-label="Configuración"
            className={cn(utilBtn, location.pathname.startsWith("/settings") && "bg-card text-primary shadow-rest")}
          >
            <Settings className="h-4 w-4" />
          </Link>
          {/* Home, no LogOut: "Salir" sólo vuelve al inicio sin cerrar la sesión. */}
          <button type="button" onClick={handleSoftExit} title="Salir al inicio (sin cerrar sesión)" aria-label="Salir al inicio" className={utilBtn}>
            <Home className="h-4 w-4" />
          </button>
          <button type="button" onClick={handleSignOut} title="Cerrar sesión" aria-label="Cerrar sesión" className={cn(utilBtn, "hover:!text-destructive")}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
