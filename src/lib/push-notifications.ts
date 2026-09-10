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

async function saveSubscription(userId: string, subscription: PushSubscription): Promise<void> {
  const subJSON = subscription.toJSON();
  await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: subJSON.endpoint!,
      p256dh: subJSON.keys!.p256dh!,
      auth: subJSON.keys!.auth!,
    },
    { onConflict: "user_id,endpoint" }
  );
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

    // Upsert is cheap and idempotent — cheaper than a select to find out if we must write.
    await saveSubscription(userId, subscription);
    return true;
  } catch (e) {
    console.error("Push ensure error:", e);
    return false;
  }
}

export async function unsubscribeFromPush(userId: string): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId)
        .eq("endpoint", endpoint);
    }
  } catch (e) {
    console.error("Push unsubscribe error:", e);
  }
}
