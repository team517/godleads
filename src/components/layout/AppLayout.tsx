import { Outlet, Navigate, useLocation } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { KeepSessionBanner } from "@/components/KeepSessionBanner";
import { useProfile } from "@/contexts/ProfileContext";
import { useAuth } from "@/contexts/AuthContext";
import { useUniboxUnreadWatcher } from "@/hooks/useUniboxUnreadWatcher";

// Convert a #hex brand color to the "H S% L%" triple our CSS custom properties use.
function hexToHsl(hex: string): string | null {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue /= 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function AppLayout() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { profile } = useProfile();
  const { user } = useAuth();

  // Single owner of the realtime badge bump (see hook). Runs app-wide, once.
  useUniboxUnreadWatcher(user?.id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");

  // Per-client branding: tint the accent color from brand_color.
  const brandHsl = profile.brand_color ? hexToHsl(profile.brand_color) : null;
  const brandStyle = brandHsl
    ? ({ ["--primary"]: brandHsl, ["--ring"]: brandHsl, ["--primary-glow"]: brandHsl, ["--sidebar-primary"]: brandHsl, ["--sidebar-ring"]: brandHsl } as React.CSSProperties)
    : undefined;

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
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AppSidebar
        isMobile={isMobile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={isCollapsed}
        onToggleCollapse={toggleCollapsed}
      />

      <div className={`flex flex-1 flex-col transition-[margin] duration-200 ${isMobile ? "ml-0" : isCollapsed ? "ml-16" : "ml-60"}`}>
        <Topbar onMenuToggle={() => setSidebarOpen(true)} isMobile={isMobile} />
        <main className={`flex-1 ${isMobile ? "p-2.5 pb-[calc(5rem+env(safe-area-inset-bottom))]" : "p-6"}`}>
          {pathAllowed ? <Outlet /> : <Navigate to={allowed![0]} replace />}
        </main>
      </div>

      {isMobile && <MobileBottomNav />}

      <KeepSessionBanner />
    </div>
  );
}
