'use client';

// Sidebar on desktop, bottom tab bar on mobile — matching how the real app works.
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/components/AuthGuard';
import {
  forget,
  markLeft,
  pruneExpired,
  recall,
  remember,
  sectionFor,
  type Section,
} from '@/lib/sectionMemory';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const icon = (path: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: icon('M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5') },
  { href: '/accounts', label: 'Accounts', icon: icon('M3 7h18v12H3zM3 11h18M7 15h4') },
  { href: '/subscriptions', label: 'Subscriptions', icon: icon('M12 3v18M4.5 7.5h15M4.5 16.5h15') },
  { href: '/plans', label: 'Plans', icon: icon('M4 6h16M4 12h16M4 18h10') },
  { href: '/credit', label: 'Credit', icon: icon('M3 12a9 9 0 0 1 18 0M12 12l4.5-3') },
  { href: '/alerts', label: 'Alerts', icon: icon('M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0') },
];

function NavInner() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const { session } = useSession();

  // Record where we are, and start the expiry clock on whichever section we just
  // left, so a position only survives if the user comes back promptly.
  const previousSection = useRef<Section | null>(null);

  useEffect(() => {
    const query = search.toString();
    const current = sectionFor(pathname);

    if (previousSection.current && previousSection.current !== current) {
      markLeft(previousSection.current);
    }
    previousSection.current = current;

    remember(pathname, query ? `?${query}` : '');
    pruneExpired();
  }, [pathname, search]);

  // Poll so the badge reflects alerts raised by a simulated renewal elsewhere.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .alerts()
        .then((data) => !cancelled && setUnread(data.unread))
        .catch(() => undefined);

    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  /**
   * Tapping a section you're not in restores where you left off. Tapping the
   * section you're already in resets it to the top — the standard tab-bar
   * gesture, and the way back out of a detail page without the back button.
   */
  const navigate = useCallback(
    (event: React.MouseEvent, href: string) => {
      event.preventDefault();
      const section = sectionFor(href) as Section | null;
      if (!section) {
        router.push(href);
        return;
      }

      if (isActive(href)) {
        forget(section);
        router.push(`/${section}`);
        return;
      }

      router.push(recall(section));
    },
    // isActive closes over pathname, which is the only changing input.
    [pathname, router],
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white px-4 py-6 lg:flex">
        <Link href="/dashboard" className="mb-8 px-3">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-500">
            Capital One
          </span>
          <span className="text-2xl font-semibold tracking-tight text-navy-700">Flow</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1" aria-label="Main navigation">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => navigate(event, item.href)}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? 'bg-navy-600 text-white'
                  : 'text-navy-600 hover:bg-navy-50 hover:text-navy-800'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.href === '/alerts' && unread > 0 && (
                <span className="ml-auto rounded-full bg-brand-500 px-1.5 py-0.5 text-[11px] font-bold text-white tnum">
                  {unread}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="space-y-2">
          <Link href="/transfer" className="btn-ghost w-full">
            Transfer money
          </Link>

          <Link
            href="/settings"
            aria-current={isActive('/settings') ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
              isActive('/settings') ? 'bg-navy-50' : 'hover:bg-navy-50'
            }`}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-600 text-xs font-bold text-white"
              aria-hidden="true"
            >
              {session.customer.initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-navy-800">
                {session.customer.firstName} {session.customer.lastName}
              </span>
              <span className="block text-[11px] text-navy-500">Settings</span>
            </span>
          </Link>
        </div>
      </aside>

      {/* Mobile top bar: the bottom tabs are full, so the account lives up here. */}
      {/* Rendered outside <main>, so it spans the viewport without negative margins. */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:hidden">
        <Link href="/dashboard" className="leading-none">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">
            Capital One
          </span>
          <span className="text-xl font-semibold tracking-tight text-navy-700">Flow</span>
        </Link>

        <Link
          href="/settings"
          aria-label="Account settings"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-600 text-xs font-bold text-white"
        >
          {session.customer.initials}
        </Link>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Main navigation"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={(event) => navigate(event, item.href)}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              isActive(item.href) ? 'text-navy-700' : 'text-navy-400'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.href === '/alerts' && unread > 0 && (
              <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
            )}
            {isActive(item.href) && (
              <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-navy-600" />
            )}
          </Link>
        ))}
      </nav>
    </>
  );
}

/** useSearchParams needs a Suspense boundary to prerender. */
export function Nav() {
  return (
    <Suspense fallback={null}>
      <NavInner />
    </Suspense>
  );
}
