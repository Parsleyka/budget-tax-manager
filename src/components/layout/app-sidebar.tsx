"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { isNavActive, NAV_ITEMS, SETTINGS_ITEM, type NavItem } from "./nav-items";

/** A number that needs attention next to a nav item (e.g. overdue debts); hidden when 0. */
export type NavBadges = Partial<Record<string, { count: number; label: string }>>;

function NavLink({ item, pathname, onNavigate, badge }: { item: NavItem; pathname: string; onNavigate: () => void; badge?: { count: number; label: string } }) {
  const active = isNavActive(pathname, item.href);
  const Icon = item.icon;
  const showBadge = !!badge && badge.count > 0;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active || undefined}
        tooltip={showBadge ? `${item.title} · ${badge.count} ${badge.label}` : item.title}
        className="data-active:text-sidebar-accent-foreground data-active:[&>svg]:text-sidebar-primary"
      >
        <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
          <Icon />
          <span>{item.title}</span>
          {showBadge ? <span className="sr-only">, {badge.count} {badge.label}</span> : null}
        </Link>
      </SidebarMenuButton>
      {showBadge ? (
        <SidebarMenuBadge
          aria-hidden
          data-testid={`nav-badge-${item.href.slice(1) || "home"}`}
          className="bg-negative/15 text-negative peer-hover/menu-button:text-negative peer-data-active/menu-button:text-negative"
        >
          {badge.count}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

/** App navigation: collapsible to icons on desktop (⌘/Ctrl+B), a sheet on mobile. */
export function AppSidebar({ badges = {} }: { badges?: NavBadges }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const onNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Budget & Tax">
              <Link href="/" onClick={onNavigate}>
                <span className="flex aspect-square size-8 items-center justify-center text-sidebar-accent-foreground">
                  <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19V11" />
                    <path d="M10 19V5" />
                    <path d="M16 19v-6" />
                    <path d="M3 19h18" />
                  </svg>
                </span>
                <span className="truncate font-semibold text-sidebar-accent-foreground">Budget &amp; Tax</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Main">
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} badge={badges[item.href]} />
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <NavLink item={SETTINGS_ITEM} pathname={pathname} onNavigate={onNavigate} />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
