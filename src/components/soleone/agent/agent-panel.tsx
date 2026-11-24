import { memo, useEffect, useId, useRef, useState, type ClipboardEvent, type Dispatch, type SetStateAction, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowUp, Brain, CornerDownLeft, Globe, Layers, LoaderCircle, Square, TextQuote, Wrench, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea,
} from "@/components/ui/input-group"
import { Message, MessageContent } from "@/components/ui/message"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/soleone/tooltip/tooltip"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent,
  MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger,
  TraceIcon, TraceLine, TraceTitle,
} from "@/components/ui/trace"
import { askUser } from "./ask-user"
import { QuestionCard, questionOf } from "./agent-question"

export type AgentTool = {
  id: string
  name: string
  /** The step's title for its current status: "Searching the web", "Searched the web", "Failed to search the web". */
  label: string
  status: "running" | "complete" | "error"
  /** The full call, like the whole command, shown when the step opens since the title may cut it short. */
  input?: string
  /** The call's arguments as the model sent them. The panel reads an `ask_user` question from them. */
  arguments?: Record<string, unknown>
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

/** A pasted image, base64 without the data: prefix, as Pi's RPC and Claude's API take it. */
export type AgentImage = { data: string; mimeType: string }

/** An app item a reply links to, like a job, drawn as a chip that opens it. */
export type AgentReference = {
  /** The item's current name and state, shown on hover. */
  title: string
  icon?: ReactNode
  onOpen: () => void
}

/** Finds the app item a link in a reply names, like `[Units CLI](factory:job/fab68001)`. Links it doesn't know stay links. */
export type AgentReferences = (href: string) => AgentReference | undefined

export type AgentMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  quote?: AgentQuote
  images?: AgentImage[]
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
  /** Prompts offered while the conversation is empty; picking one fills the composer. */
  suggestions?: string[]
  onSend: (text: string, images: AgentImage[]) => Promise<boolean>
  onStop: () => void
  /** Lets the user paste images into the composer; they reach onSend. */
  acceptImages?: boolean
  references?: AgentReferences
  renderTool?: (tool: AgentTool) => ReactNode
  /** The model and thinking level the conversation runs with, shown under the composer. */
  model?: { name: string; thinking: string }
  /** Opens from the model badge, for example AgentModelFields. */
  modelPicker?: ReactNode
  /** Tokens the session's context holds now, shown in thousands under the composer. */
  contextTokens?: number
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge
                  variant="outline"
                  render={<a href={source.url} target="_blank" rel="noopener noreferrer" />}
                />
              }
            >
              <SiteIcon host={host} />
              {host.replace(/^www\./, "")}
            </TooltipTrigger>
            <TooltipContent className="wrap-anywhere">{source.title ?? source.url}</TooltipContent>
          </Tooltip>
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
  const step = tool.input || tool.output ? (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        {tool.input && (
          <pre className="max-h-48 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-foreground">{tool.input}</pre>
        )}
        {tool.output && (
          <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap wrap-anywhere">{tool.output}</pre>
        )}
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

const imageSrc = (image: AgentImage) => `data:${image.mimeType};base64,${image.data}`

function readImage(file: File) {
  return new Promise<AgentImage>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      resolve({ mimeType: file.type, data: url.slice(url.indexOf(",") + 1) })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function ReferenceChip({ reference, children }: { reference: AgentReference; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={reference.onOpen}
            className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border bg-muted px-1.5 align-bottom font-medium text-foreground hover:bg-accent [&_svg]:size-3.5 [&_svg]:shrink-0"
          />
        }
      >
        {reference.icon}<span className="truncate">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{reference.title}</TooltipContent>
    </Tooltip>
  )
}

/** Memoized: typing in the composer would otherwise re-parse every reply. */
const AssistantText = memo(function AssistantText({ text, references }: { text: string; references?: AgentReferences }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm leading-relaxed wrap-break-word">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        allowedElements={[
          "p", "strong", "em", "del", "a", "ul", "ol", "li", "code", "pre", "br", "blockquote", "hr",
          "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td",
        ]}
        // Keeps app links like factory:job/… that the default would drop as an unknown protocol.
        urlTransform={(url) => references?.(url) ? url : defaultUrlTransform(url)}
        components={{
          a: ({ children, href }) => {
            const reference = href ? references?.(href) : undefined
            if (reference) return <ReferenceChip reference={reference}>{children}</ReferenceChip>
            if (!href) return <>{children}</>
            return <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{children}</a>
          },
          h1: ({ children }) => <h3 className="mt-2 text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="mt-2 text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="mt-1 font-semibold">{children}</h4>,
          h4: ({ children }) => <h4 className="mt-1 font-semibold">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
          hr: () => <hr className="border-border" />,
          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
          pre: ({ children }) => <pre className="overflow-auto rounded-md bg-muted p-2 whitespace-pre-wrap [&_code]:p-0">{children}</pre>,
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          tr: ({ children }) => <tr className="border-b last:border-b-0">{children}</tr>,
          th: ({ children, style }) => <th style={style} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{children}</th>,
          td: ({ children, style }) => <td style={style} className="px-2 py-1.5 align-top">{children}</td>,
        }}
      >{text}</ReactMarkdown>
    </div>
  )
})

/** Controlled UI only. The host owns transport, credentials, tools, and approval policy. */
const compact = new Intl.NumberFormat("en", { notation: "compact" })

export function AgentPanel({
  messages, prompt, onPromptChange, busy, disabled = false, error, onSend, onStop, renderTool, model, modelPicker, contextTokens, suggestions,
  acceptImages = false, references,
  placeholder = "Ask the agent…",
  emptyTitle = "What would you like to do?",
  emptyDescription = "Ask a question or describe a change. You stay in control of what gets applied.",
}: AgentPanelProps) {
  const [sending, setSending] = useState(false)
  const [submissionError, setSubmissionError] = useState("")
  const [images, setImages] = useState<AgentImage[]>([])
  const currentError = error || submissionError
  const promptId = useId()
  const working = busy || sending
  const empty = messages.length === 0
  const textarea = useRef<HTMLTextAreaElement>(null)
  const wasEmpty = useRef(empty)

  // A conversation emptying means a new session started, so the composer is where the user goes next.
  // Not on mount, where it would steal focus from the page.
  useEffect(() => {
    if (empty && !wasEmpty.current) textarea.current?.focus()
    wasEmpty.current = empty
  }, [empty])

  // Answers to ask_user send without the composer's draft.
  async function send(text = prompt.trim(), sent = images) {
    if ((!text && sent.length === 0) || working || disabled) return
    setSending(true)
    setSubmissionError("")
    try {
      if (await onSend(text, sent)) {
        onPromptChange((current) => current.trim() === text ? "" : current)
        setImages((current) => current.filter((image) => !sent.includes(image)))
      }
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Could not send. Please try again.")
    } finally {
      setSending(false)
    }
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"))
    if (!acceptImages || files.length === 0) return
    event.preventDefault()
    Promise.all(files.map(readImage)).then(
      (pasted) => setImages((current) => [...current, ...pasted]),
      () => setSubmissionError("Could not read the pasted image."),
    )
  }

  const turns = turnsOf(messages)
  // A question is answered once any message follows its turn.
  const renderStep = (answered: boolean) => (tool: AgentTool) => {
    const custom = renderTool?.(tool)
    if (custom != null) return custom
    const question = tool.name === askUser.name && tool.status === "complete" ? questionOf(tool.arguments) : undefined
    return question && (
      <QuestionCard question={question} locked={answered || working || disabled} onAnswer={(text) => void send(text, [])} />
    )
  }

  return (
    <section aria-label="Agent conversation" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1">
        <MessageScrollerProvider autoScroll>
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent>
                {empty ? (
                  <MessageScrollerItem messageId="empty">
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>{emptyTitle}</EmptyTitle>
                        <EmptyDescription>{emptyDescription}</EmptyDescription>
                      </EmptyHeader>
                      {suggestions && suggestions.length > 0 && (
                        <EmptyContent className="items-stretch">
                          {suggestions.map((suggestion) => (
                            <Button
                              key={suggestion}
                              variant="outline"
                              className="h-auto justify-start py-2 text-left whitespace-normal"
                              disabled={disabled}
                              onClick={() => onPromptChange(suggestion)}
                            >
                              {suggestion}
                            </Button>
                          ))}
                        </EmptyContent>
                      )}
                    </Empty>
                  </MessageScrollerItem>
                ) : turns.map((turn, index) => (
                  <MessageScrollerItem key={turn.id} messageId={turn.id} scrollAnchor={turn.role === "user"}>
                    <Message align={turn.role === "user" ? "end" : "start"}>
                      <MessageContent>
                        {turn.role === "user" ? (
                          <div className="flex min-w-0 flex-col items-end gap-2">
                            {turn.messages[0].quote && <QuoteStep quote={turn.messages[0].quote} />}
                            {turn.messages[0].images?.map((image, index) => (
                              <img key={index} src={imageSrc(image)} alt="" className="max-h-48 max-w-full rounded-lg border object-contain" />
                            ))}
                            {turn.messages[0].text && (
                              <Bubble align="end" variant="muted">
                                <BubbleContent className="whitespace-pre-wrap">{turn.messages[0].text}</BubbleContent>
                              </Bubble>
                            )}
                          </div>
                        ) : (
                          <div className="flex min-w-0 flex-col gap-3">
                            {blocksOf(turn.messages, renderStep(index < turns.length - 1)).map((block, blockIndex) =>
                              block.type === "text" ? <AssistantText key={blockIndex} text={block.text} references={references} />
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
          {images.length > 0 && (
            <InputGroupAddon align="block-start" className="flex-wrap">
              {images.map((image, index) => (
                <div key={index} className="relative">
                  <img src={imageSrc(image)} alt={`Pasted image ${index + 1}`} className="size-14 rounded-md border object-cover" />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-xs"
                    className="absolute -top-1.5 -right-1.5 rounded-full"
                    aria-label={`Remove pasted image ${index + 1}`}
                    onClick={() => setImages((current) => current.filter((each) => each !== image))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            ref={textarea}
            id={promptId}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onPaste={paste}
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
              <InputGroupButton type="submit" size="sm" variant={prompt.trim() || images.length ? "default" : "secondary"} disabled={disabled} aria-disabled={disabled || (!prompt.trim() && !images.length)}>
                <ArrowUp data-icon="inline-start" />Send
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <p role="status" className="flex shrink-0 items-center gap-1.5">
          {working ? (
            <><LoaderCircle className="size-3.5 animate-spin" aria-hidden />Working</>
          ) : (
            <>
              <Kbd aria-label="Enter"><CornerDownLeft /></Kbd>send
              <Kbd aria-label="Shift Enter" className="ml-1">⇧<CornerDownLeft /></Kbd>line
            </>
          )}
        </p>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {contextTokens !== undefined && (
            <Tooltip>
              <TooltipTrigger render={<Badge variant="outline" className="shrink-0" />}>
                <Layers />{compact.format(contextTokens)}
              </TooltipTrigger>
              <TooltipContent>Context {contextTokens.toLocaleString()} tokens</TooltipContent>
            </Tooltip>
          )}
          {modelPicker ? (
            <Popover>
              <PopoverTrigger render={<Button variant="secondary" size="xs" className="min-w-0" aria-label="Change model" />}>
                <Brain data-icon="inline-start" /><span className="truncate">{model ? `${model.name} · ${model.thinking}` : "Model"}</span>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="w-80">{modelPicker}</PopoverContent>
            </Popover>
          ) : model && (
            <Tooltip>
              <TooltipTrigger render={<Badge variant="secondary" className="min-w-0" />}>
                <Brain /><span className="truncate">{model.name} · {model.thinking}</span>
              </TooltipTrigger>
              <TooltipContent>Model {model.name}, thinking {model.thinking}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </section>
  )
}
