"use client"

import { memo, useEffect, useMemo, useRef } from "react"
import { useDbMessageDetail } from "@/hooks/use-db-message-detail"
import { ContentPartsRenderer } from "./content-parts-renderer"
import {
  adaptMessageTurns,
  type AdaptedMessage,
  type AdaptedContentPart,
  type MessageGroup,
  type UserResourceDisplay,
  groupAdaptedMessages,
  extractUserResourcesFromText,
} from "@/lib/adapters/ai-elements-adapter"
import { TurnStats } from "./turn-stats"
import { LiveTurnStats } from "./live-turn-stats"
import { UserResourceLinks } from "./user-resource-links"
import { useSessionStats } from "@/contexts/session-stats-context"
import { LiveMessageBlock } from "@/components/chat/live-message-block"
import { AgentPlanOverlay } from "@/components/chat/agent-plan-overlay"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import {
  MessageThread,
  MessageThreadContent,
} from "@/components/ai-elements/message-thread"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { Loader2 } from "lucide-react"
import {
  buildPlanKey,
  extractLatestPlanEntriesFromMessages,
} from "@/lib/agent-plan"

import type { ConnectionStatus } from "@/lib/types"

interface MessageListViewProps {
  conversationId: number
  connStatus?: ConnectionStatus | null
  liveMessage?: LiveMessage | null
  pendingMessages?: AdaptedMessage[]
  onPendingClear?: () => void
  isActive?: boolean
}

interface ResolvedMessageGroup extends MessageGroup {
  parts: AdaptedContentPart[]
  resources: UserResourceDisplay[]
}

function fallbackExtractUserResources(group: MessageGroup): {
  parts: AdaptedContentPart[]
  resources: UserResourceDisplay[]
} {
  if (group.role !== "user") {
    return {
      parts: group.parts,
      resources: group.userResources ?? [],
    }
  }

  const parsedResources: UserResourceDisplay[] = []
  const parsedParts: AdaptedContentPart[] = []

  for (const part of group.parts) {
    if (part.type !== "text") {
      parsedParts.push(part)
      continue
    }
    const extracted = extractUserResourcesFromText(part.text)
    if (extracted.resources.length > 0) {
      parsedResources.push(...extracted.resources)
      if (extracted.text.length > 0) {
        parsedParts.push({ type: "text", text: extracted.text })
      }
    } else {
      parsedParts.push(part)
    }
  }

  const resources = [...(group.userResources ?? []), ...parsedResources]
  const dedupedResources: UserResourceDisplay[] = []
  const seen = new Set<string>()
  for (const resource of resources) {
    const key = `${resource.name}::${resource.uri}`
    if (seen.has(key)) continue
    seen.add(key)
    dedupedResources.push(resource)
  }

  if (parsedParts.length === 0 && dedupedResources.length > 0) {
    parsedParts.push({ type: "text", text: "Attached resources" })
  }

  return { parts: parsedParts, resources: dedupedResources }
}

function resolveMessageGroup(group: MessageGroup): ResolvedMessageGroup {
  const resolved = fallbackExtractUserResources(group)
  return {
    ...group,
    parts: resolved.parts,
    resources: resolved.resources,
  }
}

const HistoricalMessageGroup = memo(function HistoricalMessageGroup({
  group,
}: {
  group: ResolvedMessageGroup
}) {
  return (
    <div
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: "auto 120px",
      }}
    >
      <Message from={group.role}>
        <MessageContent>
          <ContentPartsRenderer parts={group.parts} role={group.role} />
        </MessageContent>
        {group.role === "user" && group.resources.length > 0 ? (
          <UserResourceLinks resources={group.resources} className="self-end" />
        ) : null}
      </Message>
      {group.role === "assistant" && (
        <TurnStats
          usage={group.usage}
          duration_ms={group.duration_ms}
          model={group.model}
          models={group.models}
        />
      )}
    </div>
  )
})

const PendingMessageGroup = memo(function PendingMessageGroup({
  group,
}: {
  group: ResolvedMessageGroup
}) {
  return (
    <div className="opacity-70">
      <Message from={group.role}>
        <MessageContent>
          <ContentPartsRenderer parts={group.parts} role={group.role} />
        </MessageContent>
        {group.role === "user" && group.resources.length > 0 ? (
          <UserResourceLinks resources={group.resources} className="self-end" />
        ) : null}
      </Message>
    </div>
  )
})

export function MessageListView({
  conversationId,
  connStatus,
  liveMessage,
  pendingMessages,
  onPendingClear,
  isActive = true,
}: MessageListViewProps) {
  const { detail, loading, error, refetch } = useDbMessageDetail(conversationId)
  const turnCount = detail?.turns.length ?? 0

  // Refetch when agent turn completes (prompting → other status)
  const prevStatusRef = useRef(connStatus)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = connStatus
    if (prev === "prompting" && connStatus && connStatus !== "prompting") {
      refetch()
    }
  }, [connStatus, refetch])

  // Clear pending when detail gains new turns (new data fetched successfully)
  const prevTurnCountRef = useRef(turnCount)
  const prevConvIdRef = useRef(conversationId)
  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      // Conversation switched — reset baseline, don't clear
      prevConvIdRef.current = conversationId
      prevTurnCountRef.current = turnCount
      return
    }
    if (turnCount > prevTurnCountRef.current && onPendingClear) {
      onPendingClear()
    }
    prevTurnCountRef.current = turnCount
  }, [turnCount, onPendingClear, conversationId])

  const { setSessionStats } = useSessionStats()
  const sessionStats = detail?.session_stats ?? null

  useEffect(() => {
    if (isActive) {
      setSessionStats(sessionStats)
    }
  }, [isActive, sessionStats, setSessionStats])

  // Track whether the initial scroll has happened.
  // After that, disable resize-triggered scroll so tab switches
  // don't jump to the bottom.
  const shouldUseSmoothResize = !(isActive && !loading && detail)

  const messages = useMemo(
    () => (detail ? adaptMessageTurns(detail.turns) : []),
    [detail]
  )

  const groups = useMemo(() => groupAdaptedMessages(messages), [messages])
  const historicalPlanEntries = useMemo(
    () => extractLatestPlanEntriesFromMessages(messages),
    [messages]
  )
  const historicalPlanKey = useMemo(
    () => buildPlanKey(historicalPlanEntries),
    [historicalPlanEntries]
  )

  const pendingGroups = useMemo(
    () =>
      pendingMessages?.length ? groupAdaptedMessages(pendingMessages) : [],
    [pendingMessages]
  )
  const resolvedGroups = useMemo(
    () => groups.map(resolveMessageGroup),
    [groups]
  )
  const resolvedPendingGroups = useMemo(
    () => pendingGroups.map(resolveMessageGroup),
    [pendingGroups]
  )

  const showLiveMessage = Boolean(
    liveMessage &&
    (connStatus === "prompting" ||
      (liveMessage.content.length > 0 && resolvedPendingGroups.length > 0))
  )
  const agentPlanOverlayKey = liveMessage?.id ?? `history-${conversationId}`

  if (loading && !detail) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-destructive text-sm">Error: {error}</p>
        </div>
      </div>
    )
  }

  if (!detail) return null

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Messages */}
      <MessageThread
        className="flex-1 min-h-0"
        resize={shouldUseSmoothResize ? "smooth" : undefined}
      >
        <MessageThreadContent className="p-4 max-w-3xl mx-auto">
          {resolvedGroups.length === 0 &&
          resolvedPendingGroups.length === 0 &&
          !showLiveMessage ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">
                No messages in this conversation.
              </p>
            </div>
          ) : (
            <>
              {resolvedGroups.map((group) => (
                <HistoricalMessageGroup key={group.id} group={group} />
              ))}
              {resolvedPendingGroups.map((group) => (
                <PendingMessageGroup key={group.id} group={group} />
              ))}
              {resolvedPendingGroups.length > 0 && !showLiveMessage && (
                <Message from="assistant">
                  <MessageContent>
                    <div className="flex items-center gap-1.5 py-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_infinite]" />
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" />
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" />
                    </div>
                  </MessageContent>
                </Message>
              )}
              {showLiveMessage && liveMessage && (
                <LiveMessageBlock message={liveMessage} />
              )}
            </>
          )}
        </MessageThreadContent>
      </MessageThread>
      {showLiveMessage && liveMessage && (
        <LiveTurnStats message={liveMessage} />
      )}
      <AgentPlanOverlay
        key={agentPlanOverlayKey}
        message={liveMessage ?? null}
        entries={historicalPlanEntries}
        planKey={historicalPlanKey}
        defaultExpanded={showLiveMessage}
      />
    </div>
  )
}
