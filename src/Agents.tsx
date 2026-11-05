import { useEffect, useRef, useState } from "react";
import { LoaderCircle, PanelLeft, Plus, X } from "lucide-react";
import { AgentDialog, type DialogAnswer } from "@/AgentDialog";
import { ago } from "@/agent/ago";
import { bridge, type AgentSession, type SessionModel } from "@/bridge";
import {
  agentMessages,
  applyRecord,
  dialogOf,
  emptyTranscript,
  type PiDialog,
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
  SidebarMenuAction,
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
  /** Questions from Pi's extensions, oldest first, with the session that asks. */
  const [dialogs, setDialogs] = useState<{ id: string; dialog: PiDialog }[]>([]);

  const loadSessions = () => void bridge.agentSessions().then(setSessions);
  useEffect(loadSessions, []);
  useEffect(
    () =>
      bridge.onAgent(({ id, record, exited }) => {
        if (record) {
          const dialog = dialogOf(record);
          if (dialog) setDialogs((current) => [...current, { id, dialog }]);
          // A finished run moves the session to the top with a new time.
          if (record.type === "agent_settled") loadSessions();
        } else {
          running.current.delete(id);
          setDialogs((current) => current.filter((asked) => asked.id !== id));
        }
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
    () =>
      bridge.onAgentRequest(
        ({ title, prompt, session, model, thinking }) =>
          void (
            session ? continueWith(session, prompt) : start(title, prompt, { model, thinking })
          ).catch(fail),
      ),
    [],
  );

  function fail(caught: unknown) {
    setError(caught instanceof Error ? caught.message : String(caught));
  }

  /** Runs a session's process; pluck may have restarted since the session was last open. */
  async function run(id: string, title: string, model?: SessionModel) {
    if (running.current.has(id)) return;
    await bridge.agentStart(id, title, model);
    running.current.add(id);
    await bridge.agentSend(id, { type: "get_state" });
  }

  async function start(title: string, text: string, model?: SessionModel) {
    const id = crypto.randomUUID();
    await run(id, title, model);
    setSessions(await bridge.agentSessions());
    setSelected(id);
    setError(undefined);
    await bridge.agentSend(id, { type: "prompt", message: text });
  }

  /** Runs a listed session again and loads its history, unless it is running. */
  async function resume(id: string) {
    setSelected(id);
    setError(undefined);
    if (running.current.has(id)) return;
    await run(id, "");
    await bridge.agentSend(id, { type: "get_messages" });
  }

  async function continueWith(id: string, text: string) {
    await resume(id);
    await bridge.agentSend(id, { type: "prompt", message: text });
  }

  async function remove(id: string) {
    await bridge.agentRemove(id).catch(fail);
    running.current.delete(id);
    setSessions((current) => current.filter((session) => session.id !== id));
    if (selected === id) setSelected(null);
  }

  function answer(id: string, dialog: PiDialog, reply: DialogAnswer) {
    setDialogs((current) => current.filter((asked) => asked.dialog !== dialog));
    void bridge
      .agentSend(id, { type: "extension_ui_response", id: dialog.id, ...reply })
      .catch(fail);
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
  const current = sessions.find((session) => session.id === selected);
  const asked = dialogs[0];

  return (
    <SidebarProvider className="h-full min-h-0">
      {/* Slides in and out; inert keeps the hidden list out of the tab order. */}
      <div
        inert={!sessionsShown}
        className={`overflow-hidden transition-all duration-200 ease-out ${sessionsShown ? "w-64" : "w-0"}`}
      >
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
                        size="lg"
                        isActive={session.id === selected}
                        title={session.title}
                        onClick={() => void resume(session.id).catch(fail)}
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{session.title}</span>
                          {session.lastActive > 0 && (
                            <span className="truncate text-xs text-muted-foreground">
                              {ago(session.lastActive)}
                            </span>
                          )}
                        </span>
                        {transcripts[session.id]?.busy && <LoaderCircle className="animate-spin" />}
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        aria-label="Remove session"
                        title="Remove from the list"
                        onClick={() => void remove(session.id)}
                      >
                        <X />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </div>
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
          <span className="truncate font-medium">{current?.title ?? "New session"}</span>
          {current && current.lastActive > 0 && (
            <span className="shrink-0 text-muted-foreground">{ago(current.lastActive)}</span>
          )}
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <AgentPanel
            key={selected ?? "new"}
            messages={agentMessages(transcript)}
            prompt={prompt}
            onPromptChange={setPrompt}
            busy={transcript.busy}
            model={transcript.model}
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
      {asked && (
        <AgentDialog
          key={asked.dialog.id}
          dialog={asked.dialog}
          session={sessions.find((session) => session.id === asked.id)?.title ?? "Pi"}
          onAnswer={(reply) => answer(asked.id, asked.dialog, reply)}
        />
      )}
    </SidebarProvider>
  );
}
