import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { KeepSessionBanner } from "@/components/KeepSessionBanner";

export function AppLayout() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
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
      />

      <div className={`flex flex-1 flex-col ${isMobile ? "ml-0" : "ml-60"}`}>
        <Topbar onMenuToggle={() => setSidebarOpen(true)} isMobile={isMobile} />
        <main className={`flex-1 ${isMobile ? "p-2.5 pb-16" : "p-6"}`}>
          <Outlet />
        </main>
      </div>

      {isMobile && <MobileBottomNav />}

      <KeepSessionBanner />
    </div>
  );
}
