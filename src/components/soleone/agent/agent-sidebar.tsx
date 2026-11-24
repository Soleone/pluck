import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Maximize2, MessageCircle, Minimize2, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sidebar, SidebarContent, SidebarHeader, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/soleone/tooltip/tooltip"

const wideKey = "agent-sidebar.wide"

function readWide() {
  try {
    return localStorage.getItem(wideKey) === "1"
  } catch {
    return false
  }
}

/**
 * An app-wide, independently scrolling agent dock. Sidebar supplies the mobile Sheet. `header` replaces
 * the title, for example with an AgentSessionSwitcher. While `busy`, the launcher shows a pulsing dot;
 * a reply that ends while the dock is closed leaves a dot until it opens again.
 */
export function AgentSidebar({ children, agent, title = "Agent", header, busy = false }: {
  children: ReactNode
  agent: ReactNode
  title?: string
  header?: ReactNode
  busy?: boolean
}) {
  const [wide, setWide] = useState(readWide)
  function toggleWide() {
    setWide(!wide)
    try {
      localStorage.setItem(wideKey, wide ? "0" : "1")
    } catch {
      // Not remembered, say in a private window.
    }
  }
  return (
    <SidebarProvider defaultOpen={false} style={{ "--sidebar-width": wide ? "40rem" : "24rem" } as CSSProperties}>
      <AgentSidebarLayout agent={agent} title={title} header={header} busy={busy} wide={wide} onToggleWide={toggleWide}>
        {children}
      </AgentSidebarLayout>
    </SidebarProvider>
  )
}

function AgentSidebarLayout({ children, agent, title, header, busy, wide, onToggleWide }: {
  children: ReactNode
  agent: ReactNode
  title: string
  header?: ReactNode
  busy: boolean
  wide: boolean
  onToggleWide: () => void
}) {
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar()
  const visible = isMobile ? openMobile : open
  const [activated, setActivated] = useState(false)
  const [unread, setUnread] = useState(false)
  const wasBusy = useRef(busy)
  const launcher = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (visible) setActivated(true)
    else if (activated) launcher.current?.focus()
  }, [visible, activated])
  useEffect(() => {
    if (wasBusy.current && !busy && !visible) setUnread(true)
    wasBusy.current = busy
  }, [busy, visible])
  useEffect(() => {
    if (visible) setUnread(false)
  }, [visible])

  return (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      <div hidden={visible} className="fixed right-6 bottom-6 z-20">
        <Button ref={launcher} aria-label={busy ? "Open agent, still replying" : unread ? "Open agent, new reply" : "Open agent"} aria-expanded={visible} onClick={toggleSidebar}>
          <MessageCircle data-icon="inline-start" />{title}
          {(busy || unread) && (
            <span className={`size-2 rounded-full bg-primary-foreground ${busy ? "animate-pulse" : ""}`} aria-hidden />
          )}
        </Button>
      </div>
      <Sidebar side="right" collapsible="offcanvas">
        <div inert={!visible} className="flex h-full min-h-0 flex-col">
          <SidebarHeader>
            <div className="flex min-w-0 items-center gap-1">
              {header ?? <h2 className="flex-1 truncate text-sm font-medium">{title}</h2>}
              {!isMobile && (
                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={wide ? "Narrow the agent" : "Widen the agent"} onClick={onToggleWide} />}>
                    {wide ? <Minimize2 /> : <Maximize2 />}
                  </TooltipTrigger>
                  <TooltipContent>{wide ? "Narrow" : "Widen"}</TooltipContent>
                </Tooltip>
              )}
              <Button variant="ghost" size="icon-sm" aria-label="Minimize agent" onClick={toggleSidebar}>
                <PanelRightClose />
              </Button>
            </div>
          </SidebarHeader>
          <SidebarContent className="overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">{activated ? agent : null}</div>
          </SidebarContent>
        </div>
      </Sidebar>
    </>
  )
}
