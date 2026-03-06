"use client"

import { useEffect, useState } from "react"
import { getConversation } from "@/lib/tauri"
import type { AgentType, ConversationDetail } from "@/lib/types"

interface MessageDetailState {
  key: string
  detail: ConversationDetail | null
  loading: boolean
  error: string | null
}

function makeKey(agentType: AgentType, conversationId: string): string {
  return `${agentType}:${conversationId}`
}

export function useMessageDetail(agentType: AgentType, conversationId: string) {
  const key = makeKey(agentType, conversationId)

  const [state, setState] = useState<MessageDetailState>({
    key,
    detail: null,
    loading: true,
    error: null,
  })

  // Reset when key changes (single setState instead of 4)
  if (state.key !== key) {
    setState({ key, detail: null, loading: true, error: null })
  }

  useEffect(() => {
    let cancelled = false
    getConversation(agentType, conversationId)
      .then((d) => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, detail: d, loading: false }))
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            error: e instanceof Error ? e.message : String(e),
            loading: false,
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [agentType, conversationId])

  return {
    detail: state.detail,
    loading: state.loading,
    error: state.error,
  }
}
