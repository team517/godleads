import { Link, useLocation } from "react-router-dom";
import { Send, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { readCachedUniboxUnread, subscribeUniboxUnread } from "@/lib/uniboxBadge";

const navItems = [
  { icon: Send, label: "Campañas", path: "/campaigns" },
  { icon: Inbox, label: "Unibox", path: "/unibox" },
];

export function MobileBottomNav() {
  const location = useLocation();
  // Real relevant-unread count published by the Unibox (mirrors what it shows).
  const [unreadCount, setUnreadCount] = useState(readCachedUniboxUnread());

  useEffect(() => {
    setUnreadCount(readCachedUniboxUnread());
    return subscribeUniboxUnread(setUnreadCount);
  }, []);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around border-t bg-background/95 backdrop-blur-md safe-area-bottom md:hidden">
      {navItems.map((item) => {
        const isActive = location.pathname.startsWith(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold transition-colors relative",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <div className="relative">
              <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
              {item.path === "/unibox" && unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
