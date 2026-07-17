import { Component, ReactNode } from "react";

/** App-wide safety net: if any render throws, show a recover screen instead of a blank
 *  white page. The button clears localStorage (a stale cached shape is a common cause) and
 *  reloads, so the user can self-unstick without waiting for a redeploy. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("App crash caught by ErrorBoundary:", error);
  }

  render() {
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
            onClick={() => { try { localStorage.clear(); } catch { /* ignore */ } window.location.reload(); }}
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
