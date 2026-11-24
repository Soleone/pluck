import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { type ComponentProps, useEffect, useState } from "react"
import {
  Tooltip as StockTooltip,
  TooltipContent,
  TooltipProvider as StockTooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export { TooltipContent, TooltipTrigger }

const mountedTooltips = new Set<TooltipPrimitive.Handle<unknown>>()

function closeOpenTooltips() {
  for (const tooltip of mountedTooltips) if (tooltip.isOpen) tooltip.close()
}

/**
 * Stock TooltipProvider that closes every open tooltip when the window loses focus or is hidden:
 * leaving for another tab or app never sends the trigger a mouseleave, so a hover tooltip would
 * stay up until the pointer came back to it.
 */
export function TooltipProvider(props: ComponentProps<typeof StockTooltipProvider>) {
  useEffect(() => {
    function closeWhenHidden() {
      if (document.hidden) closeOpenTooltips()
    }
    window.addEventListener("blur", closeOpenTooltips)
    document.addEventListener("visibilitychange", closeWhenHidden)
    return () => {
      window.removeEventListener("blur", closeOpenTooltips)
      document.removeEventListener("visibilitychange", closeWhenHidden)
    }
  }, [])
  return <StockTooltipProvider {...props} />
}

/** Stock Tooltip that the provider can close when the window loses focus. */
export function Tooltip(props: Omit<ComponentProps<typeof StockTooltip>, "handle">) {
  const [handle] = useState(TooltipPrimitive.createHandle)
  useEffect(() => {
    mountedTooltips.add(handle)
    return () => {
      mountedTooltips.delete(handle)
    }
  }, [handle])
  return <StockTooltip handle={handle} {...props} />
}
