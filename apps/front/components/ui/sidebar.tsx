"use client"

import * as React from "react"
import { PanelLeftIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

// `useLayoutEffect` warns when it runs during SSR, so fall back to `useEffect`
// on the server. On the client this restores the persisted state before paint.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

function readSidebarCookie(): boolean | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE_NAME}=(true|false)(?:;|$)`)
  )
  if (!match) return null
  return match[1] === "true"
}

type SidebarState = "expanded" | "collapsed"

type SidebarContextProps = {
  state: SidebarState
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  /** True once the persisted cookie state has been restored (client-only). */
  hydrated: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }
  return context
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  )
}

/**
 * Local, dependency-free equivalent of shadcn/ui's SidebarProvider.
 *
 * - Desktop: `open` toggles between expanded (15rem) and icon (3.25rem) modes.
 *   The state is persisted in the `sidebar_state` cookie and restored on the
 *   client before paint (reading the cookie in a Server Component would block
 *   prerendering under `cacheComponents`).
 * - Mobile: `openMobile` drives an off-canvas drawer with a backdrop.
 * - Keyboard: Ctrl/Cmd+B toggles, Escape closes the mobile drawer.
 */
function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const [hydrated, setHydrated] = React.useState(false)
  const open = openProp ?? uncontrolledOpen

  // Restore the persisted width before the post-hydration paint, then enable
  // width transitions on the next frame so the restore itself doesn't animate.
  useIsomorphicLayoutEffect(() => {
    if (openProp === undefined) {
      const storedOpen = readSidebarCookie()
      if (storedOpen !== null) setUncontrolledOpen(storedOpen)
    }

    const frame = window.requestAnimationFrame(() => setHydrated(true))
    return () => window.cancelAnimationFrame(frame)
    // Only run once on mount: later changes come from user interactions.
  }, [])

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (onOpenChange) onOpenChange(nextOpen)
      else setUncontrolledOpen(nextOpen)

      if (typeof document !== "undefined") {
        document.cookie = `${SIDEBAR_COOKIE_NAME}=${nextOpen}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`
      }
    },
    [onOpenChange]
  )

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile((value) => !value)
    else setOpen(!open)
  }, [isMobile, open, setOpen])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // Lock scroll and allow Escape while the mobile drawer is open.
  React.useEffect(() => {
    if (!openMobile) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMobile(false)
    }
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [openMobile])

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state: open ? "expanded" : "collapsed",
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      hydrated,
      toggleSidebar,
    }),
    [open, setOpen, openMobile, isMobile, hydrated, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        data-state={contextValue.state}
        className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { state, openMobile, setOpenMobile, hydrated } = useSidebar()

  const widthTransition = hydrated
    ? "transition-[width] duration-200 ease-linear"
    : ""

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        data-state="expanded"
        data-collapsible=""
        data-variant={variant}
        data-side={side}
        className={cn(
          "flex h-full w-[var(--sidebar-width)] shrink-0 flex-col bg-sidebar text-sidebar-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  return (
    <>
      {/* Desktop: in-flow spacer + fixed panel. Collapses to an icon rail. */}
      <div
        data-slot="sidebar"
        data-state={state}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-variant={variant}
        data-side={side}
        className={cn(
          "group peer hidden shrink-0 text-sidebar-foreground md:block",
          widthTransition,
          state === "collapsed"
            ? "w-[var(--sidebar-width-icon)]"
            : "w-[var(--sidebar-width)]",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "fixed inset-y-0 z-10 hidden h-svh md:flex",
            widthTransition,
            state === "collapsed"
              ? "w-[var(--sidebar-width-icon)]"
              : "w-[var(--sidebar-width)]",
            side === "left" ? "left-0" : "right-0",
            variant === "floating" || variant === "inset" ? "p-2" : ""
          )}
        >
          <div
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
            data-state={state}
            data-variant={variant}
            className={cn(
              "flex h-full w-full flex-col bg-sidebar",
              variant === "floating"
                ? "rounded-lg border border-sidebar-border shadow-sm"
                : ""
            )}
          >
            {children}
          </div>
        </div>
      </div>

      {/* Mobile: off-canvas drawer with backdrop, hidden from the a11y tree when closed. */}
      <div
        data-slot="sidebar-mobile"
        className={cn(
          "fixed inset-0 z-50 md:hidden",
          openMobile ? "" : "pointer-events-none"
        )}
      >
        <div
          aria-hidden="true"
          onClick={() => setOpenMobile(false)}
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-200",
            openMobile ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="主导航"
          data-slot="sidebar"
          data-state={openMobile ? "expanded" : "collapsed"}
          data-sidebar="sidebar"
          inert={!openMobile}
          className={cn(
            "absolute inset-y-0 flex w-[18rem] max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-xl",
            "transition-transform duration-200 ease-linear",
            openMobile
              ? "translate-x-0"
              : side === "left"
                ? "-translate-x-full"
                : "translate-x-full",
            side === "left" ? "left-0" : "right-0"
          )}
        >
          {children}
        </div>
      </div>
    </>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar()
  const expanded = isMobile ? openMobile : open

  return (
    <Button
      type="button"
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0", className)}
      aria-label={expanded ? "收起侧边栏" : "展开侧边栏"}
      aria-expanded={expanded}
      title="切换侧边栏（Ctrl/⌘ + B）"
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon aria-hidden="true" />
      <span className="sr-only">切换侧边栏</span>
    </Button>
  )
}

/**
 * 移动端抽屉里的显式关闭按钮。`md:hidden` 保证它只出现在 <768px 的抽屉中，
 * 桌面侧边栏（同样渲染 children）里不可见。
 */
function SidebarClose({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { setOpenMobile } = useSidebar()

  return (
    <Button
      type="button"
      data-sidebar="close"
      data-slot="sidebar-close"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0 md:hidden", className)}
      aria-label="关闭侧边栏"
      title="关闭侧边栏"
      onClick={(event) => {
        onClick?.(event)
        setOpenMobile(false)
      }}
      {...props}
    >
      <XIcon aria-hidden="true" />
    </Button>
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn(
        "relative flex min-h-svh w-full min-w-0 flex-1 flex-col bg-background",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:border-border md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 overflow-auto",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium tracking-wide text-sidebar-foreground/70",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

function renderAsChild(children: React.ReactNode, props: Record<string, unknown>) {
  if (!React.isValidElement(children)) {
    throw new Error(
      "SidebarMenuButton with `asChild` expects exactly one React element child."
    )
  }

  const child = children as React.ReactElement<Record<string, unknown>>

  return React.cloneElement(child, {
    ...props,
    className: cn(
      typeof props.className === "string" ? props.className : undefined,
      typeof child.props.className === "string" ? child.props.className : undefined
    ),
  })
}

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  tooltip,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string
}) {
  const { isMobile, state } = useSidebar()
  const collapsed = state === "collapsed" && !isMobile

  const classes = cn(
    "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding]",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
    "group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1.5!",
    "[&>span:last-child]:truncate [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    className
  )

  const sharedProps: Record<string, unknown> = {
    ...props,
    "data-slot": "sidebar-menu-button",
    "data-sidebar": "menu-button",
    "data-active": isActive,
    "data-size": "default",
  }

  if (tooltip && collapsed) sharedProps.title = tooltip

  if (asChild) {
    return renderAsChild(children, { ...sharedProps, className: classes })
  }

  return (
    <button type="button" className={classes} {...(sharedProps as React.ComponentProps<"button">)}>
      {children}
    </button>
  )
}

export {
  Sidebar,
  SidebarClose,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
}
