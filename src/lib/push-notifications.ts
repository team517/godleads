import { supabase } from "@/integrations/supabase/client";

// VAPID public key — must match the VAPID_PUBLIC_KEY secret
const VAPID_PUBLIC_KEY = "BAnw1xcf0BuaIkzt2t9sU7sQDRCjYL9BTGzRnTuDzCPGiP5djMbWWxffsPYYuUi84SaGuzVLEfERMccO64IYPEE";

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

export async function subscribeToPush(userId: string): Promise<boolean> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const registration = await registerServiceWorker();
    if (!registration) return false;

    // Wait for SW to be ready
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey as unknown as ArrayBuffer,
      });
    }

    const subJSON = subscription.toJSON();

    // Save to DB
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: subJSON.endpoint!,
        p256dh: subJSON.keys!.p256dh!,
        auth: subJSON.keys!.auth!,
      },
      { onConflict: "user_id,endpoint" }
    );

    return true;
  } catch (e) {
    console.error("Push subscribe error:", e);
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
