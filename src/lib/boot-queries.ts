/**
 * Shared boot queries — one network request per (user, query) during app start.
 *
 * At boot SubscriptionContext and ProfileContext both read `profiles`, and the sidebar read
 * `user_roles` after SubscriptionContext already had. Each context keeps its own state, but the
 * underlying request is shared: the first caller fires it, every caller within `ttlMs` gets the
 * same promise. A failed result (supabase returns `{ error }` instead of throwing) is never kept,
 * so a retry really retries. Explicit refreshes (after the user edits their profile) bypass it
 * with `fresh: true`.
 */

type Entry = { at: number; promise: Promise<unknown> };

const entries = new Map<string, Entry>();

export interface SharedQueryOptions<T> {
  /** How long a settled result is handed out again (ms). Default 10 s: enough for every boot
   *  caller, short enough that a later refresh sees fresh data. */
  ttlMs?: number;
  /** Skip the cache for this call (and replace what was cached). */
  fresh?: boolean;
  /** Decide whether a settled result may be reused. Default: reuse unless it carries `error`. */
  reusable?: (value: T) => boolean;
}

const defaultReusable = (value: unknown): boolean => {
  if (value && typeof value === "object" && "error" in (value as Record<string, unknown>)) {
    return !(value as { error?: unknown }).error;
  }
  return true;
};

/** `run` may return a plain Promise or a supabase query builder (a thenable, not a Promise). */
export function sharedQuery<T>(key: string, run: () => PromiseLike<T>, opts: SharedQueryOptions<T> = {}): Promise<T> {
  const ttlMs = opts.ttlMs ?? 10_000;
  const now = Date.now();
  const hit = entries.get(key);
  if (!opts.fresh && hit && now - hit.at < ttlMs) return hit.promise as Promise<T>;

  const reusable = opts.reusable ?? (defaultReusable as (v: T) => boolean);
  const promise: Promise<T> = Promise.resolve(run()).then(
    (value) => {
      if (!reusable(value) && entries.get(key)?.promise === promise) entries.delete(key);
      return value;
    },
    (err) => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
      throw err;
    },
  );
  entries.set(key, { at: now, promise });
  return promise;
}

/** Forget everything (sign-out, tests). */
export function clearSharedQueries(): void {
  entries.clear();
}

/** Columns both boot readers of `profiles` need, as ONE superset so they can share the request. */
export const PROFILE_BOOT_COLS =
  "full_name, avatar_url, company_name, contact_email, allowed_routes, birthday, coins, logo_url, brand_color, is_client_manager, client_login_of, created_at";

export const profileQueryKey = (userId: string) => `profiles:${userId}`;
export const roleQueryKey = (userId: string) => `user_roles:${userId}`;
