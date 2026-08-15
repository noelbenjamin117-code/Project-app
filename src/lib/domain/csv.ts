/**
 * A small CSV reader, and the mapping from a gym-platform export onto the
 * handful of fields this app actually wants.
 *
 * Written by hand rather than pulled in as a dependency: this parses one file,
 * once, during a migration, and a spreadsheet export is a well-behaved dialect.
 */

/** Split CSV text into rows, honouring quotes, escaped quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a byte-order mark, which Excel loves to add and which otherwise
  // becomes part of the first column's name.
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty — trailing newlines produce them.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Normalise a header for matching: lowercase, letters and digits only. */
function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Find a column by any of several likely names. Exports vary between
 * platforms and between versions of the same platform, so matching is
 * forgiving rather than exact.
 */
function findColumn(headers: string[], candidates: string[]): number {
  const normalised = headers.map(normalise);
  for (const candidate of candidates) {
    const index = normalised.indexOf(normalise(candidate));
    if (index !== -1) return index;
  }
  return -1;
}

export interface ImportRow {
  name: string;
  email: string;
  phone: string | null;
  legacyPlan: string | null;
  /** Excluded from import: pay-as-you-go people are not members. */
  dropInsOnly: boolean;
  /** Row number in the file, for reporting problems back. */
  line: number;
}

export interface ParseResult {
  rows: ImportRow[];
  /** Rows that could not be used, with the reason. */
  problems: Array<{ line: number; reason: string }>;
  /** Headers found in the file, so the UI can say what it saw. */
  headers: string[];
}

const EMAIL_COLUMNS = ['email', 'email address', 'e-mail', 'member email'];
const NAME_COLUMNS = ['name', 'full name', 'member name', 'member'];
const FIRST_NAME_COLUMNS = ['first name', 'firstname', 'forename', 'given name'];
const LAST_NAME_COLUMNS = ['last name', 'lastname', 'surname', 'family name'];
const PHONE_COLUMNS = ['phone number', 'phone', 'mobile', 'telephone', 'contact number'];
const PLAN_COLUMNS = ['primary product', 'product', 'membership', 'plan', 'membership type'];
const DROPIN_COLUMNS = ['dropins only', 'drop ins only', 'drop-ins only', 'dropin only'];

/**
 * Turn an export into the rows worth importing.
 *
 * Only four things are taken: name, email, phone and which plan they were on.
 * A typical export also carries date of birth, address, gender, emergency
 * contacts and insurance details — none of which this app uses. Importing
 * personal data you have no use for creates an obligation to look after it for
 * no benefit, so it is left in the file.
 */
export function parseMemberExport(text: string): ParseResult {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { rows: [], problems: [{ line: 0, reason: 'The file is empty.' }], headers: [] };
  }

  const headers = rows[0].map((h) => h.trim());
  const emailAt = findColumn(headers, EMAIL_COLUMNS);
  const nameAt = findColumn(headers, NAME_COLUMNS);
  const firstAt = findColumn(headers, FIRST_NAME_COLUMNS);
  const lastAt = findColumn(headers, LAST_NAME_COLUMNS);
  const phoneAt = findColumn(headers, PHONE_COLUMNS);
  const planAt = findColumn(headers, PLAN_COLUMNS);
  const dropInAt = findColumn(headers, DROPIN_COLUMNS);

  const problems: ParseResult['problems'] = [];

  if (emailAt === -1) {
    problems.push({ line: 1, reason: 'No email column found. Every member needs an email.' });
  }
  if (nameAt === -1 && firstAt === -1) {
    problems.push({
      line: 1,
      reason: 'No name column found. Add a Name column, or First Name and Last Name.',
    });
  }
  if (problems.length > 0) return { rows: [], problems, headers };

  const seen = new Set<string>();
  const parsed: ImportRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const line = i + 1;
    const at = (index: number) => (index === -1 ? '' : (cells[index] ?? '').trim());

    const email = at(emailAt).toLowerCase();
    const name =
      nameAt !== -1 ? at(nameAt) : [at(firstAt), at(lastAt)].filter(Boolean).join(' ');

    if (!email) {
      problems.push({ line, reason: 'No email address.' });
      continue;
    }
    if (!email.includes('@') || email.includes(' ')) {
      problems.push({ line, reason: `"${email}" doesn't look like an email address.` });
      continue;
    }
    if (!name) {
      problems.push({ line, reason: `No name for ${email}.` });
      continue;
    }
    if (seen.has(email)) {
      problems.push({ line, reason: `${email} appears more than once — keeping the first.` });
      continue;
    }
    seen.add(email);

    const dropIn = at(dropInAt).toLowerCase();

    parsed.push({
      name,
      email,
      phone: at(phoneAt) || null,
      legacyPlan: at(planAt) || null,
      dropInsOnly: dropIn === 'true' || dropIn === 'yes' || dropIn === '1',
      line,
    });
  }

  return { rows: parsed, problems, headers };
}
