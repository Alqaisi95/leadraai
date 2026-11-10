/**
 * Push notifications.
 *
 * Two things matter more than delivery here: what a push is allowed to say,
 * and what happens to a device that no longer exists. A push renders on a
 * locked screen in front of whoever is nearby, and browsers expire endpoints
 * constantly — a system that leaks customer names, or that retries forever
 * against dead devices, is worse than having no push at all.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — push must not be skipped");
}

/** Every send the code attempted, and the failure to hand back for each. */
const attempts: { endpoint: string; payload: any }[] = [];
let failWith: Record<string, number> = {};

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      attempts.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
      const status = failWith[sub.endpoint];
      if (status) throw Object.assign(new Error(`push ${status}`), { statusCode: status });
      return { statusCode: 201 };
    },
  },
}));

describe.skipIf(!HAS_DB)("Push notifications", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let push: typeof import("@/lib/push");
  let memberId: string;
  let orgId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    // The library is configured at import time from these.
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    ({ prisma } = await import("@/lib/db"));
    push = await import("@/lib/push");
  });

  beforeEach(async () => {
    attempts.length = 0;
    failWith = {};
    await prisma.organization.deleteMany({ where: { name: { startsWith: "push-test-" } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "push-test-" } } });

    const org = await prisma.organization.create({ data: { name: `push-test-${Date.now()}` } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { email: `push-test-${Date.now()}@example.test`, fullName: "مستخدم", passwordHash: "x" },
    });
    const member = await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: "AGENT", status: "ACTIVE" },
    });
    memberId = member.id;
  });

  async function addDevice(endpoint: string) {
    return prisma.pushSubscription.create({
      data: { memberId, endpoint, p256dh: "key", auth: "auth" },
    });
  }

  it("delivers to every device the member registered", async () => {
    await addDevice("https://push.example/phone");
    await addDevice("https://push.example/desktop");

    const delivered = await push.pushToMember(memberId, { title: "عنوان", body: "سطر", url: "/inbox" });

    expect(delivered).toBe(2);
    expect(attempts.map((a) => a.endpoint).sort()).toEqual([
      "https://push.example/desktop",
      "https://push.example/phone",
    ]);
  });

  it("sends nothing for a member with no devices", async () => {
    expect(await push.pushToMember(memberId, { title: "ع", body: "س", url: "/" })).toBe(0);
    expect(attempts).toHaveLength(0);
  });

  it("deletes an expired subscription instead of retrying it", async () => {
    await addDevice("https://push.example/gone");
    await addDevice("https://push.example/live");
    // 410 Gone is the browser saying this device is finished.
    failWith["https://push.example/gone"] = 410;

    const delivered = await push.pushToMember(memberId, { title: "ع", body: "س", url: "/" });
    expect(delivered).toBe(1);

    const left = await prisma.pushSubscription.findMany({ where: { memberId } });
    expect(left.map((s) => s.endpoint)).toEqual(["https://push.example/live"]);
  });

  it("keeps a subscription that failed for a transient reason", async () => {
    await addDevice("https://push.example/flaky");
    // A 500 from the push service says nothing about the device.
    failWith["https://push.example/flaky"] = 500;

    expect(await push.pushToMember(memberId, { title: "ع", body: "س", url: "/" })).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { memberId } })).toBe(1);
  });

  it("never throws — a notification must not fail the request that caused it", async () => {
    await addDevice("https://push.example/broken");
    failWith["https://push.example/broken"] = 500;
    await expect(push.pushToMember(memberId, { title: "ع", body: "س", url: "/" })).resolves.toBe(0);
  });

  describe("what a push is allowed to say", () => {
    it("carries only a title, a line, and a link", async () => {
      await addDevice("https://push.example/phone");
      await push.pushToMember(memberId, {
        title: "عميل جاهز للبيع",
        body: "راجع المحادثة",
        url: "/leads/abc",
        tag: "HIGH_SCORE_LEAD:abc",
      });

      // Anything beyond these four keys would be a new decision about what
      // shows on a locked screen, and should be made deliberately.
      expect(Object.keys(attempts[0].payload).sort()).toEqual(["body", "tag", "title", "url"]);
    });
  });

  describe("notificationUrl", () => {
    it("opens the thing the notification is about", () => {
      expect(push.notificationUrl("conversation", "c1")).toBe("/inbox?c=c1");
      expect(push.notificationUrl("lead", "l1")).toBe("/leads/l1");
      expect(push.notificationUrl("task", "t1")).toBe("/tasks");
      expect(push.notificationUrl("appointment", "a1")).toBe("/appointments");
    });

    it("falls back to the feed rather than a broken link", () => {
      expect(push.notificationUrl(null, null)).toBe("/notifications");
      expect(push.notificationUrl("conversation", null)).toBe("/notifications");
      expect(push.notificationUrl("something-new", "x")).toBe("/notifications");
    });
  });

  describe("preferences decide delivery", () => {
    it("pushes only to members who want that type", async () => {
      const { createNotification } = await import("@/lib/notify");
      await addDevice("https://push.example/phone");

      // HIGH_SCORE_LEAD defaults to push on.
      await createNotification({
        organizationId: orgId,
        recipientMemberId: memberId,
        type: "HIGH_SCORE_LEAD",
        title: "عميل جاهز",
        entityType: "lead",
        entityId: "lead-1",
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].payload.url).toBe("/leads/lead-1");

      attempts.length = 0;
      await prisma.organizationMember.update({
        where: { id: memberId },
        data: { notificationPrefs: { HIGH_SCORE_LEAD: { inApp: true, email: false, push: false } } },
      });

      await createNotification({
        organizationId: orgId,
        recipientMemberId: memberId,
        type: "HIGH_SCORE_LEAD",
        title: "عميل جاهز",
      });
      expect(attempts).toHaveLength(0);
    });

    it("still records the notification when push is off", async () => {
      const { createNotification } = await import("@/lib/notify");
      await prisma.organizationMember.update({
        where: { id: memberId },
        data: { notificationPrefs: { HIGH_SCORE_LEAD: { inApp: true, email: false, push: false } } },
      });

      await createNotification({
        organizationId: orgId,
        recipientMemberId: memberId,
        type: "HIGH_SCORE_LEAD",
        title: "عميل جاهز",
      });

      // Muting a channel is a delivery choice, not an instruction to forget the
      // event happened.
      expect(await prisma.notification.count({ where: { organizationId: orgId } })).toBe(1);
    });
  });
});
