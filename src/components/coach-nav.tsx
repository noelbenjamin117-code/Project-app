'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/coach', label: 'Today', exact: true },
  { href: '/coach/program', label: 'Programming' },
  { href: '/coach/templates', label: 'Schedule' },
  { href: '/coach/members', label: 'Members' },
  { href: '/coach/migration', label: 'Migration' },
];

export function CoachNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {LINKS.map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              active ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
