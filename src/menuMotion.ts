/**
 * The menu's moves between folders and filters, after Tasks' category filter (its categoryFlight.ts
 * and useCategoryPush.ts): rows that go are pushed out past the list's left edge one after another,
 * rows that stay settle into place, new ones slide in from that edge, and a folder's name flies
 * between its row and the path.
 */

const PUSH_MS = 160;
const MOVE_MS = 200;
/** How long before one stage ends the next one starts. */
const OVERLAP_MS = 93;
/** Rows go this far apart, closer when many go, so the last starts within the span. */
const ROW_DELAY_MS = 17;
const STAGGER_SPAN_MS = 67;
const MAX_OVERSHOOT_PX = 8;
const FLIGHT_MS = 280;
/** How far the flying name stays solid before it hands over to its target. */
const HAND_OVER_AT = 0.75;
const PUSH_EASE = "cubic-bezier(.5,0,.9,.5)";
const SLIDE_EASE = "cubic-bezier(.2,.8,.2,1)";
const SWING_EASE = "cubic-bezier(.2,.7,.3,1)";

/** Rows are found by `data-row`; a folder's or the path's name to fly by `data-flight`. */
export type Shot = {
  view: DOMRect;
  rows: Map<string, { box: DOMRect; ghost: HTMLElement }>;
  /** The name that flies, copied where it stood. */
  flight: { box: DOMRect; ghost: HTMLElement } | null;
};

let running: Animation[] = [];
let leftovers: HTMLElement[] = [];

// jsdom has no Web Animations; there and with reduced motion nothing moves.
const plays = () =>
  typeof HTMLElement.prototype.animate === "function" &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;

function copy(element: HTMLElement): HTMLElement {
  const ghost = element.cloneNode(true) as HTMLElement;
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
    node.removeAttribute("id");
    node.removeAttribute("data-selected");
    node.removeAttribute("data-row");
    node.removeAttribute("data-flight");
  }
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  return ghost;
}

/** Where the rows stand before the list changes; `flightFrom` names the `data-flight` that flies. */
export function snapshot(list: HTMLElement, flightFrom: string | null): Shot | null {
  if (!plays()) return null;
  const view = list.getBoundingClientRect();
  const rows: Shot["rows"] = new Map();
  for (const row of list.querySelectorAll<HTMLElement>("[data-row]")) {
    const box = row.getBoundingClientRect();
    if (box.bottom > view.top && box.top < view.bottom)
      rows.set(row.dataset.row ?? "", { box, ghost: copy(row) });
  }
  const from = flightFrom && document.querySelector<HTMLElement>(`[data-flight="${flightFrom}"]`);
  const flight = from ? { box: from.getBoundingClientRect(), ghost: copy(from) } : null;
  // Out of its row it would lose the row's type.
  if (from && flight) {
    const style = getComputedStyle(from);
    Object.assign(flight.ghost.style, {
      font: style.font,
      color: style.color,
      whiteSpace: "nowrap",
    });
  }
  // Measured before stopping, so a quick reversal starts from where rows are mid-flight.
  stop();
  return { view, rows, flight };
}

export function stop(): void {
  for (const animation of running) animation.cancel();
  for (const element of leftovers) element.remove();
  running = [];
  leftovers = [];
}

const stagger = (count: number) =>
  count > 1 ? Math.min(ROW_DELAY_MS, STAGGER_SPAN_MS / (count - 1)) : 0;

/** Past its place by a tenth of the way, back a third of that, then still. */
function settle(dy: number): Keyframe[] {
  const over = Math.sign(dy) * Math.min(Math.abs(dy) * 0.1, MAX_OVERSHOOT_PX);
  return [
    { transform: `translateY(${dy}px)` },
    { offset: 0.62, transform: `translateY(${-over}px)` },
    { offset: 0.84, transform: `translateY(${over / 3}px)` },
    { transform: "none" },
  ];
}

function fixed(element: HTMLElement, box: DOMRect, zIndex: string): HTMLElement {
  Object.assign(element.style, {
    position: "fixed",
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex,
  });
  document.body.append(element);
  leftovers.push(element);
  return element;
}

/**
 * Plays the change from `shot` to what `list` shows now. The row and name with `flightTo` as their
 * `data-flight` are where the name lands; that row stays put while the name lands on it.
 */
export function play(shot: Shot, list: HTMLElement, flightTo: string | null): void {
  const view = list.getBoundingClientRect();
  const target = flightTo
    ? document.querySelector<HTMLElement>(`[data-flight="${flightTo}"]`)
    : null;
  const kept: [HTMLElement, number][] = [];
  const entering: [HTMLElement, DOMRect][] = [];
  const shown = new Set<string>();
  for (const row of list.querySelectorAll<HTMLElement>("[data-row]")) {
    const id = row.dataset.row ?? "";
    shown.add(id);
    if (target && row.contains(target)) continue;
    const box = row.getBoundingClientRect();
    const before = shot.rows.get(id);
    if (before) kept.push([row, before.box.top - box.top]);
    else if (box.bottom > view.top && box.top < view.bottom) entering.push([row, box]);
  }
  const leaving = [...shot.rows].filter(([id]) => !shown.has(id)).map(([, row]) => row);
  const moving = kept.filter(([, dy]) => Math.abs(dy) > 0.5);
  const leaveEnd = leaving.length ? PUSH_MS + stagger(leaving.length) * (leaving.length - 1) : 0;
  const moveAt = leaving.length ? leaveEnd - OVERLAP_MS : 0;
  const enterAt = moving.length ? moveAt + MOVE_MS - OVERLAP_MS : moveAt;

  if (leaving.length) {
    // Clipped to where the list was, so pushed rows vanish at its edge.
    const stage = fixed(document.createElement("div"), shot.view, "40");
    Object.assign(stage.style, { height: `${shot.view.height}px`, overflow: "hidden" });
    const step = stagger(leaving.length);
    leaving.forEach(({ box, ghost }, index) => {
      Object.assign(ghost.style, {
        position: "absolute",
        left: `${box.left - shot.view.left}px`,
        top: `${box.top - shot.view.top}px`,
        width: `${box.width}px`,
        margin: "0",
      });
      stage.append(ghost);
      running.push(
        ghost.animate(
          [{ transform: "none" }, { transform: `translateX(${shot.view.left - box.right}px)` }],
          { duration: PUSH_MS, delay: index * step, easing: PUSH_EASE, fill: "forwards" },
        ),
      );
    });
  }
  for (const [row, dy] of moving)
    running.push(
      row.animate(settle(dy), {
        duration: MOVE_MS,
        delay: moveAt,
        easing: SWING_EASE,
        fill: "backwards",
      }),
    );
  const step = stagger(entering.length);
  entering.forEach(([row, box], index) =>
    running.push(
      row.animate(
        [{ transform: `translateX(${view.left - box.right}px)` }, { transform: "none" }],
        { duration: PUSH_MS, delay: enterAt + index * step, easing: SLIDE_EASE, fill: "backwards" },
      ),
    ),
  );

  if (shot.flight && target) {
    const from = shot.flight.box;
    const to = target.getBoundingClientRect();
    const ghost = fixed(shot.flight.ghost, from, "50");
    const dx = to.left - from.left;
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    running.push(
      ghost.animate(
        [
          { transform: "none", opacity: 1 },
          { offset: HAND_OVER_AT, opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
        ],
        { duration: FLIGHT_MS, easing: SLIDE_EASE, fill: "forwards" },
      ),
      target.animate([{ opacity: 0 }, { offset: HAND_OVER_AT, opacity: 0 }, { opacity: 1 }], {
        duration: FLIGHT_MS,
        easing: SLIDE_EASE,
      }),
    );
  }
  void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
    if (running.every((animation) => animation.playState === "finished")) stop();
  });
}
