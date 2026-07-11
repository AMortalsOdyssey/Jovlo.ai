import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import { type PropsWithChildren, useState } from 'react'

import { AuthProvider } from '@/features/auth/AuthProvider'
import { ProductionBridge } from '@/store/ProductionBridge'

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <AuthProvider>
      <ProductionBridge />
      <QueryClientProvider client={queryClient}>
        <Tooltip.Provider delayDuration={350}>{children}</Tooltip.Provider>
      </QueryClientProvider>
    </AuthProvider>
  )
}
