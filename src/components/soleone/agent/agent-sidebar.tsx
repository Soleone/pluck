import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { MessageCircle, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sidebar, SidebarContent, SidebarHeader, SidebarProvider, useSidebar } from "@/components/ui/sidebar"

/** An app-wide, independently scrolling agent dock. Sidebar supplies the mobile Sheet. */
export function AgentSidebar({ children, agent, title = "Agent" }: {
  children: ReactNode
  agent: ReactNode
  title?: string
}) {
  return (
    <SidebarProvider defaultOpen={false} style={{ "--sidebar-width": "24rem" } as CSSProperties}>
      <AgentSidebarLayout agent={agent} title={title}>{children}</AgentSidebarLayout>
    </SidebarProvider>
  )
}

function AgentSidebarLayout({ children, agent, title }: { children: ReactNode; agent: ReactNode; title: string }) {
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar()
  const visible = isMobile ? openMobile : open
  const [activated, setActivated] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (visible) setActivated(true)
    else if (activated) launcher.current?.focus()
  }, [visible, activated])

  return (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      <div hidden={visible} className="fixed right-6 bottom-6 z-20">
        <Button ref={launcher} aria-label="Open agent" aria-expanded={visible} onClick={toggleSidebar}>
          <MessageCircle data-icon="inline-start" />{title}
        </Button>
      </div>
      <Sidebar side="right" collapsible="offcanvas">
        <div inert={!visible} className="flex h-full min-h-0 flex-col">
          <SidebarHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">{title}</h2>
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
