import { prisma } from "./db";
import { sendEmail } from "./email";

const EMAIL_TYPES = new Set(["HIGH_SCORE_LEAD", "COMPLAINT", "WEBHOOK_FAILED", "TOKEN_EXPIRING", "SLA_BREACH"]);

export async function createNotification(params: {
  organizationId: string;
  recipientMemberId?: string | null;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  await prisma.notification.create({ data: params as any });

  if (EMAIL_TYPES.has(params.type)) {
    const recipients = params.recipientMemberId
      ? await prisma.organizationMember.findMany({ where: { id: params.recipientMemberId }, include: { user: true } })
      : await prisma.organizationMember.findMany({
          where: { organizationId: params.organizationId, role: { in: ["ORG_ADMIN", "SALES_MANAGER"] }, status: "ACTIVE" },
          include: { user: true },
        });
    for (const r of recipients) {
      await sendEmail(r.user.email, `[Leadra] ${params.title}`, params.body ?? params.title);
    }
  }
}
