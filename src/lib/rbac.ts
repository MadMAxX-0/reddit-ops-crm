/**
 * One source of truth for navigation AND route guarding. If a route is not
 * listed here it is admin-only by default — failing closed is the point.
 *
 * This module must stay edge-safe (no prisma, no node builtins) because the
 * middleware imports it.
 */

export type Role = 'POSTER' | 'FARMER' | 'MANAGER' | 'ADMIN'

export const ALL_ROLES: Role[] = ['POSTER', 'FARMER', 'MANAGER', 'ADMIN']
export const MANAGEMENT: Role[] = ['MANAGER', 'ADMIN']

export interface NavItem {
  href: string
  label: string
  icon: string // lucide icon name, resolved client-side
  roles: Role[]
  section: 'main' | 'admin' | 'hidden'
  /** matches nested routes too */
  prefix?: boolean
  /**
   * Shown in the rail but not clickable, and the route answers 404. For
   * sections being rebuilt: a greyed entry says "later", a missing one says
   * "never", and a 404 on the URL says "this is not the shape it will keep".
   * The 404 is raised by the page itself, so the address is honestly dead
   * rather than quietly bounced somewhere that looks like it worked.
   */
  parked?: boolean
}

export const NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    roles: ALL_ROLES,
    section: 'main',
  },
  {
    href: '/posting',
    label: 'Posting',
    icon: 'Send',
    roles: ['POSTER', ...MANAGEMENT],
    section: 'main',
    prefix: true,
  },
  {
    href: '/accounts',
    label: 'Tracker',
    icon: 'Database',
    roles: ALL_ROLES,
    section: 'main',
    prefix: true,
  },
  // Account creation and farming were two screens describing one thing: an
  // account moving from made, to warming, to in rotation. They are one screen.
  {
    href: '/pipeline',
    label: 'Account Pipeline',
    icon: 'Sprout',
    roles: ['FARMER', ...MANAGEMENT],
    section: 'main',
    prefix: true,
  },

  { href: '/admin', label: 'Overview', icon: 'ShieldCheck', roles: MANAGEMENT, section: 'admin' },
  // Where the per-VA account breakdowns live. They were on the dashboard, which
  // made the front page a report about six people rather than a state of play.
  {
    href: '/admin/performance',
    label: 'Performance',
    icon: 'Trophy',
    roles: MANAGEMENT,
    section: 'admin',
  },
  {
    href: '/admin/reports',
    label: 'Reports',
    icon: 'FileText',
    roles: MANAGEMENT,
    section: 'admin',
    parked: true,
  },
  {
    href: '/admin/scraper',
    label: 'Scraper',
    icon: 'Radar',
    roles: MANAGEMENT,
    section: 'admin',
  },
  {
    href: '/admin/subreddits',
    label: 'Subreddit Lists',
    icon: 'ListTree',
    roles: MANAGEMENT,
    section: 'admin',
    prefix: true,
    parked: true,
  },
  {
    href: '/spy',
    label: 'Spy',
    icon: 'Binoculars',
    roles: MANAGEMENT,
    section: 'admin',
    prefix: true,
  },
  {
    href: '/admin/audit',
    label: 'Audit Logs',
    icon: 'ScrollText',
    roles: ['ADMIN'],
    section: 'admin',
  },
  {
    href: '/admin/users',
    label: 'Users',
    icon: 'Users',
    roles: ['ADMIN'],
    section: 'admin',
    prefix: true,
  },
  { href: '/settings', label: 'Settings', icon: 'Settings', roles: ALL_ROLES, section: 'admin' },

  // Reachable, not in the rail. The grid hangs off Posting and the pipeline off
  // the account database, so neither needs its own icon.
  { href: '/grid', label: 'Grid', icon: 'LayoutGrid', roles: ALL_ROLES, section: 'hidden' },
  {
    href: '/my-performance',
    label: 'My performance',
    icon: 'TrendingUp',
    roles: ['POSTER', 'FARMER'],
    section: 'hidden',
  },
  {
    href: '/notifications',
    label: 'Notifications',
    icon: 'Bell',
    roles: ALL_ROLES,
    section: 'hidden',
  },
  { href: '/search', label: 'Search', icon: 'Search', roles: ALL_ROLES, section: 'hidden' },
  // Reachable by address only. A typeface is picked once and then hardcoded, so
  // it does not earn a permanent icon in the rail.
  {
    href: '/admin/typeface',
    label: 'Typeface',
    icon: 'Type',
    roles: MANAGEMENT,
    section: 'hidden',
  },
]

/** Rail items only — hidden routes are addressable but never rendered. */
export function navFor(role: Role): NavItem[] {
  return NAV.filter((item) => item.section !== 'hidden' && item.roles.includes(role))
}

/** Longest-prefix match, so /admin/users does not resolve to /admin. */
function matchNav(pathname: string): NavItem | undefined {
  const candidates = NAV.filter(
    (item) => item.href === pathname || pathname.startsWith(`${item.href}/`),
  )
  return candidates.sort((a, b) => b.href.length - a.href.length)[0]
}

export function canAccess(role: Role | undefined, pathname: string): boolean {
  if (!role) return false
  const item = matchNav(pathname)
  // A parked route is deliberately let through here so the page can answer 404.
  // Refusing it at the proxy would redirect instead, and a redirect reads as
  // "you are not allowed" when the truth is "this screen is being rebuilt".
  if (role === 'ADMIN') return true
  if (!item) return false // fail closed
  return item.roles.includes(role)
}

/** Everyone lands on the grid — it is the screen the operation runs on. */
export function landingFor(role: Role): string {
  void role
  return '/dashboard'
}

export function activeHref(pathname: string): string | undefined {
  return matchNav(pathname)?.href
}

export const ROLE_LABEL: Record<Role, string> = {
  POSTER: 'Poster',
  FARMER: 'Farmer',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
}

export function isManager(role: Role | undefined): boolean {
  return role === 'MANAGER' || role === 'ADMIN'
}
