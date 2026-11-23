"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect } from "react"
import {
  Activity,
  ChartLine,
  ClipboardCheck,
  FlaskConical,
  LayoutDashboard,
  ScatterChart,
  Syringe,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react"

import { ThemeToggle } from "@/components/ThemeToggle"
import {
  Sidebar,
  SidebarClose,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

type NavGroup = {
  label: string
  items: NavItem[]
}

/** Grouped navigation — one place for both the sidebar and the top bar title. */
export const navGroups: NavGroup[] = [
  {
    label: "演示工作台",
    items: [
      { href: "/", label: "演示总览", icon: LayoutDashboard },
      { href: "/patients", label: "患者病程", icon: Users },
      { href: "/cohort", label: "队列探索", icon: ScatterChart },
    ],
  },
  {
    label: "世界模型",
    items: [
      { href: "/world-model", label: "病程预测", icon: Activity },
      { href: "/simulation", label: "治疗情景", icon: FlaskConical },
      { href: "/training", label: "训练监控", icon: ChartLine },
      { href: "/latent", label: "潜在空间", icon: Waypoints },
      { href: "/treatment-response", label: "治疗响应", icon: Syringe },
    ],
  },
  {
    label: "模型证据",
    items: [{ href: "/evaluation", label: "模型评估", icon: ClipboardCheck }],
  },
]

const FALLBACK_TITLE = "HCC World Model"

function matchesPath(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function getPageMeta(pathname: string): { title: string; group?: string } {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (matchesPath(pathname, item.href)) {
        return { title: item.label, group: group.label }
      }
    }
  }
  return { title: FALLBACK_TITLE }
}

export function AppSidebar() {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  // Close the mobile drawer whenever the route changes (back/forward included).
  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center justify-between gap-1">
          <Link
            href="/"
            aria-label="DR.SEEK · HCC World Model 首页"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 outline-none ring-sidebar-ring focus-visible:ring-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary font-serif text-sm font-semibold text-primary-foreground">
              DS
            </span>
            <span className="min-w-0 group-data-[collapsible=icon]:hidden">
              <span className="block truncate font-serif text-base font-semibold tracking-tight text-sidebar-foreground">
                DR.SEEK
              </span>
              <span className="block truncate text-xs text-sidebar-foreground/70">
                HCC World Model
              </span>
            </span>
          </Link>
          <SidebarClose />
        </div>
      </SidebarHeader>

      <SidebarContent role="navigation" aria-label="主导航">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = matchesPath(pathname, item.href)
                  const Icon = item.icon

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                      >
                        <Link
                          href={item.href}
                          onClick={() => setOpenMobile(false)}
                        >
                          <Icon aria-hidden="true" />
                          <span className="group-data-[collapsible=icon]:hidden">
                            {item.label}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center justify-center gap-2 max-md:justify-between group-data-[collapsible=icon]:justify-center">
          <p className="text-[0.65rem] leading-tight font-medium tracking-wide text-sidebar-foreground/60 uppercase group-data-[collapsible=icon]:hidden">
            研究原型 · RESEARCH ONLY
          </p>
          {/* 仅移动端抽屉显示主题切换；桌面保留顶栏那一处，避免重复。 */}
          <span className="md:hidden">
            <ThemeToggle />
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

/** Sticky top bar: sidebar trigger, current page title, theme toggle. */
export function AppTopbar() {
  const pathname = usePathname()
  const { title, group } = getPageMeta(pathname)

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-sm sm:px-5 lg:px-6 xl:px-8">
      <SidebarTrigger />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        {group ? (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {group}
            <span aria-hidden="true" className="px-1 text-muted-foreground/60">
              /
            </span>
          </span>
        ) : null}
        <p className="truncate text-sm font-semibold text-foreground sm:text-base">
          {title}
        </p>
      </div>
      {/* 移动端 <md 时顶栏不重复展示：抽屉 footer 里已提供主题切换。 */}
      <span className="hidden md:inline-flex">
        <ThemeToggle />
      </span>
    </header>
  )
}
