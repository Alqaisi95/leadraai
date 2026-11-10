/**
 * Team invitations.
 *
 * The raw token is returned to the caller once and never stored — only its
 * SHA-256 hash lands in the database, so a dump cannot be replayed into working
 * invitations. Same reasoning as session tokens elsewhere in this codebase.
 */
import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";

const INVITE_TTL_HOURS = 72;

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteUrl(token: string) {
  return `${process.env.APP_URL ?? ""}/invite/${token}`;
}

/** Seats already taken against the plan limit — invited members occupy a seat. */
export async function seatsInUse(organizationId: string) {
  return prisma.organizationMember.count({
    where: { organizationId, status: { in: ["ACTIVE", "INVITED"] } },
  });
}

export async function seatLimit(organizationId: string): Promise<number | null> {
  const sub = await prisma.subscription.findFirst({ where: { organizationId } });
  const limit = (sub?.limits as { users?: number } | null)?.users;
  return typeof limit === "number" ? limit : null;
}

export interface InviteResult {
  memberId: string;
  token: string;
  url: string;
  expiresAt: Date;
  reused: boolean;
}

/**
 * Invite by email. If the person already has a Leadra account they are attached
 * to this organization without touching their existing password; if they were
 * already invited here, the invitation is re-issued rather than duplicated.
 */
export async function createInvite(params: {
  organizationId: string;
  email: string;
  fullName: string;
  role: "ORG_ADMIN" | "SALES_MANAGER" | "AGENT" | "MARKETING" | "VIEWER";
  invitedByEmail: string;
}): Promise<InviteResult> {
  const email = params.email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, fullName: params.fullName.trim(), language: "AR" },
    update: {},
  });

  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: params.organizationId, userId: user.id } },
  });

  if (existing?.status === "ACTIVE") {
    throw new AlreadyMemberError();
  }

  const member = existing
    ? await prisma.organizationMember.update({
        where: { id: existing.id },
        data: {
          role: params.role,
          status: "INVITED",
          invitedByEmail: params.invitedByEmail,
          inviteTokenHash: hashInviteToken(token),
          inviteExpiresAt: expiresAt,
        },
      })
    : await prisma.organizationMember.create({
        data: {
          organizationId: params.organizationId,
          userId: user.id,
          role: params.role,
          status: "INVITED",
          invitedByEmail: params.invitedByEmail,
          inviteTokenHash: hashInviteToken(token),
          inviteExpiresAt: expiresAt,
        },
      });

  return { memberId: member.id, token, url: inviteUrl(token), expiresAt, reused: Boolean(existing) };
}

export class AlreadyMemberError extends Error {
  constructor() {
    super("ALREADY_MEMBER");
  }
}

export interface InvitePreview {
  memberId: string;
  organizationName: string;
  email: string;
  fullName: string;
  role: string;
  /** true when the person already has a password and only needs to accept */
  hasAccount: boolean;
}

export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const member = await prisma.organizationMember.findUnique({
    where: { inviteTokenHash: hashInviteToken(token) },
    include: { organization: { select: { name: true } }, user: true },
  });
  if (!member || member.status !== "INVITED") return null;
  if (!member.inviteExpiresAt || member.inviteExpiresAt < new Date()) return null;

  return {
    memberId: member.id,
    organizationName: member.organization.name,
    email: member.user.email,
    fullName: member.user.fullName,
    role: member.role,
    hasAccount: Boolean(member.user.passwordHash),
  };
}

/** Consume the invitation: set a password if needed, activate the membership. */
export async function acceptInvite(token: string, passwordHash?: string) {
  const member = await prisma.organizationMember.findUnique({
    where: { inviteTokenHash: hashInviteToken(token) },
    include: { user: true },
  });
  if (!member || member.status !== "INVITED") return null;
  if (!member.inviteExpiresAt || member.inviteExpiresAt < new Date()) return null;
  // an account without a password must set one now, or it could never sign in
  if (!member.user.passwordHash && !passwordHash) return null;

  await prisma.$transaction([
    ...(passwordHash ? [prisma.user.update({ where: { id: member.userId }, data: { passwordHash } })] : []),
    prisma.organizationMember.update({
      where: { id: member.id },
      data: { status: "ACTIVE", joinedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
    }),
  ]);

  return { email: member.user.email, organizationId: member.organizationId };
}
