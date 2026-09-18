import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { SESSION_EXPIRED_EVENT } from "@/lib/auth-retry";

/** Aviso de sesión caducada.
 *
 *  La aplicación NO cierra la sesión por su cuenta (decisión del propietario), así que cuando el
 *  token caduca y no se puede renovar la pantalla seguía pareciendo normal mientras cada consulta
 *  volvía vacía: el usuario creía haber perdido sus campañas. Esto lo dice claramente y ofrece
 *  las dos salidas: recargar (por si sólo fue un tropiezo) o volver a entrar. */
export function SessionExpiredBanner() {
  const [shown, setShown] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const onExpired = () => setShown(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  if (!shown) return null;

  return (
    <div role="alert" className="fixed inset-x-0 bottom-0 z-[70] border-t border-destructive/30 bg-destructive/10 backdrop-blur-[6px] safe-area-bottom">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="flex items-start gap-2 text-[14px] font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Tu sesión ha caducado, así que las listas pueden salir vacías. Tus datos siguen ahí.</span>
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.location.reload()}>
            <RefreshCw className="h-3.5 w-3.5" /> Recargar
          </Button>
          <Button size="sm" onClick={async () => { await signOut(); navigate("/auth"); }}>
            Volver a entrar
          </Button>
        </div>
      </div>
    </div>
  );
}
