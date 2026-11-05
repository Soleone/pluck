import { useEffect, useRef, useState } from "react";
import { LoaderCircle, PanelLeft, Plus } from "lucide-react";
import { bridge, type AgentSession } from "@/bridge";
import {
  agentMessages,
  applyRecord,
  dialogReply,
  emptyTranscript,
  type Transcript,
} from "@/agent/pi";
import { AgentPanel } from "@/components/soleone/agent";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

/** The agents window: sessions on the left, the open one on the right. */
export function Agents() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({});
  /** null is a new session that starts with the first prompt. */
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string>();
  const running = useRef(new Set<string>());
  /** Hidden at first, so a new session has the window to itself. */
  const [sessionsShown, setSessionsShown] = useState(false);

  useEffect(() => void bridge.agentSessions().then(setSessions), []);
  useEffect(
    () =>
      bridge.onAgent(({ id, record, exited }) => {
        if (record) {
          const reply = dialogReply(record);
          if (reply) void bridge.agentSend(id, reply);
        } else running.current.delete(id);
        setTranscripts((current) => {
          const transcript = current[id] ?? emptyTranscript;
          const next = record
            ? applyRecord(transcript, record)
            : { ...transcript, busy: false, error: exited ?? undefined };
          return { ...current, [id]: next };
        });
      }),
    [],
  );
  useEffect(
    () => bridge.onAgentRequest(({ title, prompt }) => void start(title, prompt).catch(fail)),
    [],
  );

  function fail(caught: unknown) {
    setError(caught instanceof Error ? caught.message : String(caught));
  }

  /** Runs a session's process; pluck may have restarted since the session was last open. */
  async function run(id: string, title: string) {
    if (running.current.has(id)) return;
    await bridge.agentStart(id, title);
    running.current.add(id);
  }

  async function start(title: string, text: string) {
    const id = crypto.randomUUID();
    await run(id, title);
    setSessions(await bridge.agentSessions());
    setSelected(id);
    setError(undefined);
    await bridge.agentSend(id, { type: "prompt", message: text });
  }

  async function open(session: AgentSession) {
    setSelected(session.id);
    setError(undefined);
    if (running.current.has(session.id)) return;
    await run(session.id, session.title).catch(fail);
    await bridge.agentSend(session.id, { type: "get_messages" }).catch(fail);
  }

  async function send(text: string) {
    try {
      if (selected) {
        await run(selected, text);
        await bridge.agentSend(selected, { type: "prompt", message: text });
      } else await start(text, text);
      return true;
    } catch (caught) {
      fail(caught);
      return false;
    }
  }

  const transcript = (selected && transcripts[selected]) || emptyTranscript;

  return (
    <SidebarProvider className="h-full min-h-0">
      {sessionsShown && (
        <Sidebar collapsible="none">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={!selected} onClick={() => setSelected(null)}>
                  <Plus />
                  New session
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Sessions</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {sessions.map((session) => (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        isActive={session.id === selected}
                        title={session.title}
                        onClick={() => void open(session)}
                      >
                        <span className="truncate">{session.title}</span>
                        {transcripts[session.id]?.busy && <LoaderCircle className="animate-spin" />}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      )}
      <SidebarInset className="min-h-0">
        <header className="flex items-center gap-2 px-2 pt-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={sessionsShown ? "Hide sessions" : "Show sessions"}
            aria-pressed={sessionsShown}
            onClick={() => setSessionsShown(!sessionsShown)}
          >
            <PanelLeft />
          </Button>
          <span className="truncate font-medium">
            {sessions.find((session) => session.id === selected)?.title ?? "New session"}
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <AgentPanel
            key={selected ?? "new"}
            messages={agentMessages(transcript)}
            prompt={prompt}
            onPromptChange={setPrompt}
            busy={transcript.busy}
            error={error ?? transcript.error}
            placeholder="Ask Pi"
            emptyTitle={selected ? "Loading the session" : "New session"}
            emptyDescription={
              selected
                ? undefined
                : "Ask anything, or send text here with an agent action from the menu."
            }
            onSend={send}
            onStop={() =>
              selected && void bridge.agentSend(selected, { type: "abort" }).catch(fail)
            }
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
