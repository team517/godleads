import { PauseCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

/* Cuenta pausada por el administrador (03-11-2026): el cliente no entra a nada. Sólo puede cerrar
   sesión. La pausa la pone y la quita el equipo desde el Portal de Clientes. */
export function PausedByAdminScreen({ reason }: { reason?: string | null }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <PauseCircle className="mx-auto h-12 w-12 text-warning" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Cuenta pausada por el administrador</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tus campañas y el envío están en pausa. Mientras dure la pausa no se puede acceder a la plataforma.
        </p>
        {reason && <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-foreground">{reason}</p>}
        <p className="mt-4 text-xs text-muted-foreground">Si crees que es un error, escribe a tu responsable de cuenta.</p>
        <Button variant="outline" className="mt-6 gap-2" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" /> Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
