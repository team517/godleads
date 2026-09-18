import { Outlet, Navigate, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { KeepSessionBanner } from "@/components/KeepSessionBanner";
import { SessionExpiredBanner } from "@/components/SessionExpiredBanner";
import { useProfile } from "@/contexts/ProfileContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUniboxUnreadWatcher } from "@/hooks/useUniboxUnreadWatcher";
import { PushPrompt } from "@/components/PushPrompt";
import { ensurePushSubscription } from "@/lib/push-notifications";
import { startVersionWatcher } from "@/lib/version-check";
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
    // After every "Implementar" the open tab must pick up the new build by itself.
    startVersionWatcher();
    if (user?.id) void ensurePushSubscription(user.id);
  }, [user?.id]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");

  // Per-client branding: tint the accent color from brand_color.
  const brandStyle = brandStyleFor(profile.brand_color);

  // La marca se pone en <html>, no en el envoltorio: los diálogos, menús y avisos se pintan en
  // un portal FUERA de este árbol, y con la marca en un div interior salían con nuestro violeta
  // dentro de la cuenta de un cliente. Al salir del panel (o cambiar de cuenta) se retira.
  useEffect(() => {
    const root = document.documentElement;
    const vars = (brandStyle || {}) as Record<string, string>;
    const keys = Object.keys(vars);
    if (keys.length === 0) return;
    keys.forEach((k) => root.style.setProperty(k, vars[k]));
    root.setAttribute("data-brand", "");
    return () => {
      keys.forEach((k) => root.style.removeProperty(k));
      root.removeAttribute("data-brand");
    };
    // brand_color es lo único de lo que depende brandStyle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.brand_color]);

  // La cuenta de un cliente usa el MISMO envoltorio que cualquier otra: barra
  // lateral, barra superior y navegación inferior. Lo que ve dentro lo deciden sus
  // `allowed_routes` (las escribe el servidor), no una excusa de interfaz.

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

  // La animación de entrada se dispara al cambiar de SECCIÓN (primer tramo de la ruta), no en
  // cada sub-ruta: así una página no se remonta al moverse por dentro de sí misma.
  const section = location.pathname.split("/")[1] || "";

  return (
    <div className="soft-surface min-h-screen">
      {/* Fondo del diseño: la ola y las retículas de puntos, siempre detrás del contenido. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <span className="soft-wave-fixed" />
        <span className="soft-dots-grid absolute bottom-10 left-6 hidden h-[120px] w-[120px] opacity-[.14] lg:block" />
        <span className="soft-dots-grid absolute right-6 top-24 hidden h-[120px] w-[120px] opacity-[.14] lg:block" />
      </div>
      <Topbar
        onMenuToggle={() => setSidebarOpen(true)}
        isMobile={isMobile}
        collapsed={isCollapsed}
        onToggleCollapse={toggleCollapsed}
      />

      {/* Overlay for mobile */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-[55] bg-[#15113C]/45 backdrop-blur-[2px]"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AppSidebar
        isMobile={isMobile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={isCollapsed}
      />

      <div
        className={`flex min-h-screen flex-col pt-[calc(3.5rem+env(safe-area-inset-top))] transition-[margin] duration-200 ${
          isMobile ? "ml-0" : isCollapsed ? "ml-16" : "ml-60"
        }`}
      >
        <main className={`relative z-[1] flex-1 ${isMobile ? "p-2.5 pb-[calc(5rem+env(safe-area-inset-bottom))]" : "p-6"}`}>
          {pathAllowed
            ? <div key={section} className="page-enter"><Outlet /></div>
            : <Navigate to={allowed![0]} replace />}
        </main>
      </div>

      {isMobile && <MobileBottomNav />}

      <KeepSessionBanner />
      {/* Token caducado: se dice en vez de enseñar listas vacías. */}
      <SessionExpiredBanner />
      <PushPrompt />
    </div>
  );
}
