"use client"

import { memo, useId, useState, type Dispatch, type SetStateAction, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import { ArrowUp, Brain, Globe, Square, TextQuote, Wrench } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea,
} from "@/components/ui/input-group"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent,
  MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger,
  TraceIcon, TraceLine, TraceTitle,
} from "@/components/ui/trace"

export type AgentTool = {
  id: string
  name: string
  /** The step's title for its current status: "Searching the web", "Searched the web", "Failed to search the web". */
  label: string
  status: "running" | "complete" | "error"
  output?: string
  /** Web pages the step searched or read, shown as site chips under its title. */
  sources?: AgentSource[]
  data?: unknown
}

export type AgentSource = { url: string; title?: string }

/** Text a user message is about, such as a selection, shown above the message and open at first. */
export type AgentQuote = {
  text: string
  /** Where the text came from, like "Mail · Your order". */
  source: string
  href?: string
}

export type AgentMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  quote?: AgentQuote
  tools?: AgentTool[]
}

type AgentPanelProps = {
  messages: AgentMessage[]
  prompt: string
  onPromptChange: Dispatch<SetStateAction<string>>
  busy: boolean
  disabled?: boolean
  error?: string
  placeholder?: string
  emptyTitle?: string
  emptyDescription?: string
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  renderTool?: (tool: AgentTool) => ReactNode
  /** The model and thinking level the conversation runs with, shown under the composer. */
  model?: { name: string; thinking: string }
}

type AgentTurn = { id: string; role: AgentMessage["role"]; messages: AgentMessage[] }

type AgentBlock =
  | { type: "text"; text: string }
  | { type: "steps"; tools: AgentTool[] }
  | { type: "result"; id: string; node: ReactNode }

/** Consecutive assistant messages form one turn, so a research loop reads as one reply. */
function turnsOf(messages: AgentMessage[]) {
  const turns: AgentTurn[] = []
  for (const message of messages) {
    const last = turns.at(-1)
    if (message.role === "assistant" && last?.role === "assistant") last.messages.push(message)
    else turns.push({ id: message.id, role: message.role, messages: [message] })
  }
  return turns
}

/** Adjacent steps share one Trace; text or a custom result between them starts a new one. */
function blocksOf(messages: AgentMessage[], renderTool?: (tool: AgentTool) => ReactNode) {
  const blocks: AgentBlock[] = []
  for (const message of messages) {
    if (message.text) blocks.push({ type: "text", text: message.text })
    for (const tool of message.tools ?? []) {
      const node = renderTool?.(tool)
      const last = blocks.at(-1)
      if (node != null) blocks.push({ type: "result", id: tool.id, node })
      else if (last?.type === "steps") last.tools.push(tool)
      else blocks.push({ type: "steps", tools: [tool] })
    }
  }
  return blocks
}

function SiteIcon({ host }: { host: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return <Globe />
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      alt=""
      className="size-3 shrink-0 rounded-sm"
      onError={() => setMissing(true)}
    />
  )
}

const shownSites = 6

/** One chip per site, so ten results from two sites read as two. */
function Sources({ sources }: { sources: AgentSource[] }) {
  const sites = new Map<string, AgentSource>()
  for (const source of sources) {
    const host = new URL(source.url).hostname
    if (!sites.has(host)) sites.set(host, source)
  }
  const hidden = sites.size - shownSites
  return (
    <ul aria-label="Sources" className="flex flex-wrap gap-1 pl-6">
      {[...sites].slice(0, shownSites).map(([host, source]) => (
        <li key={host}>
          <Badge
            variant="outline"
            render={<a href={source.url} target="_blank" rel="noopener noreferrer" title={source.title ?? source.url} />}
          >
            <SiteIcon host={host} />
            {host.replace(/^www\./, "")}
          </Badge>
        </li>
      ))}
      {hidden > 0 && <li><Badge variant="secondary">+{hidden}</Badge></li>}
    </ul>
  )
}

function ToolStep({ tool }: { tool: AgentTool }) {
  const line = (
    <TraceLine status={tool.status === "complete" ? undefined : tool.status}>
      <TraceIcon>{tool.sources ? <Globe /> : <Wrench />}</TraceIcon>
      <TraceTitle>{tool.label}</TraceTitle>
    </TraceLine>
  )
  const step = tool.output ? (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{tool.output}</pre>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  ) : line
  if (!tool.sources?.length) return step
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {step}
      <Sources sources={tool.sources} />
    </div>
  )
}

function QuoteStep({ quote }: { quote: AgentQuote }) {
  return (
    <Trace>
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon><TextQuote /></TraceIcon>
            <TraceTitle>{quote.source}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <p className="max-h-48 overflow-auto whitespace-pre-wrap text-foreground">{quote.text}</p>
          {quote.href && (
            <a href={quote.href} target="_blank" rel="noopener noreferrer" className="block truncate text-xs underline underline-offset-4">
              {quote.href}
            </a>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/** Memoized: typing in the composer or host state changes would otherwise re-parse every reply. */
const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm leading-relaxed wrap-break-word">
      <ReactMarkdown
        skipHtml
        allowedElements={["p", "strong", "em", "a", "ul", "ol", "li", "code", "pre", "br", "blockquote"]}
        components={{
          a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{children}</a>,
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          pre: ({ children }) => <pre className="overflow-auto whitespace-pre-wrap">{children}</pre>,
        }}
      >{text}</ReactMarkdown>
    </div>
  )
})

/** Controlled UI only. The host owns transport, credentials, tools, and approval policy. */
export function AgentPanel({
  messages, prompt, onPromptChange, busy, disabled = false, error, onSend, onStop, renderTool, model,
  placeholder = "Ask the agent…",
  emptyTitle = "What would you like to do?",
  emptyDescription = "Ask a question or describe a change. You stay in control of what gets applied.",
}: AgentPanelProps) {
  const [sending, setSending] = useState(false)
  const [submissionError, setSubmissionError] = useState("")
  const currentError = error || submissionError
  const promptId = useId()
  const working = busy || sending

  async function send() {
    const text = prompt.trim()
    if (!text || working || disabled) return
    setSending(true)
    setSubmissionError("")
    try {
      if (await onSend(text)) onPromptChange((current) => current.trim() === text ? "" : current)
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Could not send. Please try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <section aria-label="Agent conversation" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1">
        <MessageScrollerProvider autoScroll>
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent>
                {messages.length === 0 ? (
                  <MessageScrollerItem messageId="empty">
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>{emptyTitle}</EmptyTitle>
                        <EmptyDescription>{emptyDescription}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </MessageScrollerItem>
                ) : turnsOf(messages).map((turn) => (
                  <MessageScrollerItem key={turn.id} messageId={turn.id} scrollAnchor={turn.role === "user"}>
                    <Message align={turn.role === "user" ? "end" : "start"}>
                      <MessageContent>
                        {turn.role === "user" ? (
                          <div className="flex min-w-0 flex-col items-end gap-2">
                            {turn.messages[0].quote && <QuoteStep quote={turn.messages[0].quote} />}
                            <Bubble align="end" variant="muted">
                              <BubbleContent className="whitespace-pre-wrap">{turn.messages[0].text}</BubbleContent>
                            </Bubble>
                          </div>
                        ) : (
                          <div className="flex min-w-0 flex-col gap-3">
                            {blocksOf(turn.messages, renderTool).map((block, index) =>
                              block.type === "text" ? <AssistantText key={index} text={block.text} />
                              : block.type === "steps" ? (
                                <Trace key={block.tools[0].id}>
                                  {block.tools.map((tool) => <ToolStep key={tool.id} tool={tool} />)}
                                </Trace>
                              ) : <div key={block.id} className="min-w-0">{block.node}</div>
                            )}
                          </div>
                        )}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      </div>
      {currentError && (
        <Alert variant="destructive">
          <AlertTitle>The agent could not continue</AlertTitle>
          <AlertDescription>{currentError}</AlertDescription>
        </Alert>
      )}
      <form className="shrink-0" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <label htmlFor={promptId} className="sr-only">Message the agent</label>
        <InputGroup>
          <InputGroupTextarea
            id={promptId}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            className="max-h-40"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={4000}
            rows={2}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            {working ? (
              <InputGroupButton type="button" size="sm" variant="outline" onClick={onStop} disabled={sending || disabled}>
                <Square data-icon="inline-start" />Stop
              </InputGroupButton>
            ) : (
              // A disabled empty Send button would make InputGroup dim the editable textarea too.
              <InputGroupButton type="submit" size="sm" variant={prompt.trim() ? "default" : "secondary"} disabled={disabled} aria-disabled={disabled || !prompt.trim()}>
                <ArrowUp data-icon="inline-start" />Send
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p role="status" className="truncate text-xs text-muted-foreground">
          {working ? "Agent working. You can stop it at any time." : "Enter to send. Shift+Enter for a new line."}
        </p>
        {model && (
          <Badge variant="secondary" title={`Model ${model.name}, thinking ${model.thinking}`}>
            <Brain />{model.name} · {model.thinking}
          </Badge>
        )}
      </div>
    </section>
  )
}
