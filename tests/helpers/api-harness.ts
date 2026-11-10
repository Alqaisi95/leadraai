/**
 * Harness for exercising route handlers over the real request path.
 *
 * The existing unit tests all call library functions directly, which proves the
 * logic and proves nothing about the wiring. Tenant scoping, the session check,
 * CSRF, and the permission matrix are all applied by `withAuth` and by each
 * route's own first few lines — none of that is reachable without building an
 * actual request and handing it to the exported handler.
 *
 * So: two fully-populated organizations, a session per role, and a `call`
 * helper that assembles a NextRequest the way a browser would.
 */
import { NextRequest } from "next/server";
import { createHash, randomBytes } from "crypto";
import type { RoleKey } from "@/lib/rbac";

export type Actor = {
  userId: string;
  memberId: string;
  organizationId: string;
  role: RoleKey;
  sessionToken: string;
  csrf: string;
};

export type Tenant = {
  organizationId: string;
  admin: Actor;
  agent: Actor;
  viewer: Actor;
  leadId: string;
  unitId: string;
  projectId: string;
  taskId: string;
  conversationId: string;
  knowledgeSourceId: string;
  appointmentId: string;
  opportunityId: string;
  stageId: string;
  sequenceId: string;
  scheduleId: string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function buildTenant(prisma: any, label: string): Promise<Tenant> {
  const org = await prisma.organization.create({
    data: { name: `${label}-${Date.now()}-${randomBytes(3).toString("hex")}`, country: "IQ" },
  });

  async function actor(role: RoleKey, suffix: string): Promise<Actor> {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}-${randomBytes(4).toString("hex")}@example.test`,
        fullName: `${label} ${suffix}`,
        passwordHash: "not-used-by-these-tests",
        emailVerifiedAt: new Date(),
      },
    });
    const member = await prisma.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role, status: "ACTIVE", joinedAt: new Date() },
    });
    const sessionToken = randomBytes(24).toString("base64url");
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(sessionToken),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return {
      userId: user.id,
      memberId: member.id,
      organizationId: org.id,
      role,
      sessionToken,
      csrf: randomBytes(12).toString("hex"),
    };
  }

  const admin = await actor("ORG_ADMIN", "admin");
  const agent = await actor("AGENT", "agent");
  const viewer = await actor("VIEWER", "viewer");

  const pipeline = await prisma.pipeline.create({
    data: { organizationId: org.id, name: "مسار", isDefault: true },
  });
  const stage = await prisma.pipelineStage.create({
    data: { pipelineId: pipeline.id, name: "جديد", order: 1 },
  });

  const project = await prisma.project.create({
    data: { organizationId: org.id, name: `${label} مشروع`, projectType: "سكني" },
  });
  const building = await prisma.building.create({ data: { projectId: project.id, name: "بناية" } });
  const unit = await prisma.unit.create({
    data: {
      organizationId: org.id,
      projectId: project.id,
      buildingId: building.id,
      unitNumber: `${label}-1`,
      unitType: "شقة",
      price: 100000,
    },
  });

  // A conversation cannot exist without the integration it arrived through.
  const integration = await prisma.integration.create({
    data: {
      organizationId: org.id,
      provider: "INSTAGRAM",
      status: "CONNECTED",
      externalId: `ig-biz-${randomBytes(4).toString("hex")}`,
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      integrationId: integration.id,
      externalThreadId: `${label}-${randomBytes(4).toString("hex")}`,
      customerExternalId: `ig-${randomBytes(4).toString("hex")}`,
      assignedMemberId: agent.memberId,
    },
  });
  // Owned by the agent so the agent-visibility rules have something to allow.
  // The foreign key lives on Lead, not on Conversation.
  const lead = await prisma.lead.create({
    data: {
      organizationId: org.id,
      fullName: `${label} عميل`,
      ownerMemberId: agent.memberId,
      conversationId: conversation.id,
    },
  });
  const task = await prisma.task.create({
    data: {
      organizationId: org.id,
      title: `${label} مهمة`,
      assigneeMemberId: agent.memberId,
      dueAt: new Date(Date.now() + 86_400_000),
    },
  });
  const appointment = await prisma.appointment.create({
    data: {
      organizationId: org.id,
      leadId: lead.id,
      memberId: agent.memberId,
      startsAt: new Date(Date.now() + 86_400_000),
    },
  });
  const knowledgeSource = await prisma.knowledgeSource.create({
    data: { organizationId: org.id, title: `${label} معرفة`, type: "TEXT" },
  });
  const opportunity = await prisma.opportunity.create({
    data: { organizationId: org.id, leadId: lead.id, pipelineId: pipeline.id, stageId: stage.id },
  });
  const schedule = await prisma.scheduledReport.create({
    data: {
      organizationId: org.id,
      createdByMemberId: admin.memberId,
      report: "leads",
      frequency: "WEEKLY",
      recipientMemberIds: [admin.memberId],
      nextRunAt: new Date(Date.now() + 86_400_000),
    },
  });
  const sequence = await prisma.sequence.create({
    data: {
      organizationId: org.id,
      name: `${label} متابعة`,
      steps: { create: [{ order: 1, delayHours: 0, action: "SEND_MESSAGE", body: "تذكير" }] },
    },
  });

  return {
    organizationId: org.id,
    admin,
    agent,
    viewer,
    leadId: lead.id,
    unitId: unit.id,
    projectId: project.id,
    taskId: task.id,
    conversationId: conversation.id,
    knowledgeSourceId: knowledgeSource.id,
    appointmentId: appointment.id,
    opportunityId: opportunity.id,
    stageId: stage.id,
    sequenceId: sequence.id,
    scheduleId: schedule.id,
  };
}

export async function destroyTenant(prisma: any, tenant: Tenant) {
  // Cascades from the organization clear everything except the users, which are
  // global and only linked to it by membership.
  const userIds = [tenant.admin.userId, tenant.agent.userId, tenant.viewer.userId];
  await prisma.organization.deleteMany({ where: { id: tenant.organizationId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

export interface CallOptions {
  /** Omit to send no session cookie at all — the unauthenticated case. */
  actor?: Actor;
  method?: string;
  body?: unknown;
  /** Overrides the org header; use to point one tenant's session at another. */
  organizationId?: string;
  /** Send a CSRF header that does not match the cookie. */
  breakCsrf?: boolean;
}

/** Build the request a browser would send, and hand it to the handler. */
export async function call(
  handler: (req: NextRequest) => Promise<Response>,
  path: string,
  opts: CallOptions = {},
) {
  const method = opts.method ?? "GET";
  const headers = new Headers({ "content-type": "application/json" });

  if (opts.actor) {
    const orgId = opts.organizationId ?? opts.actor.organizationId;
    headers.set("cookie", `leadra_session=${opts.actor.sessionToken}; leadra_csrf=${opts.actor.csrf}`);
    headers.set("x-organization-id", orgId);
    if (method !== "GET") {
      headers.set("x-csrf-token", opts.breakCsrf ? "a-different-value" : opts.actor.csrf);
    }
  }

  const req = new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });

  const res = await handler(req);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* some routes stream or return plain text */
  }
  return { status: res.status, json, text, headers: res.headers };
}
