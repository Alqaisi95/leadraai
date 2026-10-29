"use client";
/** Browser API client (v2): httpOnly cookie session + CSRF double-submit header. */

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function getOrg() {
  return typeof window === "undefined" ? null : localStorage.getItem("leadra_org");
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const orgId = getOrg();
  const method = (options.method ?? "GET").toUpperCase();
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const res = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(orgId ? { "X-Organization-Id": orgId } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": readCookie("leadra_csrf") ?? "" } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    window.location.href = "/login";
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `HTTP ${res.status}`), { code: data?.error?.code });
  return data;
}
