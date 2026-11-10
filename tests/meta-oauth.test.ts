import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * These pin the two failures that made the integration look connected while
 * nothing worked:
 *  1. the Page access token was never requested, so a *user* token was stored —
 *     it authenticates but fails every messaging call;
 *  2. the Page was never subscribed to message webhooks, so Meta delivered
 *     nothing and the inbox stayed empty forever.
 */
const ENV = { META_APP_ID: "app123", META_APP_SECRET: "secret123", APP_URL: "https://app.test" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(process.env, ENV);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("oauthUrl — نطاقات الصلاحيات", () => {
  it("requests the permissions messaging actually needs", async () => {
    const { oauthUrl } = await import("@/lib/meta");
    const scope = new URL(oauthUrl("state123")).searchParams.get("scope")!;

    // sending/receiving on the Messenger Platform
    expect(scope).toContain("pages_messaging");
    expect(scope).toContain("instagram_manage_messages");
    // subscribing the Page to webhooks
    expect(scope).toContain("pages_manage_metadata");
  });

  it("carries the state and the exact redirect URI Meta must have whitelisted", async () => {
    const { oauthUrl } = await import("@/lib/meta");
    const url = new URL(oauthUrl("state123"));
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/integrations/meta/callback");
    expect(url.searchParams.get("client_id")).toBe("app123");
  });
});

describe("listIgAccounts — رمز الصفحة", () => {
  it("asks Meta for the Page access token, not just the account ids", async () => {
    fetchMock.mockResolvedValueOnce(ok({ data: [] }));
    const { listIgAccounts } = await import("@/lib/meta");
    await listIgAccounts("user-token");

    const requested = String(fetchMock.mock.calls[0][0]);
    // the original bug: this field was absent, so no Page token ever existed
    expect(requested).toContain("access_token");
    expect(requested).toContain("instagram_business_account");
  });

  it("returns the Page token alongside the IG account", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        data: [
          {
            id: "page-1",
            name: "Al Diyar",
            access_token: "PAGE_TOKEN",
            instagram_business_account: { id: "ig-1", username: "aldiyar" },
          },
        ],
      }),
    );
    const { listIgAccounts } = await import("@/lib/meta");
    const [acc] = await listIgAccounts("user-token");

    expect(acc.pageAccessToken).toBe("PAGE_TOKEN");
    expect(acc.pageAccessToken).not.toBe("user-token");
    expect(acc.pageId).toBe("page-1");
    expect(acc.igId).toBe("ig-1");
  });

  it("skips Pages that carry no IG account or no token — they cannot be used", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        data: [
          { id: "p1", name: "no ig", access_token: "t" },
          { id: "p2", name: "no token", instagram_business_account: { id: "ig", username: "u" } },
        ],
      }),
    );
    const { listIgAccounts } = await import("@/lib/meta");
    expect(await listIgAccounts("user-token")).toHaveLength(0);
  });
});

describe("subscribePageToWebhooks — الاشتراك في الرسائل", () => {
  it("subscribes the Page to message fields with the Page token", async () => {
    fetchMock.mockResolvedValueOnce(ok({ success: true }));
    const { subscribePageToWebhooks } = await import("@/lib/meta");
    await subscribePageToWebhooks("page-1", "PAGE_TOKEN");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/page-1/subscribed_apps");
    expect((init as RequestInit).method).toBe("POST");
    const body = String((init as RequestInit).body);
    expect(body).toContain("messages");
    expect(body).toContain("PAGE_TOKEN");
  });

  it("treats an explicit success:false as a failure, not a silent pass", async () => {
    fetchMock.mockResolvedValueOnce(ok({ success: false }));
    const { subscribePageToWebhooks } = await import("@/lib/meta");
    await expect(subscribePageToWebhooks("page-1", "t")).rejects.toThrow();
  });

  it("surfaces Meta's own error message rather than a bare status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "(#200) Insufficient permission" } }),
      text: async () => "",
    });
    const { subscribePageToWebhooks } = await import("@/lib/meta");
    await expect(subscribePageToWebhooks("page-1", "t")).rejects.toThrow(/Insufficient permission/);
  });
});
