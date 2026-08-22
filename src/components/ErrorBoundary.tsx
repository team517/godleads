import { Component, ReactNode } from "react";
import { isChunkLoadError, reloadForStaleChunk } from "@/lib/lazy-retry";

/** App-wide safety net: if any render throws, show a recover screen instead of a blank
 *  white page. Two cases:
 *   - A stale-deploy chunk error (a new version shipped mid-session) -> recover SILENTLY by
 *     reloading once to pull the fresh build. The user never sees an error screen.
 *   - A genuine crash -> show the recover screen; the button clears caches and reloads. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; reloading: boolean }> {
  state = { error: null as Error | null, reloading: false };

  static getDerivedStateFromError(error: Error) {
    return { error, reloading: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      // New build shipped while they were here — reload once to get the fresh chunks.
      const triggered = reloadForStaleChunk();
      if (!triggered) this.setState({ reloading: false }); // reloaded too recently -> show screen
      return;
    }
    // eslint-disable-next-line no-console
    console.error("App crash caught by ErrorBoundary:", error);
  }

  render() {
    if (this.state.reloading) {
      // Reload is underway; show a calm, minimal message instead of the scary error box.
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", color: "#666", background: "#fafafa", fontSize: 14 }}>
          Actualizando a la última versión…
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, fontFamily: "system-ui, sans-serif", textAlign: "center", background: "#fafafa" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>Algo se ha bloqueado</h1>
          <p style={{ color: "#666", maxWidth: 420, margin: 0 }}>
            Hubo un error al cargar la app. Pulsa el botón para recargar limpiando la caché — suele arreglarlo al momento.
          </p>
          <pre style={{ fontSize: 11, color: "#b00020", maxWidth: 480, maxHeight: 120, overflow: "auto", background: "#fdecef", padding: 12, borderRadius: 8, margin: 0 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => {
              try { localStorage.clear(); } catch { /* ignore */ }
              try { sessionStorage.clear(); } catch { /* ignore */ }
              window.location.reload();
            }}
            style={{ padding: "10px 22px", borderRadius: 8, background: "#6E58F1", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer", fontSize: 14 }}
          >
            Recargar y limpiar caché
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
