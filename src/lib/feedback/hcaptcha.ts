// Server-side hCaptcha verification. The site key is public (the form
// embeds it client-side); the secret key is server-only and used here to
// verify that the token returned by the client is genuine.
//
// Set HCAPTCHA_SECRET_KEY in the server environment. When unset, the
// verification is a no-op — useful for local dev. The form on the
// client still shows the captcha widget as long as
// NEXT_PUBLIC_HCAPTCHA_SITE_KEY is set; if no site key is set the form
// degrades to "anonymous submit with rate limit only" which is fine for
// dev but we MUST set both keys before going live.

const ENDPOINT = "https://api.hcaptcha.com/siteverify";

export async function verifyHcaptcha(token: string | null, remoteIp: string | null): Promise<{ ok: boolean; reason?: string }> {
  const secret = process.env.HCAPTCHA_SECRET_KEY;
  if (!secret) {
    // No secret configured — skip verification. Treat as ok but log so
    // it's obvious in dev / staging. Production MUST set this.
    if (process.env.NODE_ENV === "production") {
      console.warn("[feedback] HCAPTCHA_SECRET_KEY not set — captcha verification skipped");
    }
    return { ok: true, reason: "no-secret-configured" };
  }
  if (!token) {
    return { ok: false, reason: "no-token" };
  }
  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return { ok: false, reason: `hcaptcha-http-${res.status}` };
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
    if (data.success) return { ok: true };
    return { ok: false, reason: (data["error-codes"] || []).join(",") || "rejected" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "verify-failed" };
  }
}
