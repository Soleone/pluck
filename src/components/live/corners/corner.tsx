import type { ReactNode, Ref } from "react"

const SIDES = {
  left: "left-4 md:left-8",
  right: "right-4 md:right-8",
}

/**
 * A bottom corner of a live page, floating over the app: the left one for a demo control (such
 * as sample data on and off), the right one for the way to the real app.
 */
export function Corner({
  side,
  ref,
  children,
}: {
  side: keyof typeof SIDES
  /** For an app that moves the corner itself, e.g. above a card that reaches under it. */
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div
      ref={ref}
      className={`fixed bottom-4 z-40 flex h-9 items-center motion-safe:transition-all md:bottom-8 ${SIDES[side]}`}
    >
      {children}
    </div>
  )
}
