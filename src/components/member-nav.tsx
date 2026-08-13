'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/schedule', label: 'Book' },
  { href: '/today', label: 'Today' },
  { href: '/history', label: 'History' },
  { href: '/account/strikes', label: 'Account' },
];

export function MemberNav() {
  const pathname = usePathname();

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-10 mx-auto max-w-lg border-t border-edge bg-panel/95 backdrop-blur">
      <ul className="flex">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                // Generous hit target — this gets tapped with chalky hands.
                className={`flex flex-col items-center gap-1 px-2 py-3 text-xs font-semibold ${
                  active ? 'text-brand' : 'text-white/50'
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1 w-6 rounded-full ${active ? 'bg-brand' : 'bg-transparent'}`}
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
