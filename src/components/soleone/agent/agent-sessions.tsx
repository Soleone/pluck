import { useState } from "react"
import { ChevronDown, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/soleone/tooltip/tooltip"

export type AgentSessionItem = {
  id: string
  title: string
  /** Epoch ms of the last message. */
  lastActive: number
  /** Shown after the title in the list, like the agent it runs with. */
  detail?: string
  /** Still replying, shown as a dot. */
  busy?: boolean
}

const dayMs = 86_400_000

/** "now", "5m", "3h", then a weekday within the week, then the date. */
function when(time: number, now: number) {
  const minutes = Math.floor((now - time) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`
  const options: Intl.DateTimeFormatOptions = now - time < 7 * dayMs ? { weekday: "short" } : { month: "short", day: "numeric" }
  return new Date(time).toLocaleDateString(undefined, options)
}

/**
 * The current session's title, opening a searchable list of earlier ones, plus a New button. Made for
 * AgentSidebar's `header`. `current` is null for a new session that has no title yet.
 */
export function AgentSessionSwitcher({ sessions, current, onSelect, onNew, newLabel = "New chat" }: {
  sessions: AgentSessionItem[]
  current: string | null
  onSelect: (id: string) => void
  onNew: () => void
  newLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const now = Date.now()
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const shown = [...sessions]
    .sort((a, b) => b.lastActive - a.lastActive)
    .filter((session) => session.title.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = [
    { label: "Today", sessions: shown.filter((session) => session.lastActive >= startOfToday) },
    { label: "Earlier", sessions: shown.filter((session) => session.lastActive < startOfToday) },
  ].filter((group) => group.sessions.length > 0)
  const title = sessions.find((session) => session.id === current)?.title ?? newLabel

  function pick(choose: () => void) {
    choose()
    setOpen(false)
    setQuery("")
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" />}>
          <span className="truncate font-medium">{title}</span>
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-1 p-1.5">
          <Input
            autoFocus
            value={query}
            placeholder="Search chats"
            aria-label="Search chats"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && shown[0] && pick(() => onSelect(shown[0].id))}
          />
          <div className="flex max-h-80 flex-col overflow-y-auto">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label} className="flex flex-col">
                <h3 className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
                {group.sessions.map((session) => (
                  <Button
                    key={session.id}
                    variant={session.id === current ? "secondary" : "ghost"}
                    size="sm"
                    className="justify-start font-normal"
                    aria-current={session.id === current || undefined}
                    onClick={() => pick(() => onSelect(session.id))}
                  >
                    <span className={`size-1.5 shrink-0 rounded-full ${session.busy ? "bg-primary" : ""}`} aria-label={session.busy ? "Replying" : undefined} />
                    <span className="min-w-0 flex-1 truncate text-left">{session.title}</span>
                    {session.detail && <span className="text-xs text-muted-foreground">{session.detail}</span>}
                    <span className="text-xs text-muted-foreground tabular-nums">{when(session.lastActive, now)}</span>
                  </Button>
                ))}
              </section>
            ))}
            {groups.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">{sessions.length ? "No chats match." : "No earlier chats yet."}</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={newLabel} disabled={current === null} onClick={onNew} />}>
          <Plus />
        </TooltipTrigger>
        <TooltipContent>{newLabel}</TooltipContent>
      </Tooltip>
    </>
  )
}
