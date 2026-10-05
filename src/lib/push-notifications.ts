import { supabase } from "@/integrations/supabase/client";

// VAPID public key — must match the VAPID_PUBLIC_KEY secret
const VAPID_PUBLIC_KEY = "BBdtQ9OiGX_-rvcYuoGsok-A_qPTw-cRoHEJAXIIY5agCK_dDhP0rLlqJXboSY3TK6hfyBQsTfVQksEs0RMs8us";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getPushPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return "denied";
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  // Don't register in iframes or preview hosts
  try {
    if (window.self !== window.top) return null;
  } catch {
    return null;
  }
  if (
    window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com")
  ) {
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return reg;
  } catch (e) {
    console.error("SW registration failed:", e);
    return null;
  }
}

function toUrlBase64(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return window.btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A subscription is only usable if it was created with the VAPID key the server signs with.
 *  Ours were once created with a different key: the push service then answers 403 and the
 *  notification silently never arrives. Detect it so we can re-subscribe instead. */
function matchesCurrentVapidKey(sub: PushSubscription): boolean {
  try {
    const raw = sub.options?.applicationServerKey;
    if (!raw) return false;
    return toUrlBase64(raw) === VAPID_PUBLIC_KEY;
  } catch {
    return false;
  }
}

const DEVICE_KEY = "onepulso-device-id";

/** A stable id for THIS browser/phone, so a rotated endpoint replaces its own row instead of
 *  leaving the previous one behind. */
function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "sin-almacenamiento";
  }
}

async function saveSubscription(userId: string, subscription: PushSubscription): Promise<void> {
  const subJSON = subscription.toJSON();
  const deviceId = getDeviceId();
  const endpoint = subJSON.endpoint!;

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint,
      p256dh: subJSON.keys!.p256dh!,
      auth: subJSON.keys!.auth!,
      device_id: deviceId,
    },
    { onConflict: "user_id,endpoint" }
  );
  // Sin esta fila el servidor NO puede avisar a este móvil: el navegador queda suscrito y la
  // pantalla decía "activadas" mientras no llegaba nada. Es un fallo, no un detalle.
  if (error) throw new Error(error.message);

  // Drop this device's PREVIOUS endpoint. A phone re-subscribes whenever its push token rotates,
  // and the abandoned endpoint is a zombie: Apple still answers 201 for it and delivers nothing,
  // so every alert looked sent while the phone stayed silent for hours.
  await supabase.from("push_subscriptions")
    .delete().eq("user_id", userId).eq("device_id", deviceId).neq("endpoint", endpoint);

  // Legacy rows saved before device ids existed. Only the ones older than a day, so a device
  // that registered moments ago is never pulled out from under itself.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  await supabase.from("push_subscriptions")
    .delete().eq("user_id", userId).is("device_id", null).lt("created_at", yesterday);
}

/* ── Sello de "ya comprobado" de ensurePushSubscription ──────────────────────────────────────
 * La reparación silenciosa escribía en push_subscriptions (upsert + 2 deletes) en CADA arranque.
 * Se sella en localStorage y no se repite en 24 h — salvo que cambie algo que la invalide: otro
 * usuario en este navegador, otro endpoint (el token push rotó) o el permiso. Sin sello, o con
 * un sello que no cuadra, se repara como siempre. */
const ENSURE_STAMP_KEY = "onepulso-push-ensured";
export const PUSH_ENSURE_TTL_MS = 24 * 60 * 60 * 1000;

export type PushEnsureStamp = { at: number; userId: string; endpoint: string; permission: string };

/** ¿Vale el sello para saltarse la escritura? Pura — con prueba. */
export function pushEnsureIsFresh(
  stamp: PushEnsureStamp | null | undefined,
  now: { at: number; userId: string; endpoint: string; permission: string },
  ttlMs = PUSH_ENSURE_TTL_MS,
): boolean {
  if (!stamp || typeof stamp.at !== "number") return false;
  if (now.at - stamp.at < 0 || now.at - stamp.at >= ttlMs) return false;
  if (stamp.userId !== now.userId) return false;
  if (!stamp.endpoint || stamp.endpoint !== now.endpoint) return false;
  if (stamp.permission !== now.permission) return false;
  return true;
}

function readEnsureStamp(): PushEnsureStamp | null {
  try {
    const raw = localStorage.getItem(ENSURE_STAMP_KEY);
    return raw ? (JSON.parse(raw) as PushEnsureStamp) : null;
  } catch {
    return null;
  }
}

function writeEnsureStamp(stamp: PushEnsureStamp | null): void {
  try {
    if (stamp) localStorage.setItem(ENSURE_STAMP_KEY, JSON.stringify(stamp));
    else localStorage.removeItem(ENSURE_STAMP_KEY);
  } catch { /* sin almacenamiento: se repara en cada arranque, como antes */ }
}

export async function subscribeToPush(userId: string): Promise<boolean> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const registration = await registerServiceWorker();
    if (!registration) return false;

    // Wait for SW to be ready
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    // Stale key → drop it, both in the browser and in our table, and start clean.
    if (subscription && !matchesCurrentVapidKey(subscription)) {
      const staleEndpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => {});
      await supabase.from("push_subscriptions").delete().eq("endpoint", staleEndpoint);
      subscription = null;
    }

    if (!subscription) {
      const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey as unknown as ArrayBuffer,
      });
    }

    await saveSubscription(userId, subscription);
    writeEnsureStamp({ at: Date.now(), userId, endpoint: subscription.endpoint, permission: Notification.permission });
    return true;
  } catch (e) {
    console.error("Push subscribe error:", e);
    return false;
  }
}

/**
 * Silent repair, run on every app start.
 *
 * The browser keeping permission "granted" does NOT mean we can still reach the device: the row
 * can be missing from our table (pruned, or the user signed in on a new account) and the
 * subscription can be bound to an old VAPID key. Both look "enabled" in the UI and deliver
 * nothing. This re-registers when needed and never prompts — if permission is not already
 * granted it does nothing at all.
 */
export async function ensurePushSubscription(userId: string): Promise<boolean> {
  try {
    if (!isPushSupported() || Notification.permission !== "granted") return false;

    const registration = await registerServiceWorker();
    if (!registration) return false;
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (subscription && !matchesCurrentVapidKey(subscription)) {
      const staleEndpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => {});
      await supabase.from("push_subscriptions").delete().eq("endpoint", staleEndpoint);
      subscription = null;
    }

    if (!subscription) {
      // requestPermission() is not called here: permission is already "granted".
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
      });
    }

    // Comprobado hace menos de 24 h para este usuario, este endpoint y este permiso: la fila ya
    // está; no se vuelve a escribir. (Todo lo de arriba es local y sigue reparando una suscripción
    // rota o con la clave antigua en cada arranque.)
    const now = { at: Date.now(), userId, endpoint: subscription.endpoint, permission: Notification.permission as string };
    if (pushEnsureIsFresh(readEnsureStamp(), now)) return true;

    // Upsert is cheap and idempotent — cheaper than a select to find out if we must write.
    await saveSubscription(userId, subscription);
    writeEnsureStamp(now);
    return true;
  } catch (e) {
    console.error("Push ensure error:", e);
    return false;
  }
}

/**
 * What the UI should actually show.
 *
 * `Notification.permission === "granted"` is NOT the state of the toggle: permission survives an
 * unsubscribe, and the subscription can be bound to an old VAPID key (or gone entirely) while the
 * browser still reports "granted". Only a live subscription signed with the current key delivers.
 */
export async function getPushState(): Promise<"unsupported" | "denied" | "off" | "on"> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription && matchesCurrentVapidKey(subscription) ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Returns true only when the browser unsubscribe AND the row deletion both succeeded, so the
 *  caller doesn't claim "desactivadas" while the server can still reach the device. */
export async function unsubscribeFromPush(userId: string): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true; // nothing to undo
    const endpoint = subscription.endpoint;
    const gone = await subscription.unsubscribe();
    if (!gone) return false;
    writeEnsureStamp(null); // la próxima activación vuelve a escribir la fila
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", endpoint);
    if (error) {
      console.error("Push unsubscribe delete error:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Push unsubscribe error:", e);
    return false;
  }
}
