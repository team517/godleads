import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Mail, Send, Users, Inbox, BarChart3, Settings, LogOut, Brain, Shield, Workflow, Tv, ChevronLeft, ShieldCheck,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { supabase } from "@/integrations/supabase/client";
import { readCachedUniboxUnread, subscribeUniboxUnread } from "@/lib/uniboxBadge";
import { isSessionKept, clearKeepSession } from "@/components/KeepSessionBanner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const mainNav = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Mail, label: "Cuentas Email", path: "/email-accounts" },
  { icon: Send, label: "Campañas", path: "/campaigns" },
  { icon: Users, label: "Leads", path: "/leads" },
  { icon: Inbox, label: "Unibox", path: "/unibox" },
];

const toolsNav = [
  { icon: BarChart3, label: "Estadísticas", path: "/stats" },
  { icon: ShieldCheck, label: "Entregabilidad", path: "/deliverability" },
  { icon: Brain, label: "IA", path: "/ai-prompts" },
  { icon: Workflow, label: "Nodos", path: "/workflows" },
  { icon: Tv, label: "Tutorial", path: "/godtube" },
];

interface AppSidebarProps {
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function AppSidebar({ isMobile, isOpen, onClose, collapsed, onToggleCollapse }: AppSidebarProps) {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { profile: profileData } = useProfile();
  const navigate = useNavigate();
  // Real relevant-unread count, published by the Unibox (matches what it shows).
  // Counting raw unread rows here showed a fake "99+" of warm-up noise.
  const [unreadCount, setUnreadCount] = useState(readCachedUniboxUnread());
  const [isAdmin, setIsAdmin] = useState(false);
  const allowedRoutes = profileData.allowed_routes;

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

  const sidebarClasses = cn(
    "fixed left-0 top-0 z-40 flex h-screen flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[transform,width] duration-200",
    collapsed ? "w-16" : "w-60",
    isMobile && !isOpen && "-translate-x-full",
    isMobile && isOpen && "translate-x-0"
  );

  const NavItem = ({ item }: { item: typeof mainNav[0] }) => {
    const isActive = location.pathname.startsWith(item.path);
    return (
      <Link
        to={item.path}
        onClick={handleNavClick}
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg py-2.5 text-[13.5px] transition-all duration-150 relative group",
          collapsed ? "justify-center px-0" : "px-3.5",
          isActive
            ? "bg-sidebar-accent text-sidebar-primary font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r-full before:bg-sidebar-primary"
            : "font-medium text-sidebar-foreground hover:text-sidebar-primary hover:bg-sidebar-accent/60"
        )}
      >
        <span className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          isActive
            ? "bg-sidebar-primary text-white shadow-sm"
            : "bg-muted/50 text-sidebar-foreground/70 group-hover:bg-sidebar-accent group-hover:text-sidebar-primary"
        )}>
          <item.icon strokeWidth={1.9} className="h-[17px] w-[17px]" />
        </span>
        {!collapsed && item.label}
        {item.path === "/unibox" && unreadCount > 0 && (
          collapsed ? (
            <span className="absolute top-1 right-1.5 h-2 w-2 rounded-full bg-destructive" />
          ) : (
            <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )
        )}
      </Link>
    );
  };

  return (
    <aside className={sidebarClasses}>
      {/* Logo + collapse toggle */}
      <div className={cn("flex h-14 items-center border-b border-sidebar-border/50", collapsed ? "justify-center px-2" : "justify-between px-5")}>
        {!collapsed && (
          profileData.logo_url
            ? <img src={profileData.logo_url} alt={profileData.company_name || "Logo"} className="h-7 max-w-[150px] object-contain" />
            : <Wordmark className="h-7" colorClassName="text-foreground" />
        )}
        {isMobile ? (
          <button onClick={onClose} className="text-sidebar-foreground/50 hover:text-sidebar-foreground p-1">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        ) : (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Expandir panel" : "Colapsar panel"}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden">
        {/* Main section */}
        <div>
          {!collapsed && <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">Principal</p>}
          <div className="divide-y divide-sidebar-border/50">
            {mainNav.filter(item => !allowedRoutes || allowedRoutes.includes(item.path)).map((item) => <NavItem key={item.path} item={item} />)}
          </div>
        </div>

        {/* Tools section */}
        {(!allowedRoutes || toolsNav.some(item => allowedRoutes.includes(item.path))) && (
        <div className="mt-4 pt-4 border-t border-sidebar-border/70">
          {!collapsed && <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">Herramientas</p>}
          <div className="divide-y divide-sidebar-border/50">
            {toolsNav.filter(item => !allowedRoutes || allowedRoutes.includes(item.path)).map((item) => <NavItem key={item.path} item={item} />)}
          </div>
        </div>
        )}

        {/* Admin */}
        {isAdmin && (
          <div className="space-y-0.5 mt-4 pt-4 border-t border-sidebar-border/60">
            {!collapsed && <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">Admin</p>}
            <Link
              to="/admin"
              onClick={handleNavClick}
              title={collapsed ? "Panel Admin" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg py-2 text-[13px] font-medium transition-all duration-150",
                collapsed ? "justify-center px-0" : "px-3",
                location.pathname === "/admin"
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <Shield className={cn("h-[18px] w-[18px] shrink-0", location.pathname === "/admin" ? "text-sidebar-primary" : "text-sidebar-foreground/40")} />
              {!collapsed && "Panel Admin"}
            </Link>
            <Link
              to="/admin/clients"
              onClick={handleNavClick}
              title={collapsed ? "Portal de Clientes" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg py-2 text-[13px] font-medium transition-all duration-150",
                collapsed ? "justify-center px-0" : "px-3",
                location.pathname.startsWith("/admin/clients")
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <Users className={cn("h-[18px] w-[18px] shrink-0", location.pathname.startsWith("/admin/clients") ? "text-sidebar-primary" : "text-sidebar-foreground/40")} />
              {!collapsed && "Portal de Clientes"}
            </Link>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border/50 p-3 space-y-2">
        {/* User profile */}
        <div className={cn("flex items-center gap-2.5 py-2", collapsed ? "justify-center px-0" : "px-3")} title={collapsed ? (profileData.full_name || user?.email || "") : undefined}>
          <Avatar className="h-8 w-8 shrink-0 ring-2 ring-primary/20">
            <AvatarImage src={profileData.avatar_url || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(user?.email || 'user')}&backgroundColor=b6e3f4,c0aede,d1f4a5,ffd5dc,ffdfbf`} />
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
              {(profileData.full_name || user?.email || "U").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground truncate">{profileData.full_name || "Sin nombre"}</p>
              <p className="text-[10px] text-sidebar-foreground/40 truncate">{user?.email}</p>
            </div>
          )}
        </div>

        <div className="divide-y divide-sidebar-border/50 border-t border-sidebar-border/50">
        <Link
          to="/settings"
          onClick={handleNavClick}
          title={collapsed ? "Configuración" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg py-2 text-[13px] font-medium transition-all duration-150",
            collapsed ? "justify-center px-0" : "px-3",
            location.pathname.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-primary"
              : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          )}
        >
          <Settings className="h-[18px] w-[18px] shrink-0 text-sidebar-foreground/40" />
          {!collapsed && "Configuración"}
        </Link>
        <button
          onClick={handleSoftExit}
          title={collapsed ? "Salir" : undefined}
          className={cn("flex w-full items-center gap-3 rounded-lg py-2 text-[13px] font-medium text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150", collapsed ? "justify-center px-0" : "px-3")}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && "Salir"}
        </button>
        <button
          onClick={handleSignOut}
          title={collapsed ? "Cerrar sesión" : undefined}
          className={cn("flex w-full items-center gap-3 rounded-lg py-2 text-[13px] font-medium text-sidebar-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all duration-150", collapsed ? "justify-center px-0" : "px-3")}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && "Cerrar sesión"}
        </button>
        </div>
      </div>
    </aside>
  );
}
