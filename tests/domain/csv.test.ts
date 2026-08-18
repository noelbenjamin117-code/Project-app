import { describe, expect, it } from 'vitest';
import { parseCsv, parseMemberExport } from '@/lib/domain/csv';

describe('reading CSV', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('name,address\n"Fitzgerald, Jamie","1 High St, London"')).toEqual([
      ['name', 'address'],
      ['Fitzgerald, Jamie', '1 High St, London'],
    ]);
  });

  it('handles escaped quotes and newlines inside fields', () => {
    expect(parseCsv('note\n"He said ""hi""\nthen left"')).toEqual([
      ['note'],
      ['He said "hi"\nthen left'],
    ]);
  });

  it('copes with Windows line endings and a byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops blank trailing rows', () => {
    expect(parseCsv('a\n1\n\n')).toEqual([['a'], ['1']]);
  });
});

/** Shaped like the export B42 gets from its current platform. */
const REAL_EXPORT = [
  'Name,Home Location,Email,Phone Number,Gender,Date of Birth,Emergency Contact Name,Emergency Contact Number,Address Line 1,Address Line 2,City,Region,Postcode,Country,State,Dropins only,Insurance Provider,Imported,First Activated,Last Active,Accepted Mailing List,Primary Product,Has Multiple Products',
  'Jamie Fitzgerald,B42,jamie@example.com,07700900001,F,1990-04-02,Sam,07700900002,1 High St,,London,,E1 6AN,UK,,false,,false,2023-01-04,2026-08-10,true,B42 Tier 1,false',
  'Alex Okafor,B42,ALEX@EXAMPLE.COM,07700900003,M,1988-11-20,Kim,07700900004,2 Low Rd,Flat 3,London,,E2 7BB,UK,,false,,false,2024-06-01,2026-08-12,false,Unlimited,false',
  'Casual Chris,B42,chris@example.com,07700900005,M,1995-02-02,Jo,07700900006,3 Mid Way,,London,,E3 8CC,UK,,true,,false,2025-01-01,2026-08-01,false,,false',
].join('\n');

describe('reading a member export', () => {
  it('takes only the fields the app needs', () => {
    const { rows } = parseMemberExport(REAL_EXPORT);
    const jamie = rows.find((r) => r.email === 'jamie@example.com')!;

    expect(jamie.name).toBe('Jamie Fitzgerald');
    expect(jamie.phone).toBe('07700900001');
    expect(jamie.legacyPlan).toBe('B42 Tier 1');

    // Date of birth, address, gender, emergency contacts and insurance are all
    // in the file and all deliberately ignored.
    expect(Object.keys(jamie).sort()).toEqual([
      'dropInsOnly',
      'email',
      'legacyPlan',
      'line',
      'name',
      'phone',
    ]);
  });

  it('lower-cases emails so they match however they were typed', () => {
    const { rows } = parseMemberExport(REAL_EXPORT);
    expect(rows.some((r) => r.email === 'alex@example.com')).toBe(true);
  });

  it('marks drop-ins so they can be left out', () => {
    const { rows } = parseMemberExport(REAL_EXPORT);
    expect(rows.find((r) => r.email === 'chris@example.com')?.dropInsOnly).toBe(true);
    expect(rows.find((r) => r.email === 'jamie@example.com')?.dropInsOnly).toBe(false);
  });

  it('reports the columns it saw, so a wrong file is obvious', () => {
    const { headers } = parseMemberExport(REAL_EXPORT);
    expect(headers).toContain('Primary Product');
    expect(headers).toContain('Date of Birth');
  });
});

describe('when the export is shaped differently', () => {
  it('joins separate first and last name columns', () => {
    const { rows } = parseMemberExport(
      'First Name,Last Name,Email\nJamie,Fitzgerald,jamie@example.com',
    );
    expect(rows[0].name).toBe('Jamie Fitzgerald');
  });

  it('matches column names regardless of case, spacing or punctuation', () => {
    const { rows } = parseMemberExport('  FULL NAME ,e-mail\nJamie Fitzgerald,jamie@example.com');
    expect(rows[0].name).toBe('Jamie Fitzgerald');
    expect(rows[0].email).toBe('jamie@example.com');
  });

  it('says clearly when there is no email column', () => {
    const { rows, problems } = parseMemberExport('Name,Phone\nJamie,07700900001');
    expect(rows).toHaveLength(0);
    expect(problems[0].reason).toMatch(/email column/i);
  });

  it('says clearly when there is no name column', () => {
    const { rows, problems } = parseMemberExport('Email,Phone\njamie@example.com,07700900001');
    expect(rows).toHaveLength(0);
    expect(problems[0].reason).toMatch(/name column/i);
  });
});

describe('rows that cannot be used', () => {
  it('reports them by line number and carries on with the rest', () => {
    const { rows, problems } = parseMemberExport(
      [
        'Name,Email',
        'Jamie Fitzgerald,jamie@example.com',
        'No Email Person,',
        'Bad Address,not-an-email',
        ',orphan@example.com',
        'Duplicate Jamie,jamie@example.com',
        'Alex Okafor,alex@example.com',
      ].join('\n'),
    );

    // The two good rows still import.
    expect(rows.map((r) => r.email)).toEqual(['jamie@example.com', 'alex@example.com']);

    expect(problems.map((p) => p.line)).toEqual([3, 4, 5, 6]);
    expect(problems[0].reason).toMatch(/no email/i);
    expect(problems[1].reason).toMatch(/doesn't look like an email/i);
    expect(problems[2].reason).toMatch(/no name/i);
    expect(problems[3].reason).toMatch(/more than once/i);
  });

  it('handles an empty file without throwing', () => {
    const { rows, problems } = parseMemberExport('');
    expect(rows).toHaveLength(0);
    expect(problems[0].reason).toMatch(/empty/i);
  });
});
