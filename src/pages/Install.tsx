import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, Smartphone, CheckCircle, Share, MoreVertical, ExternalLink } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showManualSteps, setShowManualSteps] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(ios);

    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setIsInstalled(true));

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") setIsInstalled(true);
        setDeferredPrompt(null);
      } catch {
        setShowManualSteps(true);
      }
    } else {
      // No prompt available — show manual steps
      setShowManualSteps(true);
    }
  }, [deferredPrompt]);

  if (isInstalled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-green-500/10 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">¡App instalada!</h1>
          <p className="text-muted-foreground">
            GodLeads ya está en tu pantalla de inicio. Ábrela desde ahí para la mejor experiencia.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Icon */}
        <div className="mx-auto w-24 h-24 rounded-3xl bg-primary shadow-lg shadow-primary/30 flex items-center justify-center">
          <Download className="w-12 h-12 text-primary-foreground" />
        </div>

        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-foreground">Descargar GodLeads</h1>
          <p className="text-muted-foreground">
            Instala la app en tu dispositivo para acceder rápido a tu Unibox y campañas.
          </p>
        </div>

        {/* Main Install Button — always visible */}
        <Button
          size="lg"
          onClick={handleInstall}
          className="w-full gap-3 h-16 text-lg font-bold rounded-2xl shadow-lg shadow-primary/25"
        >
          <Download className="w-6 h-6" />
          {deferredPrompt ? "Instalar App Ahora" : "Descargar App"}
        </Button>

        {deferredPrompt && (
          <p className="text-xs text-green-500 font-medium">
            ✓ Tu navegador soporta instalación directa
          </p>
        )}

        {/* Manual steps — shown when prompt not available or failed */}
        {(showManualSteps || !deferredPrompt) && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground font-medium">
                {showManualSteps ? "Instala manualmente" : "Cómo instalar"}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {isIOS ? (
              <div className="bg-muted rounded-2xl p-5 text-left space-y-4">
                <p className="font-semibold text-foreground flex items-center gap-2 text-sm">
                  🍎 En iPhone / iPad (Safari):
                </p>
                <ol className="space-y-3 text-muted-foreground text-sm">
                  <li className="flex items-start gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">1</span>
                    <span>
                      Toca el botón{" "}
                      <strong className="text-foreground inline-flex items-center gap-1">
                        <Share className="h-3.5 w-3.5" /> Compartir
                      </strong>{" "}
                      en la barra inferior de Safari
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">2</span>
                    <span>
                      Busca y toca <strong className="text-foreground">"Añadir a pantalla de inicio"</strong>
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">3</span>
                    <span>
                      Toca <strong className="text-foreground">"Añadir"</strong> y listo 🎉
                    </span>
                  </li>
                </ol>
              </div>
            ) : (
              <div className="bg-muted rounded-2xl p-5 text-left space-y-4">
                <p className="font-semibold text-foreground flex items-center gap-2 text-sm">
                  🤖 En Android (Chrome):
                </p>
                <ol className="space-y-3 text-muted-foreground text-sm">
                  <li className="flex items-start gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">1</span>
                    <span>
                      Toca el menú{" "}
                      <strong className="text-foreground inline-flex items-center gap-1">
                        <MoreVertical className="h-3.5 w-3.5" /> (⋮)
                      </strong>{" "}
                      en la esquina superior derecha
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">2</span>
                    <span>
                      Toca{" "}
                      <strong className="text-foreground">"Instalar app"</strong> o{" "}
                      <strong className="text-foreground">"Añadir a pantalla de inicio"</strong>
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold flex-shrink-0">3</span>
                    <span>
                      Confirma y listo 🎉
                    </span>
                  </li>
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">
            Se instala como app nativa. Sin App Store. Sin ocupar espacio.
          </p>
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-primary" /> iPhone
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-primary" /> Android
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-primary" /> Offline
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Install;
