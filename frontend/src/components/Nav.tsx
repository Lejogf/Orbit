'use client';

// Navigation: a sidebar column on desktop, a top bar plus tab bar on phones.
//
// The sidebar is a real column in the page grid, never an overlay, so growing
// the text can't make it cover the page. Your profile sits at the top, where
// it's visible without scrolling.
//
// On phones the tab bar counts how many tabs actually fit — a wide handset gets
// six, a small one gets four — so there is never a row of icons floating in
// empty space, and the least-used destinations fall back into More.
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/components/AuthGuard';
import { useAccessibility } from '@/lib/accessibility';
import { useRail, useUnreadAlerts } from '@/lib/uiState';
import { useT, type StringKey } from '@/lib/i18n';
import { QuickDisplay } from '@/components/QuickDisplay';
import { OrbitMark, OrbitWordmark } from '@/components/brand';
import { forget, markLeft, pruneExpired, recall, remember, sectionFor, type Section } from '@/lib/sectionMemory';

interface NavItem {
  href: string;
  label: StringKey;
  icon: React.ReactNode;
  /** Kept in Simple mode, which hides everything else. */
  essential?: boolean;
  tour?: string;
}

export const icon = (path: string, className = 'h-5 w-5') => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={`${className} shrink-0`}
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  accounts: 'M3 7h18v12H3zM3 11h18M7 15h4',
  cards: 'M2.5 8.5a3 3 0 0 1 3-3h13a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3zM2.5 10.5h19M6 15h3',
  pay: 'M12 4v16M8 8h6a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h6',
  spending: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z',
  budget: 'M4 19V9M10 19V5M16 19v-6M22 19H2',
  invest: 'M4 17l5-6 4 3 6.5-8M15 6h5v5',
  rewards: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z',
  subscriptions: 'M12 3v18M4.5 7.5h15M4.5 16.5h15',
  plans: 'M4 6h16M4 12h16M4 18h10',
  credit: 'M3 12a9 9 0 0 1 18 0M12 12l4.5-3',
  travel: 'M10.5 13.5 3 11l1.5-1.5 7 1 4-4.5a2 2 0 0 1 3 3l-4.5 4 1 7L13.5 21 11 13.5M6 18l-2 2',
  split: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  alerts: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
  support: 'M12 21a9 9 0 1 0-9-9c0 1.6.4 3.1 1.2 4.4L3 21l4.6-1.2A9 9 0 0 0 12 21zM8 12h.01M12 12h.01M16 12h.01',
  accessibility: 'M12 4.5a1.5 1.5 0 1 0 0-.01M5 8.5l7 1.5 7-1.5M12 10v5l-3 5M12 15l3 5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  rail: 'M4 4h16v16H4zM9 4v16',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.9 14.6a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1 2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.7-1.1 2 2 0 1 1-2.8-2.8 1.6 1.6 0 0 0-1.1-2.7 2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7 2 2 0 1 1 2.8-2.8 1.6 1.6 0 0 0 2.7-1.1 2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.7 1.1 2 2 0 1 1 2.8 2.8 1.6 1.6 0 0 0 1.1 2.7 2 2 0 1 1 0 4 1.6 1.6 0 0 0-1.4 1z',
};

const GROUPS: { title: StringKey; items: NavItem[] }[] = [
  {
    title: 'nav.group.money',
    items: [
      { href: '/dashboard', label: 'nav.home', icon: icon(ICONS.home), essential: true, tour: 'home' },
      { href: '/accounts', label: 'nav.accounts', icon: icon(ICONS.accounts), essential: true, tour: 'accounts' },
      { href: '/cards', label: 'nav.cards', icon: icon(ICONS.cards), essential: true, tour: 'cards' },
      { href: '/pay', label: 'nav.pay', icon: icon(ICONS.pay), essential: true, tour: 'pay' },
    ],
  },
  {
    title: 'nav.group.understand',
    items: [
      { href: '/spending', label: 'nav.spending', icon: icon(ICONS.spending), tour: 'spending' },
      { href: '/budget', label: 'nav.budget', icon: icon(ICONS.budget), essential: true, tour: 'budget' },
      { href: '/subscriptions', label: 'nav.subscriptions', icon: icon(ICONS.subscriptions), essential: true, tour: 'subscriptions' },
      { href: '/credit', label: 'nav.credit', icon: icon(ICONS.credit) },
    ],
  },
  {
    title: 'nav.group.grow',
    items: [
      { href: '/invest', label: 'nav.invest', icon: icon(ICONS.invest), tour: 'invest' },
      { href: '/rewards', label: 'nav.rewards', icon: icon(ICONS.rewards), tour: 'rewards' },
      { href: '/travel', label: 'nav.travel', icon: icon(ICONS.travel) },
      { href: '/plans', label: 'nav.plans', icon: icon(ICONS.plans) },
    ],
  },
  {
    title: 'nav.group.keepUp',
    items: [
      { href: '/alerts', label: 'nav.alerts', icon: icon(ICONS.alerts), essential: true, tour: 'alerts' },
      { href: '/split', label: 'nav.split', icon: icon(ICONS.split) },
    ],
  },
];

const FOOTER: NavItem[] = [
  { href: '/support', label: 'nav.support', icon: icon(ICONS.support), essential: true, tour: 'support' },
  { href: '/settings/accessibility', label: 'nav.accessibility', icon: icon(ICONS.accessibility), essential: true, tour: 'accessibility' },
  { href: '/settings', label: 'nav.settings', icon: icon(ICONS.settings), essential: true },
];

/** Tab order, most-used first. How many are shown depends on the screen. */
const TAB_ORDER = ['/dashboard', '/accounts', '/pay', '/cards', '/spending', '/alerts'];

const ALL_ITEMS = [...GROUPS.flatMap((g) => g.items), ...FOOTER];

/** Roughly 72px per comfortable tab, keeping 4–6. */
function useTabCount(): number {
  const [count, setCount] = useState(4);
  useEffect(() => {
    const measure = () => setCount(Math.max(4, Math.min(6, Math.floor(window.innerWidth / 72))));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return count;
}

function useNav() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = useCallback(
    (href: string) => (href === '/settings' ? pathname === '/settings' : pathname === href || pathname.startsWith(`${href}/`)),
    [pathname],
  );

  /**
   * Tapping a section you're not in restores where you left off; tapping the
   * section you're already in resets it to the top.
   */
  const navigate = useCallback(
    (event: React.MouseEvent, href: string) => {
      const section = sectionFor(href) as Section | null;
      if (!section) return;
      event.preventDefault();
      if (isActive(href)) {
        forget(section);
        router.push(`/${section}`);
        return;
      }
      router.push(recall(section));
    },
    [isActive, router],
  );

  return { isActive, navigate };
}

/** Remembers where you were in each section as you move around. */
function NavMemory() {
  const pathname = usePathname();
  const search = useSearchParams();
  const previous = useRef<Section | null>(null);

  useEffect(() => {
    const query = search.toString();
    const current = sectionFor(pathname);
    if (previous.current && previous.current !== current) markLeft(previous.current);
    previous.current = current;
    remember(pathname, query ? `?${query}` : '');
    pruneExpired();
  }, [pathname, search]);

  return null;
}

/** useSearchParams needs a Suspense boundary to prerender. */
export function NavMemoryBoundary() {
  return (
    <Suspense fallback={null}>
      <NavMemory />
    </Suspense>
  );
}

export function Sidebar() {
  const t = useT();
  const { settings } = useAccessibility();
  const { collapsed, toggle } = useRail();
  const unread = useUnreadAlerts();
  const { isActive, navigate } = useNav();
  const { session } = useSession();

  const visible = (items: NavItem[]) => (settings.simpleMode ? items.filter((i) => i.essential) : items);

  const item = (entry: NavItem) => {
    const active = isActive(entry.href);
    const label = t(entry.label);
    const badge = entry.href === '/alerts' && unread > 0;

    return (
      <li key={entry.href} className="group relative">
        <Link
          href={entry.href}
          onClick={(event) => navigate(event, entry.href)}
          aria-current={active ? 'page' : undefined}
          aria-label={collapsed ? `${label}${badge ? `, ${unread} unread` : ''}` : undefined}
          data-tour={entry.tour}
          className={`flex items-center rounded-xl font-medium transition-all duration-200 ease-spring ${
            collapsed ? 'h-11 w-11 justify-center' : 'gap-3 px-3 py-2.5 text-[0.9375rem]'
          } ${
            active
              ? 'bg-ink-900 text-canvas shadow-card'
              : 'text-ink-600 hover:bg-surface-sunken hover:text-ink-900'
          }`}
        >
          <span className="relative">
            {entry.icon}
            {collapsed && badge && <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-danger-500 ring-2 ring-surface" />}
          </span>
          {!collapsed && <span className="truncate">{label}</span>}
          {!collapsed && badge && (
            <span className="ml-auto rounded-full bg-danger-500 px-2 py-0.5 text-[0.6875rem] font-bold text-on-danger tnum">{unread}</span>
          )}
        </Link>
        {collapsed && (
          <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs font-medium text-canvas opacity-0 shadow-float transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {label}
          </span>
        )}
      </li>
    );
  };

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 ease-spring lg:flex ${
        collapsed ? 'w-[5.25rem] px-3 py-4' : 'w-[16.5rem] px-4 py-5'
      }`}
      aria-label="Sidebar"
    >
      {/* Brand and the collapse control */}
      <div className={`mb-4 flex items-center ${collapsed ? 'flex-col gap-3' : 'justify-between px-1'}`}>
        <Link href="/dashboard" aria-label="Orbit home" className="rounded-lg">
          {collapsed ? <OrbitMark size={32} /> : <OrbitWordmark />}
        </Link>
        <button
          onClick={toggle}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          aria-expanded={!collapsed}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 transition hover:bg-surface-sunken hover:text-ink-900"
        >
          {icon(ICONS.rail)}
        </button>
      </div>

      {/* Profile, pinned at the top so it never needs scrolling to reach. */}
      <Link
        href="/settings"
        aria-current={isActive('/settings') ? 'page' : undefined}
        aria-label={collapsed ? `${t('nav.settings')}: ${session.customer.firstName} ${session.customer.lastName}` : undefined}
        title={collapsed ? `${session.customer.firstName} — ${t('nav.settings')}` : undefined}
        className={`group relative mb-5 flex items-center rounded-2xl border border-line transition-colors ${
          collapsed ? 'justify-center p-2' : 'gap-3 p-2.5'
        } ${isActive('/settings') ? 'bg-surface-sunken' : 'hover:bg-surface-sunken'}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-sheen text-[0.8125rem] font-bold text-on-accent" aria-hidden="true">
          {session.customer.initials}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-900">
              {session.customer.firstName} {session.customer.lastName}
            </span>
            <span className="block truncate text-[0.6875rem] text-ink-500">
              {session.customer.username ? `@${session.customer.username}` : t('nav.settings')}
            </span>
          </span>
        )}
      </Link>

      <nav className="-mr-2 flex-1 overflow-y-auto pr-2" aria-label="Main navigation">
        {GROUPS.map((group) => {
          const items = visible(group.items);
          if (items.length === 0) return null;
          return (
            <div key={group.title} className={collapsed ? 'mb-3 border-b border-line pb-3 last:border-0' : 'mb-5'}>
              {!collapsed && <h2 className="mb-1.5 px-3 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-ink-400">{t(group.title)}</h2>}
              <ul className={`flex flex-col gap-1 ${collapsed ? 'items-center' : ''}`}>{items.map(item)}</ul>
            </div>
          );
        })}
      </nav>

      <div className={`mt-3 border-t border-line pt-3 ${collapsed ? 'flex flex-col items-center' : ''}`}>
        <ul className={`flex flex-col gap-1 ${collapsed ? 'items-center' : ''}`}>{visible(FOOTER).map(item)}</ul>
      </div>
    </aside>
  );
}

export function MobileTopBar() {
  const t = useT();
  const unread = useUnreadAlerts();
  const { session } = useSession();

  return (
    <div className="glass sticky top-0 z-20 flex items-center justify-between gap-2 border-x-0 border-t-0 px-3 py-2 lg:hidden">
      {/* Profile left, brand centred, alerts right. */}
      <Link
        href="/settings"
        aria-label={`${t('nav.settings')}: ${session.customer.firstName}`}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-sheen text-[0.75rem] font-bold text-on-accent"
      >
        {session.customer.initials}
      </Link>

      <Link href="/dashboard" aria-label="Orbit home" className="absolute left-1/2 -translate-x-1/2">
        <OrbitWordmark compact={false} />
      </Link>

      <div className="flex shrink-0 items-center gap-0.5">
        <QuickDisplay compact />
        <Link href="/alerts" aria-label={`${t('nav.alerts')}${unread ? `, ${unread} unread` : ''}`} className="relative grid h-10 w-10 place-items-center rounded-full text-ink-700 hover:bg-surface-sunken">
          {icon(ICONS.alerts)}
          {unread > 0 && (
            <span className="absolute right-1 top-1 min-w-[1.05rem] rounded-full bg-danger-500 px-1 text-center text-[0.625rem] font-bold leading-[1.05rem] text-on-danger">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}

export function MobileTabs() {
  const t = useT();
  const unread = useUnreadAlerts();
  const pathname = usePathname();
  const { settings } = useAccessibility();
  const { isActive, navigate } = useNav();
  const [moreOpen, setMoreOpen] = useState(false);
  const fit = useTabCount();

  useEffect(() => setMoreOpen(false), [pathname]);

  // One slot is always "More", and Simple mode keeps only the essentials.
  const order = settings.simpleMode
    ? TAB_ORDER.filter((href) => ALL_ITEMS.find((i) => i.href === href)?.essential)
    : TAB_ORDER;
  const tabs = order.slice(0, Math.max(3, fit - 1));

  return (
    <>
      <nav className="glass fixed inset-x-0 bottom-0 z-30 border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main navigation">
        <ul className="flex">
          {tabs.map((href) => {
            const entry = ALL_ITEMS.find((i) => i.href === href)!;
            const badge = href === '/alerts' && unread > 0;
            const active = isActive(href);
            return (
              <li key={href} className="min-w-0 flex-1">
                <Link
                  href={href}
                  onClick={(event) => navigate(event, href)}
                  aria-current={active ? 'page' : undefined}
                  data-tour={entry.tour ? `${entry.tour}-m` : undefined}
                  className={`relative flex flex-col items-center gap-0.5 px-1 py-2 text-[0.625rem] font-semibold transition-colors ${
                    active ? 'text-ink-900' : 'text-ink-500'
                  }`}
                >
                  <span className={`grid h-8 w-12 place-items-center rounded-full transition-colors ${active ? 'bg-accent-100 text-accent-700' : ''}`}>
                    {entry.icon}
                  </span>
                  <span className="max-w-full truncate">{t(entry.label)}</span>
                  {badge && <span className="absolute right-[24%] top-1 h-2 w-2 rounded-full bg-danger-500" />}
                </Link>
              </li>
            );
          })}
          <li className="min-w-0 flex-1">
            <button
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className="relative flex w-full flex-col items-center gap-0.5 px-1 py-2 text-[0.625rem] font-semibold text-ink-500"
            >
              <span className="grid h-8 w-12 place-items-center rounded-full">{icon(ICONS.more)}</span>
              <span>{t('nav.more')}</span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} unread={unread} isActive={isActive} hidden={tabs} />}
    </>
  );
}

/** The More sheet: drag the handle down to dismiss, or use the close button. */
function MoreSheet({
  onClose,
  unread,
  isActive,
  hidden,
}: {
  onClose: () => void;
  unread: number;
  isActive: (href: string) => boolean;
  hidden: string[];
}) {
  const t = useT();
  const { settings } = useAccessibility();
  const panel = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);

  const items = ALL_ITEMS.filter((i) => !hidden.includes(i.href)).filter((i) => (settings.simpleMode ? i.essential : true));

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current === null) return;
    setDrag(Math.max(0, e.clientY - startY.current));
  };
  const onPointerUp = () => {
    if (drag > 110) onClose();
    startY.current = null;
    setDrag(0);
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.more')}>
      <button className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" aria-label={t('common.close')} onClick={onClose} />
      <div
        ref={panel}
        style={{ transform: `translateY(${drag}px)`, transition: startY.current === null ? 'transform .22s cubic-bezier(0.16,1,0.3,1)' : 'none' }}
        className="animate-rise absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-float"
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="flex touch-none cursor-grab items-center justify-between px-4 pb-2 pt-3 active:cursor-grabbing"
        >
          <span className="w-10" aria-hidden="true" />
          <span className="h-1.5 w-12 rounded-full bg-ink-300" aria-hidden="true" />
          <button onClick={onClose} aria-label={t('common.close')} className="grid h-10 w-10 place-items-center rounded-full text-ink-600 hover:bg-surface-sunken">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <p className="px-5 pb-3 text-xs text-ink-500">{t('nav.moreHint')}</p>

        <ul className="grid grid-cols-3 gap-2 px-4 sm:grid-cols-4">
          {items.map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                onClick={onClose}
                aria-current={isActive(entry.href) ? 'page' : undefined}
                className={`relative flex h-full flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-center text-xs font-semibold transition ${
                  isActive(entry.href) ? 'border-ink-900 bg-surface-sunken text-ink-900' : 'border-line text-ink-700 hover:bg-surface-sunken'
                }`}
              >
                {entry.icon}
                <span className="leading-tight">{t(entry.label)}</span>
                {entry.href === '/alerts' && unread > 0 && <span className="absolute right-2 top-2 rounded-full bg-danger-500 px-1.5 text-[0.625rem] font-bold text-on-danger">{unread}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
