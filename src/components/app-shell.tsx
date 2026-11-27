import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Contact,
  Activity,
  ArrowLeftRight,
  BadgeCheck,
  BarChart3,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  ChevronDown,
  LogOut,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  Target,
  Users,
  Wallet,
  Check,
  Monitor,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/auth-context";
import { useBranches } from "@/hooks/use-branches";
import { useTenant } from "@/hooks/use-tenant";
import * as auth from "@/services/auth";
import {
  getScopeForUser,
  setCurrentUserId,
  useCurrentUserId,
  type AccessScope,
} from "@/lib/session";
import { roleLabel } from "@/lib/format";
import { UserAvatar } from "@/components/shared";
import { useMemberPhotos } from "@/hooks/use-onboardings";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { BRAND_NAME } from "@/lib/brand";
import { PageHeader } from "@/components/kit/page-header";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Phone bottom bar: the 4 places each role uses most. "More" opens the rest.
 * Tablet and desktop use the sidebar instead.
 */
const mobileTabs: Record<string, { label: string; icon: LucideIcon; to: NavTo }[]> = {
  owner: [
    { label: "Home", icon: LayoutDashboard, to: "/" },
    { label: "Sales", icon: ShoppingCart, to: "/sales" },
    { label: "Orders", icon: ClipboardList, to: "/orders" },
    { label: "Inventory", icon: Boxes, to: "/inventory" },
  ],
  manager: [
    { label: "Home", icon: LayoutDashboard, to: "/" },
    { label: "Sales", icon: ShoppingCart, to: "/sales" },
    { label: "Orders", icon: ClipboardList, to: "/orders" },
    { label: "Approvals", icon: BadgeCheck, to: "/approvals" },
  ],
  sales_rep: [
    { label: "Home", icon: LayoutDashboard, to: "/" },
    { label: "Orders", icon: ClipboardList, to: "/orders" },
    { label: "Customers", icon: Contact, to: "/customers" },
    { label: "Payment", icon: Wallet, to: "/payment" },
  ],
  storekeeper: [
    { label: "Home", icon: LayoutDashboard, to: "/" },
    { label: "Orders", icon: ClipboardList, to: "/orders" },
    { label: "Inventory", icon: Boxes, to: "/inventory" },
    { label: "Approvals", icon: BadgeCheck, to: "/approvals" },
  ],
  supervisor: [
    { label: "Reports", icon: BarChart3, to: "/" },
    { label: "Settings", icon: Settings, to: "/settings" },
  ],
};

type NavTo =
  | "/"
  | "/branches"
  | "/sales"
  | "/payment"
  | "/expenses"
  | "/remittance"
  | "/owner/remittance"
  | "/inventory"
  | "/orders"
  | "/products"
  | "/targets"
  | "/stock-movements"
  | "/audit-log"
  | "/team"
  | "/reports"
  | "/settings"
  | "/approvals"
  | "/customers"
  | "/manager-remittances"
  | "/exchanges";
type NavItem = {
  label: string;
  icon: LucideIcon;
  to?: NavTo;
  ownerOnly?: boolean;
  managerOnly?: boolean;
  needsSales?: boolean;
  needsBranches?: boolean;
};
type NavSection = { title: string; items: NavItem[] };
const managementSections: NavSection[] = [
  { title: "Overview", items: [{ label: "Dashboard", icon: LayoutDashboard, to: "/" }] },
  {
    title: "Operations",
    items: [
      { label: "Branches", icon: Store, to: "/branches", needsBranches: true },
      { label: "Sales", icon: ShoppingCart, to: "/sales", needsSales: true },
      { label: "Payment", icon: Wallet, to: "/payment" },
      { label: "Customers", icon: Contact, to: "/customers", managerOnly: true },
      { label: "Expenses", icon: Receipt, to: "/expenses", managerOnly: true },
      { label: "Manager Remittance", icon: Landmark, to: "/remittance", managerOnly: true },
      { label: "Manager Remittance Approvals", icon: Landmark, to: "/remittance", ownerOnly: true },
      { label: "Inventory", icon: Boxes, to: "/inventory" },
      { label: "Orders", icon: ClipboardList, to: "/orders" },
      { label: "Exchanges", icon: ArrowLeftRight, to: "/exchanges" },
      { label: "Products", icon: Package, to: "/products" },
      { label: "Targets", icon: Target, to: "/targets", ownerOnly: true },
      { label: "Reports", icon: BarChart3, to: "/reports" },
      { label: "Approvals", icon: BadgeCheck, to: "/approvals" },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Team", icon: Users, to: "/team" },
      { label: "Audit Log", icon: ClipboardCheck, to: "/audit-log" },
      { label: "Settings", icon: Settings, to: "/settings" },
    ],
  },
];
const ownerSections: NavSection[] = [
  { title: "Overview", items: [{ label: "Dashboard", icon: LayoutDashboard, to: "/" }] },
  {
    title: "Operations",
    items: [
      { label: "Branches", icon: Store, to: "/branches" },
      { label: "Sales", icon: ShoppingCart, to: "/sales" },
      { label: "Remittance", icon: Landmark, to: "/owner/remittance" },
      { label: "Inventory", icon: Boxes, to: "/inventory" },
      { label: "Products", icon: Package, to: "/products" },
      { label: "Targets", icon: Target, to: "/targets" },
      { label: "Team", icon: Users, to: "/team" },
      { label: "Reports", icon: BarChart3, to: "/reports" },
      { label: "Payment", icon: Wallet, to: "/payment" },
      { label: "Manager Remittances", icon: Landmark, to: "/manager-remittances" },
      { label: "Customers", icon: Contact, to: "/customers" },
      { label: "Orders", icon: ClipboardList, to: "/orders" },
      { label: "Exchanges", icon: ArrowLeftRight, to: "/exchanges" },
      { label: "Expenses", icon: Receipt, to: "/expenses" },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Audit Log", icon: ClipboardCheck, to: "/audit-log" },
      { label: "Settings", icon: Settings, to: "/settings" },
    ],
  },
];
const repSections: NavSection[] = [
  { title: "Overview", items: [{ label: "Dashboard", icon: LayoutDashboard, to: "/" }] },
  {
    title: "Sales",
    items: [
      { label: "My Sales", icon: ShoppingCart, to: "/sales" },
      { label: "Customers", icon: Contact, to: "/customers" },
      { label: "Orders", icon: ClipboardList, to: "/orders" },
      { label: "Payment", icon: Wallet, to: "/payment" },
      { label: "Exchanges", icon: ArrowLeftRight, to: "/exchanges" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "My Activity", icon: ClipboardCheck, to: "/audit-log" },
      { label: "Settings", icon: Settings, to: "/settings" },
    ],
  },
];
/** Supervisors work from their Reports page (home) and their own settings. */
const supervisorSections: NavSection[] = [
  { title: "Reports", items: [{ label: "Reports", icon: BarChart3, to: "/" }] },
  { title: "Account", items: [{ label: "Settings", icon: Settings, to: "/settings" }] },
];
/** Pages a Supervisor may open; any other page shows a notice instead of an empty screen. */
const supervisorPaths = new Set(["/", "/settings"]);

const storekeeperSections: NavSection[] = [
  { title: "Overview", items: [{ label: "Dashboard", icon: LayoutDashboard, to: "/" }] },
  {
    title: "Inventory",
    items: [
      { label: "Inventory", icon: Boxes, to: "/inventory" },
      { label: "Products", icon: Package, to: "/products" },
      { label: "Stock Movements", icon: ArrowLeftRight, to: "/stock-movements" },
      { label: "Customers", icon: Contact, to: "/customers" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Order Fulfilment", icon: ClipboardList, to: "/orders" },
      { label: "Exchanges", icon: ArrowLeftRight, to: "/exchanges" },
      { label: "My Approvals", icon: BadgeCheck, to: "/approvals" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Audit Log", icon: ClipboardCheck, to: "/audit-log" },
      { label: "Settings", icon: Settings, to: "/settings" },
    ],
  },
];
/** The sidebar sections for this user, with items they may not open left out. */
function visibleSections(scope: AccessScope): NavSection[] {
  return sectionsFor(scope.user.role)
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (i) =>
          (!i.ownerOnly || scope.user.role === "owner") &&
          (!i.managerOnly || scope.user.role === "manager") &&
          (!i.needsSales || scope.canViewSales) &&
          (!i.needsBranches || scope.canViewBranches),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

const sectionsFor = (role: string) =>
  role === "supervisor"
    ? supervisorSections
    : role === "sales_rep"
    ? repSections
    : role === "storekeeper"
      ? storekeeperSections
      : role === "owner"
        ? ownerSections
        : managementSections;



/**
 * The sidebar preference read once per page load. Every screen renders its own
 * AppShell, so without this each navigation would start expanded and then
 * collapse, which looks like the page reloading.
 */
let sidebarCollapsedPreference: boolean | null = null;

/**
 * Pages render only once the sign-in and profile are loaded. Until then the
 * scope has no role, so a page would show "Access restricted" or empty data for
 * a moment on every refresh. Signed-out visitors go to the sign-in page.
 */
function useSessionReady() {
  const { authStatus, profileStatus, profileError, retryProfile } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (authStatus === "unauthenticated") void navigate({ to: "/login", replace: true });
  }, [authStatus, navigate]);
  if (authStatus === "loading" || (authStatus === "authenticated" && (profileStatus === "idle" || profileStatus === "loading")))
    return { ready: false, gate: <SessionScreen title="Loading your account" detail="Checking your sign-in and role." /> };
  if (authStatus === "unauthenticated")
    return { ready: false, gate: <SessionScreen title="Redirecting to sign in" detail="Sign in to continue." /> };
  if (profileStatus !== "loaded")
    return {
      ready: false,
      gate: <SessionScreen title="We couldn't load your account" detail={profileError ?? "Your profile is not active. Contact the Owner."}
        action={profileStatus === "failed" ? <Button size="sm" onClick={() => void retryProfile()}>Try again</Button> : undefined} />,
    };
  return { ready: true, gate: null };
}

function SessionScreen({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="grid min-h-screen place-items-center bg-background p-6 text-center text-foreground">
      <div><p className="text-body font-medium">{title}</p><p className="mt-1 text-caption text-muted-foreground">{detail}</p>{action && <div className="mt-4">{action}</div>}</div>
    </div>
  );
}

export function AppShell({
  title,
  subtitle,
  headerExtra,
  actions,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  headerExtra?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  // Screens update on their own when others change things (no manual refresh).
  useLiveUpdates();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(sidebarCollapsedPreference ?? false);
  const [sidebarPreferenceReady, setSidebarPreferenceReady] = useState(sidebarCollapsedPreference !== null);
  useEffect(() => {
    if (sidebarCollapsedPreference !== null) return;
    try {
      sidebarCollapsedPreference = window.localStorage.getItem("friscontech-sidebar-collapsed") === "true";
    } catch {
      sidebarCollapsedPreference = false;
    }
    setSidebarCollapsed(sidebarCollapsedPreference);
    setSidebarPreferenceReady(true);
  }, []);
  useEffect(() => {
    if (!sidebarPreferenceReady) return;
    sidebarCollapsedPreference = sidebarCollapsed;
    try {
      window.localStorage.setItem("friscontech-sidebar-collapsed", String(sidebarCollapsed));
    } catch {
      // The sidebar remains usable if local storage is unavailable.
    }
  }, [sidebarCollapsed, sidebarPreferenceReady]);
  const session = useSessionReady();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user: authUser } = useAuth();
  const legacyUserId = useCurrentUserId();
  const userId = authUser?.id ?? legacyUserId;
  const scope = getScopeForUser(authUser ?? null, userId);
  const { data: branches = [] } = useBranches();
  const { data: tenant } = useTenant();
  const branch = branches.find((b) => b.id === scope.user.branchId);
  const { data: photos = {} } = useMemberPhotos(!!authUser);

  if (!session.ready) return session.gate;

  const sections = visibleSections(scope);
  const tabs = mobileTabs[scope.user.role] ?? [];
  const tabPaths = new Set<string>(tabs.map((t) => t.to));
  const moreSections = sections
    .map((section) => ({ ...section, items: section.items.filter((i) => !i.to || !tabPaths.has(i.to)) }))
    .filter((section) => section.items.length > 0);
  // The sidebar section holding this page, shown above the title on wide screens.
  const sectionTitle = sections.find((section) =>
    section.items.some((i) => i.to && (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to))),
  )?.title;
  // Tablets always get the narrow rail; desktops follow the saved preference.
  const collapsedLg = sidebarCollapsed;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sidebar: tablet (rail) and desktop. Phones use the bottom bar. */}
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-40 hidden w-16 flex-col border-r border-border bg-sidebar md:flex ${collapsedLg ? "" : "lg:w-60"}`}
      >
        <div className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4 ${collapsedLg ? "justify-center px-0" : "justify-center lg:justify-start"}`}>
          <BrandMark />
          <div className={`min-w-0 ${collapsedLg ? "hidden" : "hidden lg:block"}`}>
            <p className="truncate text-label font-semibold leading-tight">{BRAND_NAME}</p>
            <p className="truncate text-caption text-muted-foreground">{tenant?.name ?? `${roleLabel[scope.user.role]} console`}</p>
          </div>
        </div>
        <TooltipProvider delayDuration={200}>
          <nav className="flex-1 overflow-y-auto px-2.5 py-3">
            {sections.map((section) => (
              <div key={section.title} className="mb-4 last:mb-0">
                <p className={`px-2.5 pb-1.5 text-caption font-medium text-muted-foreground ${collapsedLg ? "sr-only" : "sr-only lg:not-sr-only lg:block"}`}>
                  {section.title}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.label}>
                      <SidebarLink item={item} collapsed={collapsedLg} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </TooltipProvider>
        <div className="hidden border-t border-border p-2.5 lg:block">
          <Button
            variant="ghost"
            size="sm"
            className={`w-full ${collapsedLg ? "justify-center px-0" : "justify-start"}`}
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={collapsedLg ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsedLg ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsedLg ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!collapsedLg && "Collapse"}
          </Button>
        </div>
      </aside>

      <div className={`md:pl-16 ${collapsedLg ? "" : "lg:pl-60"}`}>
        {/* Top bar: where you are on the left; theme, notifications and your account on the right. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="md:hidden"><BrandMark /></span>
            <p className="min-w-0 truncate text-label text-muted-foreground">
              <span className="md:hidden">{tenant?.name ?? BRAND_NAME}</span>
              <span className="hidden md:inline">
                {sectionTitle && sectionTitle !== title ? <>{sectionTitle}<span className="mx-1.5 text-border">/</span></> : null}
                <span className="font-medium text-foreground">{title}</span>
              </span>
            </p>
          </div>
          <ThemeToggle />
          <NotificationBell />
          <AccountMenu
            name={scope.user.name ?? "—"}
            email={scope.user.email ?? ""}
            detail={`${roleLabel[scope.user.role]}${branch?.name ? ` · ${branch.name}` : tenant?.name ? ` · ${tenant.name}` : ""}`}
            photo={photos[userId]}
            onSignOut={() => auth.signOut(userId)}
          />
        </header>
        <main className={`page-enter mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${tabs.length ? "pb-28 md:pb-8" : ""}`}>
          {scope.user.role === "supervisor" && !supervisorPaths.has(pathname) ? (
            <RestrictedNotice message="Supervisors request and open reports from their Reports page." />
          ) : (
            <>
              <PageHeader title={title} description={subtitle} actions={headerExtra || actions ? <>{headerExtra}{actions}</> : undefined} />
              {children}
            </>
          )}
        </main>
      </div>

      {/* Phones: bottom bar for one-thumb use. */}
      {tabs.length > 0 && (
        <nav
          aria-label="Quick navigation"
          className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
          style={{ gridTemplateColumns: `repeat(${tabs.length + (moreSections.length ? 1 : 0)}, minmax(0, 1fr))` }}
        >
          {tabs.map(({ label, icon: Icon, to }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="relative flex min-h-14 flex-col items-center justify-center gap-1 text-caption font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              activeProps={{ className: "!text-primary before:absolute before:inset-x-6 before:top-0 before:h-0.5 before:rounded-b-full before:bg-primary", "aria-current": "page" }}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
          {moreSections.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              className="flex min-h-14 flex-col items-center justify-center gap-1 text-caption font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <MoreHorizontal className="size-5" />
              More
            </button>
          )}
        </nav>
      )}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-5">
          <SheetHeader className="px-1">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="mt-2 space-y-4">
            {moreSections.map((section) => (
              <div key={section.title}>
                <p className="px-1 pb-1.5 text-caption font-medium text-muted-foreground">{section.title}</p>
                <div className="grid grid-cols-3 gap-2">
                  {section.items.map(({ label, icon: Icon, to }) =>
                    to ? (
                      <Link
                        key={label}
                        to={to}
                        onClick={() => setMoreOpen(false)}
                        activeOptions={{ exact: to === "/" }}
                        className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2 text-center text-caption font-medium text-foreground transition-colors hover:bg-muted"
                        activeProps={{ className: "!border-primary/40 !bg-brand-soft !text-primary" }}
                      >
                        <Icon className="size-5 text-muted-foreground" />
                        <span className="leading-tight">{label}</span>
                      </Link>
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
      <Activity className="size-4" />
    </span>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { label, icon: Icon, to } = item;
  if (!to) {
    return (
      <button
        type="button"
        onClick={() => toast(`${label} is coming in the next phase`)}
        className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-label font-medium text-muted-foreground hover:bg-muted"
      >
        <Icon className="size-4 shrink-0" />
        <span className={collapsed ? "sr-only" : "sr-only lg:not-sr-only"}>{label}</span>
      </button>
    );
  }
  const link = (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className={`relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-label font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${collapsed ? "justify-center px-0" : "justify-center px-0 lg:justify-start lg:px-2.5"}`}
      activeProps={{ className: "!bg-sidebar-accent !text-sidebar-accent-foreground", "aria-current": "page" }}
    >
      <Icon className="size-4 shrink-0" />
      <span className={collapsed ? "sr-only" : "sr-only lg:not-sr-only lg:truncate"}>{label}</span>
    </Link>
  );
  // Icon-only rail: the name shows on hover and focus.
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className={collapsed ? "" : "lg:hidden"}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Profile, settings and sign out: top right, as in most SaaS products. */
function AccountMenu({ name, email, detail, photo, onSignOut }: {
  name: string;
  email: string;
  detail: string;
  photo: string | null | undefined;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="ml-1 flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:rounded-md lg:py-1 lg:pl-1 lg:pr-2"
        >
          <UserAvatar name={name} src={photo} size="sm" />
          <span className="hidden max-w-[10rem] truncate text-label font-medium lg:block">{name}</span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground lg:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <UserAvatar name={name} src={photo} />
          <div className="min-w-0">
            <p className="truncate text-label font-semibold">{name}</p>
            <p className="truncate text-caption text-muted-foreground">{email}</p>
            <p className="truncate text-caption text-muted-foreground">{detail}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings"><Settings className="size-4" />Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-destructive focus:bg-danger-soft focus:text-destructive">
          <Link to="/login" onClick={onSignOut}><LogOut className="size-4" />Sign out</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Light / dark / system switch in the top bar (remembered on this device). */
export function ThemeToggle() {
  const { choice, isDark, setTheme } = useTheme();
  const options: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme" title="Theme">
          {isDark ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {options.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon className="size-4" />
            {label}
            {choice === value && <Check className="ml-auto size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Renders children only when the current role may use the module; the page itself never mounts otherwise. */
export function RoleGate({
  allow,
  title,
  message,
  children,
}: {
  allow: (scope: AccessScope) => boolean;
  title: string;
  message: string;
  children: ReactNode;
}) {
  const { user: authUser } = useAuth();
  const legacyUserId = useCurrentUserId();
  const userId = authUser?.id ?? legacyUserId;
  const scope = getScopeForUser(authUser ?? null, userId);
  const session = useSessionReady();
  // Decide access only once the role is known, never from the empty pre-load scope.
  if (!session.ready) return session.gate;
  if (!allow(scope))
    return (
      <AppShell title={title}>
        <RestrictedNotice message={message} />
      </AppShell>
    );
  return <>{children}</>;
}

export function RestrictedNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-12 text-center shadow-panel">
      <p className="text-body font-medium">Access restricted</p>
      <p className="mt-1 text-caption text-muted-foreground">{message}</p>
    </div>
  );
}
