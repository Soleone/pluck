import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, LoaderCircle, Square, X } from "lucide-react";
import { bridge, type Card } from "@/bridge";
import { Button } from "@/components/ui/button";

/** How long a finished card stays while the pointer isn't on it. */
const DONE_MS = 4000;
const FAILED_MS = 8000;

/** Actions running in the background, their results and pluck's problems, newest at the bottom. */
export function Overlay() {
  const [cards, setCards] = useState<Card[]>([]);
  const stack = useRef<HTMLDivElement>(null);
  const empty = cards.length === 0;

  useEffect(
    () =>
      bridge.onCard((card) =>
        setCards((current) => {
          if (card.status === "stopped") return current.filter(({ id }) => id !== card.id);
          if (!current.some(({ id }) => id === card.id)) return [...current, card];
          return current.map((shown) => (shown.id === card.id ? card : shown));
        }),
      ),
    [],
  );

  // The window is only as big as the cards, so the screen around them stays clickable.
  useEffect(() => {
    const element = stack.current;
    if (!element) return void bridge.fitOverlay(0);
    const observer = new ResizeObserver(() => void bridge.fitOverlay(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [empty]);

  const dismiss = useCallback(
    (id: number) => setCards((current) => current.filter((card) => card.id !== id)),
    [],
  );

  if (empty) return null;
  return (
    <div ref={stack} className="flex flex-col gap-2 p-2">
      {cards.map((card) => (
        <OverlayCard key={card.id} card={card} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function OverlayCard({ card, onDismiss }: { card: Card; onDismiss: (id: number) => void }) {
  const [held, setHeld] = useState(false);
  const running = card.status === "running";

  useEffect(() => {
    if (running || held) return;
    const timer = setTimeout(
      () => onDismiss(card.id),
      card.status === "failed" ? FAILED_MS : DONE_MS,
    );
    return () => clearTimeout(timer);
  }, [running, held, card.id, card.status, onDismiss]);

  return (
    <div
      data-overlay-card
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      className="flex items-start gap-2.5 rounded-2xl border bg-popover py-2 pr-2 pl-3 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2"
    >
      <StatusIcon status={card.status} />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-sm font-medium">{card.title}</p>
        {card.text && (
          <p
            className={
              running
                ? "truncate text-xs text-muted-foreground"
                : "line-clamp-4 text-xs whitespace-pre-wrap text-muted-foreground"
            }
          >
            {card.text}
          </p>
        )}
      </div>
      {running ? (
        card.stoppable && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Stop"
            onClick={() => void bridge.stopRun(card.id)}
          >
            <Square className="fill-current" />
          </Button>
        )
      ) : (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          onClick={() => onDismiss(card.id)}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: Card["status"] }) {
  if (status === "running")
    return (
      <LoaderCircle
        aria-hidden
        className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
      />
    );
  if (status === "failed")
    return <CircleX aria-label="Failed" className="mt-1 size-4 shrink-0 text-destructive" />;
  return <CircleCheck aria-label="Done" className="menu-done mt-1 size-4 shrink-0 text-primary" />;
}
