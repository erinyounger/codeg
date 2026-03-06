"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { getFolderConversation } from "@/lib/tauri"
import type { DbConversationDetail } from "@/lib/types"

// Module-level cache: survives component unmount/remount
const detailCache = new Map<number, DbConversationDetail>()
const detailListeners = new Map<
  number,
  Set<(detail: DbConversationDetail) => void>
>()

function publishDetail(conversationId: number, detail: DbConversationDetail) {
  const listeners = detailListeners.get(conversationId)
  if (!listeners || listeners.size === 0) return
  for (const listener of listeners) {
    listener(detail)
  }
}

function setCachedDetail(conversationId: number, detail: DbConversationDetail) {
  detailCache.set(conversationId, detail)
  publishDetail(conversationId, detail)
}

function subscribeDetail(
  conversationId: number,
  listener: (detail: DbConversationDetail) => void
) {
  let listeners = detailListeners.get(conversationId)
  if (!listeners) {
    listeners = new Set()
    detailListeners.set(conversationId, listeners)
  }
  listeners.add(listener)

  return () => {
    const current = detailListeners.get(conversationId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      detailListeners.delete(conversationId)
    }
  }
}

/** Invalidate cached detail so the next mount re-fetches from disk. */
export function invalidateDetailCache(conversationId: number) {
  detailCache.delete(conversationId)
}

interface State {
  key: number
  detail: DbConversationDetail | null
  loading: boolean
  error: string | null
  fetchSeq: number
}

export function useDbMessageDetail(conversationId: number) {
  const getCachedState = useCallback((id: number): State => {
    const cached = detailCache.get(id)
    return {
      key: id,
      detail: cached ?? null,
      loading: !cached,
      error: null,
      fetchSeq: 0,
    }
  }, [])

  const [state, setState] = useState<State>(() => {
    return getCachedState(conversationId)
  })

  const derivedState =
    state.key === conversationId ? state : getCachedState(conversationId)

  useEffect(
    () =>
      subscribeDetail(conversationId, (detail) => {
        setState((prev) =>
          prev.key === conversationId
            ? { ...prev, detail, loading: false, error: null }
            : prev
        )
      }),
    [conversationId]
  )

  const refetch = useCallback(() => {
    detailCache.delete(conversationId)
    setState((prev) => {
      const base =
        prev.key === conversationId ? prev : getCachedState(conversationId)
      return {
        ...base,
        key: conversationId,
        loading: true,
        error: null,
        fetchSeq: base.fetchSeq + 1,
      }
    })
  }, [conversationId, getCachedState])

  useEffect(() => {
    // Skip fetch if cache already has data
    if (detailCache.has(conversationId)) return

    let cancelled = false
    getFolderConversation(conversationId)
      .then((d) => {
        setCachedDetail(conversationId, d)
        if (!cancelled) {
          setState((prev) =>
            prev.key === conversationId
              ? { ...prev, detail: d, loading: false, error: null }
              : {
                  key: conversationId,
                  detail: d,
                  loading: false,
                  error: null,
                  fetchSeq: 0,
                }
          )
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setState((prev) =>
            prev.key === conversationId
              ? {
                  ...prev,
                  error: e instanceof Error ? e.message : String(e),
                  loading: false,
                }
              : {
                  key: conversationId,
                  detail: null,
                  loading: false,
                  error: e instanceof Error ? e.message : String(e),
                  fetchSeq: 0,
                }
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, derivedState.fetchSeq])

  return useMemo(
    () => ({
      detail: derivedState.detail,
      loading: derivedState.loading,
      error: derivedState.error,
      refetch,
    }),
    [derivedState.detail, derivedState.loading, derivedState.error, refetch]
  )
}
