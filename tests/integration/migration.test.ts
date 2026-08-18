import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimAccount,
  exportClaimLinks,
  getMigrationOverview,
  importMembers,
  peekClaim,
  regenerateClaimToken,
} from '@/lib/services/migration';
import { getMembershipState } from '@/lib/services/membership';
import { bookClass } from '@/lib/services/booking';
import { authenticate } from '@/lib/auth';
import { createUser as makeUser, createClass, prisma, resetDb } from './helpers';

beforeEach(async () => {
  await prisma.claimToken.deleteMany();
  await prisma.membershipOverride.deleteMany();
  await prisma.membership.deleteMany();
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const EXPORT = [
  'Name,Email,Phone Number,Date of Birth,Dropins only,Primary Product',
  'Jamie Fitzgerald,jamie@example.com,07700900001,1990-04-02,false,B42 Tier 1',
  'Alex Okafor,alex@example.com,07700900003,1988-11-20,false,Unlimited',
  'Casual Chris,chris@example.com,07700900005,1995-02-02,true,',
].join('\n');

const options = { graceDays: 30, skipDropIns: true, dryRun: false };

describe('importing members', () => {
  it('creates accounts and leaves drop-ins out', async () => {
    const owner = await makeUser('OWNER');

    const summary = await importMembers(owner, EXPORT, options);

    expect(summary.created).toBe(2);
    expect(summary.skippedDropIns).toBe(1);
    expect(await prisma.user.count({ where: { role: 'MEMBER' } })).toBe(2);
    expect(await prisma.user.findUnique({ where: { email: 'chris@example.com' } })).toBeNull();
  });

  it('keeps the old plan name so the gym knows what to sell them', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    expect(jamie.legacyPlan).toBe('B42 Tier 1');
    expect(jamie.phone).toBe('07700900001');
  });

  it('does not import personal data the app has no use for', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    // Date of birth was in the file. There is nowhere for it to go, on purpose.
    expect(JSON.stringify(jamie)).not.toContain('1990-04-02');
  });

  it('changes nothing on a dry run', async () => {
    const owner = await makeUser('OWNER');

    const summary = await importMembers(owner, EXPORT, { ...options, dryRun: true });

    expect(summary.parsed).toBe(3);
    expect(summary.created).toBe(0);
    expect(summary.preview.length).toBeGreaterThan(0);
    expect(await prisma.user.count({ where: { role: 'MEMBER' } })).toBe(0);
  });

  it('is safe to run twice — nobody is duplicated', async () => {
    const owner = await makeUser('OWNER');

    await importMembers(owner, EXPORT, options);
    const second = await importMembers(owner, EXPORT, options);

    expect(second.created).toBe(0);
    expect(second.alreadyExisted).toBe(2);
    expect(await prisma.user.count({ where: { email: 'jamie@example.com' } })).toBe(1);
  });

  it('refuses anyone who is not an owner', async () => {
    const coach = await makeUser('COACH');
    await expect(importMembers(coach, EXPORT, options)).rejects.toThrow(/permission/i);
  });
});

describe('the grace period on import', () => {
  it('lets an imported member book straight away, before they have paid', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    const state = await getMembershipState(jamie.id);

    expect(state.canBook).toBe(true);
    expect(state.source).toBe('OVERRIDE');

    const cls = await createClass({ capacity: 10 });
    const booking = await bookClass(
      { id: jamie.id, email: jamie.email, name: jamie.name, role: jamie.role },
      { classInstanceId: cls.id },
    );
    expect(booking.booking.status).toBe('BOOKED');
  });

  it('expires on its own, so nobody keeps training free forever', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, { ...options, graceDays: 7 });

    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });

    const inside = await getMembershipState(jamie.id, new Date(Date.now() + 6 * 86_400_000));
    expect(inside.canBook).toBe(true);

    const after = await getMembershipState(jamie.id, new Date(Date.now() + 8 * 86_400_000));
    expect(after.canBook).toBe(false);
  });

  it('can be skipped entirely', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, { ...options, graceDays: 0 });

    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    expect((await getMembershipState(jamie.id)).canBook).toBe(false);
  });
});

describe('claiming an account', () => {
  async function importedMember() {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    const token = await prisma.claimToken.findFirstOrThrow({ where: { userId: user.id } });
    return { owner, user, token };
  }

  it('shows who the link is for without using it up', async () => {
    const { token } = await importedMember();

    const target = await peekClaim(token.token);
    expect(target.email).toBe('jamie@example.com');

    const after = await prisma.claimToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(after.usedAt).toBeNull();
  });

  it('sets a password the member can then sign in with', async () => {
    const { user, token } = await importedMember();

    const claimedUserId = await claimAccount(token.token, 'my-own-password');
    expect(claimedUserId).toBe(user.id);

    const session = await authenticate('jamie@example.com', 'my-own-password');
    expect(session?.id).toBe(user.id);
  });

  it('cannot be used twice, even if the link gets passed around', async () => {
    const { token } = await importedMember();

    await claimAccount(token.token, 'my-own-password');
    await expect(claimAccount(token.token, 'someone-elses-password')).rejects.toThrow(
      /already been used/i,
    );

    // The first password still works — the second attempt changed nothing.
    expect(await authenticate('jamie@example.com', 'my-own-password')).not.toBeNull();
  });

  it('refuses an expired link, and explains rather than erroring', async () => {
    const { token } = await importedMember();
    await prisma.claimToken.update({
      where: { id: token.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(peekClaim(token.token)).rejects.toThrow(/expired/i);
    await expect(claimAccount(token.token, 'my-own-password')).rejects.toThrow(/expired/i);
  });

  it('refuses a made-up link', async () => {
    await expect(peekClaim('not-a-real-token')).rejects.toThrow(/isn’t valid/i);
  });

  it('refuses a password that is too short', async () => {
    const { token } = await importedMember();
    await expect(claimAccount(token.token, 'short')).rejects.toThrow(/8 characters/i);
  });

  it('lets the owner issue a fresh link if one goes astray', async () => {
    const { owner, user, token } = await importedMember();

    const fresh = await regenerateClaimToken(owner, user.id);
    expect(fresh).not.toBe(token.token);

    await expect(peekClaim(fresh)).resolves.toMatchObject({ email: 'jamie@example.com' });
  });
});

describe('the migration dashboard', () => {
  it('separates not claimed, claimed but not paid, and claimed and paid', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    let overview = await getMigrationOverview(owner, 'https://b42.test');
    expect(overview.counts.NOT_CLAIMED).toBe(2);
    expect(overview.counts.CLAIMED_NOT_PAID).toBe(0);

    // Jamie claims but does not pay.
    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    const jamieToken = await prisma.claimToken.findFirstOrThrow({ where: { userId: jamie.id } });
    await claimAccount(jamieToken.token, 'my-own-password');

    overview = await getMigrationOverview(owner, 'https://b42.test');
    expect(overview.counts.NOT_CLAIMED).toBe(1);
    expect(overview.counts.CLAIMED_NOT_PAID).toBe(1);

    // Then pays.
    await prisma.membership.create({
      data: { userId: jamie.id, status: 'ACTIVE', stripeCustomerId: 'cus_jamie' },
    });

    overview = await getMigrationOverview(owner, 'https://b42.test');
    expect(overview.counts.CLAIMED_AND_PAID).toBe(1);
    expect(overview.counts.CLAIMED_NOT_PAID).toBe(0);
  });

  it('does not count the migration grace as having paid', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    const token = await prisma.claimToken.findFirstOrThrow({ where: { userId: jamie.id } });
    await claimAccount(token.token, 'my-own-password');

    const overview = await getMigrationOverview(owner, 'https://b42.test');
    const row = overview.rows.find((r) => r.email === 'jamie@example.com')!;

    // They can book, but they have not paid — which is exactly who the gym
    // needs to be chasing.
    expect((await getMembershipState(jamie.id)).canBook).toBe(true);
    expect(row.state).toBe('CLAIMED_NOT_PAID');
    expect(row.graceUntil).not.toBeNull();
  });

  it('puts the people who owe money first', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    const token = await prisma.claimToken.findFirstOrThrow({ where: { userId: jamie.id } });
    await claimAccount(token.token, 'my-own-password');

    const overview = await getMigrationOverview(owner, 'https://b42.test');
    expect(overview.rows[0].state).toBe('CLAIMED_NOT_PAID');
  });

  it('refuses a coach', async () => {
    const coach = await makeUser('COACH');
    await expect(getMigrationOverview(coach, 'https://b42.test')).rejects.toThrow(/permission/i);
  });
});

describe('exporting claim links', () => {
  it('produces a CSV of links for whoever has not claimed', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    const csv = await exportClaimLinks(owner, 'https://b42.test');
    const lines = csv.split('\n');

    expect(lines[0]).toBe('name,email,claim_link,old_plan');
    expect(lines).toHaveLength(3);
    expect(csv).toContain('https://b42.test/claim/');
    expect(csv).toContain('B42 Tier 1');
  });

  it('records that the invite went out, so resends can be tracked', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    await exportClaimLinks(owner, 'https://b42.test');
    await exportClaimLinks(owner, 'https://b42.test');

    const overview = await getMigrationOverview(owner, 'https://b42.test');
    expect(overview.rows.every((r) => r.sentCount === 2)).toBe(true);
  });

  it('leaves out anyone who has already claimed', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(owner, EXPORT, options);

    const jamie = await prisma.user.findUniqueOrThrow({ where: { email: 'jamie@example.com' } });
    const token = await prisma.claimToken.findFirstOrThrow({ where: { userId: jamie.id } });
    await claimAccount(token.token, 'my-own-password');

    const csv = await exportClaimLinks(owner, 'https://b42.test');
    expect(csv).not.toContain('jamie@example.com');
    expect(csv).toContain('alex@example.com');
  });

  it('quotes names containing commas so the file stays readable', async () => {
    const owner = await makeUser('OWNER');
    await importMembers(
      owner,
      'Name,Email\n"Fitzgerald, Jamie",jamie@example.com',
      options,
    );

    const csv = await exportClaimLinks(owner, 'https://b42.test');
    expect(csv).toContain('"Fitzgerald, Jamie"');
  });
});
