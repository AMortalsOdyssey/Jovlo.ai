import * as Tooltip from '@radix-ui/react-tooltip'
import { createContext, useContext, type ComponentProps, type PropsWithChildren, type ReactElement } from 'react'

import './ui.css'

export interface HoverTooltipProps {
  children: ReactElement
  label: string
  side?: ComponentProps<typeof Tooltip.Content>['side']
  align?: ComponentProps<typeof Tooltip.Content>['align']
}

const HoverTooltipProviderContext = createContext(false)

export function HoverTooltipProvider({ children }: PropsWithChildren) {
  return (
    <HoverTooltipProviderContext.Provider value>
      <Tooltip.Provider delayDuration={350} skipDelayDuration={180} disableHoverableContent>
        {children}
      </Tooltip.Provider>
    </HoverTooltipProviderContext.Provider>
  )
}

export function HoverTooltip({ children, label, side = 'bottom', align = 'center' }: HoverTooltipProps) {
  const hasProvider = useContext(HoverTooltipProviderContext)
  const tooltip = (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="jovlo-tooltip"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          avoidCollisions
        >
          {label}
          <Tooltip.Arrow className="jovlo-tooltip__arrow" width={10} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )

  return hasProvider ? tooltip : <HoverTooltipProvider>{tooltip}</HoverTooltipProvider>
}
