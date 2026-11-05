import { useState } from "react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const PRESS: Keyframe[] = [
  { scale: 1 },
  { scale: 0.9, offset: 0.25, easing: "ease-out" },
  { scale: 1.04, offset: 0.65 },
  { scale: 1 },
]

/** Lucide's download icon, whose arrow drops on hover (after lucide-animated, MIT). */
function DownloadIcon({ dropped }: { dropped: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={16}
      width={16}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <motion.g
        animate={{ y: dropped ? 2 : 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 10, mass: 1 }}
      >
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" x2="12" y1="15" y2="3" />
      </motion.g>
    </svg>
  )
}

/**
 * The way from a live page to the real app, for the right corner. Below the xl breakpoint it
 * shrinks to its icon, and a tooltip names it.
 */
export function DownloadButton({
  href,
  label = "Download the app",
}: {
  href: string
  label?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="lg"
            className="px-3 shadow-lg max-xl:size-9 max-xl:px-0"
            // The tab opens on release, so the whole press plays out from the moment it starts.
            onPointerDown={(event) => {
              if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
                event.currentTarget.animate(PRESS, 300)
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            nativeButton={false}
            render={<a href={href} target="_blank" rel="noreferrer" />}
          >
            <DownloadIcon dropped={hovered} />
            <span className="max-xl:sr-only">{label}</span>
          </Button>
        }
      />
      <TooltipContent side="left" className="xl:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
