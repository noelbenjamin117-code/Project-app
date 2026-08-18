import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { AppError } from '@/lib/errors';
import { hashPassword } from '@/lib/password';
import { parseMemberExport, type ImportRow } from '@/lib/domain/csv';
import { computeMembershipState } from '@/lib/domain/membership';

const DAY_MS = 86_400_000;

export interface ImportOptions {
  /**
   * Give everyone imported a membership override for this many days.
   *
   * Booking is gated on membership, so without this a hard switch-off locks
   * every member out on day one — the gym floor becomes a support desk. The
   * override lets them keep training while their subscription lands, and it
   * expires on its own.
   */
  graceDays: number;
  /** Skip anyone the export marks as pay-as-you-go. They are not members. */
  skipDropIns: boolean;
  /** Preview only: parse and report, change nothing. */
  dryRun: boolean;
}

export interface ImportSummary {
  parsed: number;
  created: number;
  alreadyExisted: number;
  skippedDropIns: number;
  problems: Array<{ line: number; reason: string }>;
  headers: string[];
  /** Sample of what would be created, for a dry run. */
  preview: Array<{ name: string; email: string; legacyPlan: string | null }>;
}

/**
 * Import members from a gym-platform export.
 *
 * Accounts are created without a usable password: members arrive through a
 * claim link rather than being told a password, so there is never a shared
 * secret in an email that someone forwards.
 */
export async function importMembers(
  actor: SessionUser,
  csvText: string,
  options: ImportOptions,
): Promise<ImportSummary> {
  assertCan(actor, 'manageUsers');

  const { rows, problems, headers } = parseMemberExport(csvText);

  const usable = options.skipDropIns ? rows.filter((r) => !r.dropInsOnly) : rows;
  const skippedDropIns = rows.length - usable.length;

  const summary: ImportSummary = {
    parsed: rows.length,
    created: 0,
    alreadyExisted: 0,
    skippedDropIns,
    problems,
    headers,
    preview: usable.slice(0, 10).map((r) => ({
      name: r.name,
      email: r.email,
      legacyPlan: r.legacyPlan,
    })),
  };

  if (options.dryRun || usable.length === 0) return summary;

  const existing = await prisma.user.findMany({
    where: { email: { in: usable.map((r) => r.email) } },
    select: { email: true },
  });
  const existingEmails = new Set(existing.map((u) => u.email));

  for (const row of usable) {
    if (existingEmails.has(row.email)) {
      summary.alreadyExisted++;
      continue;
    }
    await createImportedMember(actor, row, options.graceDays);
    summary.created++;
  }

  return summary;
}

async function createImportedMember(
  actor: SessionUser,
  row: ImportRow,
  graceDays: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: row.email,
        name: row.name,
        phone: row.phone,
        legacyPlan: row.legacyPlan,
        role: 'MEMBER',
        // A long random value nobody knows, including us. They get in through
        // their claim link and choose a password there.
        passwordHash: await hashPassword(randomBytes(32).toString('hex')),
      },
    });

    if (graceDays > 0) {
      await tx.membershipOverride.create({
        data: {
          memberId: user.id,
          activeUntil: new Date(Date.now() + graceDays * DAY_MS),
          reason: `Migrating — ${graceDays} days to set up payment`,
          byUserId: actor.id,
        },
      });
    }

    await tx.claimToken.create({
      data: {
        token: newToken(),
        userId: user.id,
        // Comfortably longer than the migration window, so a link found in an
        // old email still works rather than dead-ending.
        expiresAt: new Date(Date.now() + 60 * DAY_MS),
      },
    });
  });
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

export type MigrationState = 'NOT_CLAIMED' | 'CLAIMED_NOT_PAID' | 'CLAIMED_AND_PAID';

export interface MigrationRow {
  userId: string;
  name: string;
  email: string;
  legacyPlan: string | null;
  state: MigrationState;
  claimedAt: Date | null;
  sentCount: number;
  lastSentAt: Date | null;
  /** Grace override running, and when it runs out. */
  graceUntil: Date | null;
  claimUrl: string | null;
}

export interface MigrationOverview {
  rows: MigrationRow[];
  counts: Record<MigrationState, number>;
}

/**
 * Who has claimed, who has paid, and who has done neither.
 *
 * Sorted so that the group actually costing the gym money — claimed but not
 * paying — comes first.
 */
export async function getMigrationOverview(
  actor: SessionUser,
  baseUrl: string,
  now: Date = new Date(),
): Promise<MigrationOverview> {
  assertCan(actor, 'manageUsers');

  const users = await prisma.user.findMany({
    where: { role: 'MEMBER', claimTokens: { some: {} } },
    include: {
      membership: true,
      membershipOverrides: true,
      claimTokens: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const rows: MigrationRow[] = users.map((user) => {
    const token = user.claimTokens[0];
    const claimedAt = token?.usedAt ?? null;

    const membershipState = computeMembershipState(
      user.membership,
      user.membershipOverrides.map((o) => ({
        id: o.id,
        activeUntil: o.activeUntil,
        reason: o.reason,
        revokedAt: o.revokedAt,
      })),
      now,
    );

    // Paid means Stripe says so. A migration grace override lets them book,
    // but it is not payment, and treating it as such would hide exactly the
    // people the gym needs to chase.
    const paid =
      membershipState.status === 'ACTIVE' ||
      membershipState.status === 'TRIALING' ||
      membershipState.status === 'PAST_DUE';

    const activeOverride = user.membershipOverrides
      .filter((o) => !o.revokedAt && o.activeUntil > now)
      .sort((a, b) => b.activeUntil.getTime() - a.activeUntil.getTime())[0];

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      legacyPlan: user.legacyPlan,
      state: !claimedAt ? 'NOT_CLAIMED' : paid ? 'CLAIMED_AND_PAID' : 'CLAIMED_NOT_PAID',
      claimedAt,
      sentCount: token?.sentCount ?? 0,
      lastSentAt: token?.lastSentAt ?? null,
      graceUntil: activeOverride?.activeUntil ?? null,
      claimUrl: token && !token.usedAt ? `${baseUrl}/claim/${token.token}` : null,
    };
  });

  const order: Record<MigrationState, number> = {
    CLAIMED_NOT_PAID: 0,
    NOT_CLAIMED: 1,
    CLAIMED_AND_PAID: 2,
  };
  rows.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));

  return {
    rows,
    counts: {
      NOT_CLAIMED: rows.filter((r) => r.state === 'NOT_CLAIMED').length,
      CLAIMED_NOT_PAID: rows.filter((r) => r.state === 'CLAIMED_NOT_PAID').length,
      CLAIMED_AND_PAID: rows.filter((r) => r.state === 'CLAIMED_AND_PAID').length,
    },
  };
}

/**
 * Claim links as a CSV, for sending through whatever already reaches members.
 *
 * The app deliberately does not send these itself: a brand-new sending domain
 * mailing every member at once is a deliverability gamble taken on the worst
 * possible day.
 */
export async function exportClaimLinks(
  actor: SessionUser,
  baseUrl: string,
  options: { onlyUnclaimed: boolean } = { onlyUnclaimed: true },
): Promise<string> {
  assertCan(actor, 'manageUsers');

  const overview = await getMigrationOverview(actor, baseUrl);
  const rows = options.onlyUnclaimed
    ? overview.rows.filter((r) => r.state === 'NOT_CLAIMED')
    : overview.rows;

  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = ['name,email,claim_link,old_plan'];
  for (const row of rows) {
    lines.push(
      [row.name, row.email, row.claimUrl ?? '', row.legacyPlan ?? ''].map(escape).join(','),
    );
  }

  // Recording that the invite went out is what makes "resend to whoever hasn't
  // opened it" possible later.
  await prisma.claimToken.updateMany({
    where: { userId: { in: rows.map((r) => r.userId) }, usedAt: null },
    data: { sentCount: { increment: 1 }, lastSentAt: new Date() },
  });

  return lines.join('\n');
}

/** Issue a fresh link for someone whose token expired or went astray. */
export async function regenerateClaimToken(
  actor: SessionUser,
  userId: string,
): Promise<string> {
  assertCan(actor, 'manageUsers');

  const token = newToken();
  await prisma.claimToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + 60 * DAY_MS) },
  });
  return token;
}

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

export interface ClaimTarget {
  userId: string;
  name: string;
  email: string;
}

/** Look up a claim link without consuming it, so the page can show who it is for. */
export async function peekClaim(token: string): Promise<ClaimTarget> {
  const row = await prisma.claimToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!row) throw new AppError('That link isn’t valid.', 404, 'CLAIM_INVALID');
  if (row.usedAt) {
    throw new AppError(
      'That link has already been used. Sign in instead, or ask us for a new one.',
      410,
      'CLAIM_USED',
    );
  }
  if (row.expiresAt < new Date()) {
    throw new AppError('That link has expired. Ask us for a new one.', 410, 'CLAIM_EXPIRED');
  }

  return { userId: row.user.id, name: row.user.name, email: row.user.email };
}

/**
 * Consume a claim link and set the member's password.
 *
 * The token is marked used inside the same transaction that sets the password,
 * so a link shared around cannot be redeemed twice.
 */
export async function claimAccount(token: string, password: string): Promise<string> {
  if (password.length < 8) {
    throw new AppError('Use at least 8 characters.', 422, 'WEAK_PASSWORD');
  }

  const hash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const row = await tx.claimToken.findUnique({ where: { token } });
    if (!row) throw new AppError('That link isn’t valid.', 404, 'CLAIM_INVALID');
    if (row.usedAt) throw new AppError('That link has already been used.', 410, 'CLAIM_USED');
    if (row.expiresAt < new Date()) {
      throw new AppError('That link has expired. Ask us for a new one.', 410, 'CLAIM_EXPIRED');
    }

    await tx.claimToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash: hash },
    });

    return row.userId;
  });
}
