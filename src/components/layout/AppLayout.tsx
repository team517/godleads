import { Outlet, Navigate, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { KeepSessionBanner } from "@/components/KeepSessionBanner";
import { useProfile } from "@/contexts/ProfileContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUniboxUnreadWatcher } from "@/hooks/useUniboxUnreadWatcher";
import { PushPrompt } from "@/components/PushPrompt";
import { ensurePushSubscription } from "@/lib/push-notifications";
import { brandStyleFor } from "@/lib/brandColor";

export function AppLayout() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { profile } = useProfile();
  const { user } = useAuth();

  // Single owner of the realtime badge bump (see hook). Runs app-wide, once.
  useUniboxUnreadWatcher(user?.id);

  // Heals a "granted but undeliverable" push subscription (missing row / old VAPID key).
  // Never prompts: it is a no-op unless permission is already granted.
  useEffect(() => {
    if (user?.id) void ensurePushSubscription(user.id);
  }, [user?.id]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");

  // Per-client branding: tint the accent color from brand_color.
  const brandStyle = brandStyleFor(profile.brand_color);

  // La cuenta de acceso de un cliente no tiene aplicación: sólo su área de lectura.
  // Aquí sólo puede aterrizar en /settings (su contraseña), y sin barra lateral.
  const isClientLogin = !!profile.client_login_of;

  // Access control: a client (allowed_routes set) can't reach a disallowed route by URL.
  const allowed = profile.allowed_routes;
  const restricted = !!allowed && allowed.length > 0;
  const pathAllowed = !restricted
    || location.pathname === "/"
    || location.pathname.startsWith("/settings")
    || allowed!.some((r) => location.pathname.startsWith(r));

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      return next;
    });

  const isCollapsed = !isMobile && collapsed;

  return (
    <div className="flex min-h-screen" style={brandStyle}>
      {/* Overlay for mobile */}
      {isMobile && sidebarOpen && !isClientLogin && (
        <div
          className="fixed inset-0 z-30 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {!isClientLogin && (
        <AppSidebar
          isMobile={isMobile}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={isCollapsed}
          onToggleCollapse={toggleCollapsed}
        />
      )}

      <div
        className={`flex flex-1 flex-col transition-[margin] duration-200 ${
          isClientLogin ? "ml-0" : isMobile ? "ml-0" : isCollapsed ? "ml-16" : "ml-60"
        }`}
      >
        <Topbar onMenuToggle={() => setSidebarOpen(true)} isMobile={isMobile} />
        <main className={`flex-1 ${isMobile ? "p-2.5 pb-[calc(5rem+env(safe-area-inset-bottom))]" : "p-6"}`}>
          {pathAllowed ? <Outlet /> : <Navigate to={allowed![0]} replace />}
        </main>
      </div>

      {isMobile && !isClientLogin && <MobileBottomNav />}

      <KeepSessionBanner />
      <PushPrompt />
    </div>
  );
}
