"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MessageInput } from "@/components/chat/message-input"
import type { AgentType, PromptDraft, SessionStats } from "@/lib/types"
import { useFolderContext } from "@/contexts/folder-context"
import { useTabContext } from "@/contexts/tab-context"
import { useSessionStats } from "@/contexts/session-stats-context"
import { useAcpActions } from "@/contexts/acp-connections-context"
import { useConnectionLifecycle } from "@/hooks/use-connection-lifecycle"
import type { AdaptedMessage } from "@/lib/adapters/ai-elements-adapter"
import {
  adaptLiveMessageFromAcp,
  adaptMessageTurns,
} from "@/lib/adapters/ai-elements-adapter"
import {
  buildUserMessageTextPartsFromDraft,
  extractUserResourcesFromDraft,
  getPromptDraftDisplayText,
} from "@/lib/prompt-draft"
import {
  buildPlanKey,
  extractLatestPlanEntriesFromMessages,
} from "@/lib/agent-plan"
import {
  buildConversationDraftStorageKey,
  buildNewConversationDraftStorageKey,
  moveMessageInputDraft,
} from "@/lib/message-input-draft"
import {
  createConversation,
  getFolderConversation,
  openSettingsWindow,
  updateConversationStatus,
  updateConversationExternalId,
} from "@/lib/tauri"
import { AgentSelector } from "@/components/chat/agent-selector"
import { LiveMessageBlock } from "@/components/chat/live-message-block"
import { AgentPlanOverlay } from "@/components/chat/agent-plan-overlay"
import { LiveTurnStats } from "@/components/message/live-turn-stats"
import { TurnStats } from "@/components/message/turn-stats"
import { UserResourceLinks } from "@/components/message/user-resource-links"
import { ConversationShell } from "@/components/chat/conversation-shell"
import {
  MessageThread,
  MessageThreadContent,
} from "@/components/ai-elements/message-thread"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"

interface WelcomeInputPanelProps {
  defaultAgentType?: AgentType
  workingDir?: string
  tabId?: string
  isActive?: boolean
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isExpectedAutoLinkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  return (error as { alerted?: unknown }).alerted === true
}

function buildInlineAutoConnectErrorMessage(raw: string): string {
  const normalized = raw.trim().replace(/[。.!?，,；;：:]+$/u, "")
  if (!normalized) return "点击前往设置 > Agents 管理安装。"
  const hasSdkNotInstalled = /SDK\s*尚未安装$/u.test(normalized)
  const message =
    !hasSdkNotInstalled && normalized.endsWith("尚未安装")
      ? normalized.replace(/尚未安装$/u, "SDK 尚未安装")
      : normalized
  if (message.includes("设置 > Agents 管理安装")) {
    return `${message}。`
  }
  return `${message}，点击前往设置 > Agents 管理安装。`
}

export function WelcomeInputPanel({
  defaultAgentType,
  workingDir,
  tabId,
  isActive = true,
}: WelcomeInputPanelProps) {
  const fallbackContextId = useMemo(() => crypto.randomUUID(), [])
  const contextKey = tabId ?? `new-${fallbackContextId}`

  const { folderId, refreshConversations } = useFolderContext()
  const { promoteNewConversationTab, linkTabConversation } = useTabContext()
  const { setSessionStats } = useSessionStats()
  const { migrateContextKey } = useAcpActions()
  const latestSessionStatsRef = useRef<SessionStats | null>(null)
  const isActiveRef = useRef(isActive)
  const statsRefreshSeqRef = useRef(0)

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  // Reset or restore token stats when tab becomes active
  useEffect(() => {
    if (isActive) {
      setSessionStats(latestSessionStatsRef.current)
    }
  }, [isActive, setSessionStats])

  const applySessionStats = useCallback(
    (stats: SessionStats | null) => {
      latestSessionStatsRef.current = stats
      if (isActiveRef.current) {
        setSessionStats(stats)
      }
    },
    [setSessionStats]
  )

  const hasTokenStats = useCallback((stats: SessionStats | null): boolean => {
    if (!stats) return false
    return (
      stats.total_usage !== null ||
      stats.total_tokens != null ||
      stats.context_window_used_tokens != null ||
      stats.context_window_max_tokens != null
    )
  }, [])

  const hasAssistantUsage = useCallback(
    (messages: AdaptedMessage[]): boolean => {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message.role !== "assistant") continue
        return message.usage != null
      }
      return false
    },
    []
  )

  const refreshConversationFromDb = useCallback(
    async (expectedTurnCount?: number) => {
      const conversationId = dbConvIdRef.current
      if (!conversationId) return

      const refreshSeq = ++statsRefreshSeqRef.current
      const maxAttempts = 10
      const retryDelayMs = 400
      let latestMessages: AdaptedMessage[] | null = null
      let latestStats: SessionStats | null = null

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (refreshSeq !== statsRefreshSeqRef.current) return

        try {
          const detail = await getFolderConversation(conversationId)
          if (refreshSeq !== statsRefreshSeqRef.current) return

          const messages = adaptMessageTurns(detail.turns)
          const stats = detail.session_stats ?? null
          latestMessages = messages
          latestStats = stats

          const hasExpectedTurns =
            expectedTurnCount == null ||
            detail.turns.length >= expectedTurnCount
          const canShowTurnTokenStats = hasAssistantUsage(messages)
          const canShowSessionTokenStats = hasTokenStats(stats)
          if (
            hasExpectedTurns &&
            (canShowTurnTokenStats || canShowSessionTokenStats)
          ) {
            setHistory(messages)
            if (canShowSessionTokenStats) {
              applySessionStats(stats)
            }
            return
          }
        } catch {
          // Ignore transient read failures while session file is syncing.
        }

        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        }
      }

      if (refreshSeq !== statsRefreshSeqRef.current) return
      if (latestMessages) {
        setHistory(latestMessages)
      }
      if (latestStats && hasTokenStats(latestStats)) {
        applySessionStats(latestStats)
      }
    },
    [applySessionStats, hasAssistantUsage, hasTokenStats]
  )

  useEffect(() => {
    return () => {
      statsRefreshSeqRef.current += 1
    }
  }, [])

  const [phase, setPhase] = useState<"welcome" | "conversation">("welcome")
  const [selectedAgent, setSelectedAgent] = useState<AgentType>(
    defaultAgentType ?? "codex"
  )
  const [history, setHistory] = useState<AdaptedMessage[]>([])
  const historyRef = useRef<AdaptedMessage[]>([])
  useEffect(() => {
    historyRef.current = history
  }, [history])
  const historicalPlanEntries = useMemo(
    () => extractLatestPlanEntriesFromMessages(history),
    [history]
  )
  const historicalPlanKey = useMemo(
    () => buildPlanKey(historicalPlanEntries),
    [historicalPlanEntries]
  )
  const [modeId, setModeId] = useState<string | null>(null)
  const [dbConversationId, setDbConversationId] = useState<number | null>(null)
  const [agentsLoaded, setAgentsLoaded] = useState(false)
  const [usableAgentCount, setUsableAgentCount] = useState(0)
  const [agentConnectError, setAgentConnectError] = useState<string | null>(
    null
  )
  const canAutoConnect = agentsLoaded && usableAgentCount > 0
  const pendingPromptRef = useRef<{
    draft: PromptDraft
    modeId: string | null
  } | null>(null)
  const newConversationDraftStorageKey = useMemo(
    () =>
      buildNewConversationDraftStorageKey({
        folderId,
      }),
    [folderId]
  )
  const activeDraftStorageKey = useMemo(() => {
    if (dbConversationId != null) {
      return buildConversationDraftStorageKey(selectedAgent, dbConversationId)
    }
    return newConversationDraftStorageKey
  }, [dbConversationId, newConversationDraftStorageKey, selectedAgent])

  // DB persistence state
  const dbConvIdRef = useRef<number | null>(null)
  const statusUpdatedRef = useRef(false)
  const tabPromotedRef = useRef(false)
  const tabIdRef = useRef(tabId)
  const selectedAgentRef = useRef(selectedAgent)
  const convTitleRef = useRef<string | null>(null)
  useEffect(() => {
    tabIdRef.current = tabId
  }, [tabId])
  useEffect(() => {
    selectedAgentRef.current = selectedAgent
  }, [selectedAgent])

  const {
    conn,
    modeLoading,
    configOptionsLoading,
    autoConnectError,
    handleFocus,
    handleSend: lifecycleSend,
    handleSetConfigOption,
    handleCancel,
    handleRespondPermission,
  } = useConnectionLifecycle({
    contextKey,
    agentType: selectedAgent,
    isActive: isActive && canAutoConnect,
    workingDir,
  })

  // Destructure stable callback + volatile status separately.
  // conn.connect is stable (depends only on actions + contextKey).
  // conn.status changes on state transitions (~5/turn), NOT on every
  // streaming delta (hundreds/sec) — much cheaper than depending on `conn`.
  const {
    status: connStatus,
    connect: connConnect,
    disconnect: connDisconnect,
    sessionId: connSessionId,
  } = conn
  const connectionModes = useMemo(
    () => conn.modes?.available_modes ?? [],
    [conn.modes?.available_modes]
  )
  const connectionConfigOptions = useMemo(
    () => conn.configOptions ?? [],
    [conn.configOptions]
  )
  const connectionCommands = useMemo(
    () => conn.availableCommands ?? [],
    [conn.availableCommands]
  )
  const selectedModeId = useMemo(() => {
    if (connectionModes.length === 0) return null
    if (modeId && connectionModes.some((mode) => mode.id === modeId)) {
      return modeId
    }
    return conn.modes?.current_mode_id ?? connectionModes[0]?.id ?? null
  }, [conn.modes?.current_mode_id, connectionModes, modeId])

  // Persist the agent-assigned session ID as external_id once both
  // the DB conversation ID and the ACP session ID are available.
  const externalIdSavedRef = useRef(false)
  const sessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (connSessionId) {
      sessionIdRef.current = connSessionId
    }
  }, [connSessionId])

  const trySaveExternalId = useCallback(() => {
    if (
      externalIdSavedRef.current ||
      !dbConvIdRef.current ||
      !sessionIdRef.current
    )
      return
    externalIdSavedRef.current = true
    updateConversationExternalId(
      dbConvIdRef.current,
      sessionIdRef.current
    ).catch((e: unknown) =>
      console.error("[WelcomePanel] update external_id:", e)
    )
  }, [])

  // Trigger when session ID arrives from ACP
  useEffect(() => {
    if (connSessionId) trySaveExternalId()
  }, [connSessionId, trySaveExternalId])

  const isConnecting =
    connStatus === "connecting" || connStatus === "downloading"

  const prevStatusRef = useRef(connStatus)

  // Accumulate history when prompting completes
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = connStatus

    if (prev === "prompting" && connStatus !== "prompting") {
      if (conn.liveMessage && conn.liveMessage.content.length > 0) {
        const adapted = adaptLiveMessageFromAcp(conn.liveMessage, {
          isLiveStreaming: false,
        })

        setHistory((h) => [...h, adapted])
      }
      // Agent turn ended — mark as pending_review unless it's a terminal state
      if (
        dbConvIdRef.current &&
        connStatus !== "disconnected" &&
        connStatus !== "error"
      ) {
        updateConversationStatus(dbConvIdRef.current, "pending_review")
          .then(() => refreshConversations())
          .catch((e: unknown) =>
            console.error("[WelcomePanel] update status:", e)
          )
      }

      void refreshConversationFromDb(
        historyRef.current.length + (conn.liveMessage ? 1 : 0)
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- conn.liveMessage, lifecycleSend intentionally omitted: effect only fires on status transitions
  }, [connStatus, refreshConversations, refreshConversationFromDb])

  // When connection becomes "connected" and we have a pending prompt, send it
  useEffect(() => {
    if (connStatus === "connected" && pendingPromptRef.current) {
      const pending = pendingPromptRef.current
      pendingPromptRef.current = null
      lifecycleSend(pending.draft, pending.modeId)
    }
  }, [connStatus, lifecycleSend])

  // Promote tab helper — call once when conversation ends or component unmounts
  const promoteTab = useCallback(() => {
    if (tabPromotedRef.current || !dbConvIdRef.current) return
    tabPromotedRef.current = true
    const tid = tabIdRef.current
    const convId = dbConvIdRef.current
    const agent = selectedAgentRef.current
    const title = convTitleRef.current || "Untitled"
    const canonicalContextKey = `conv-${agent}-${convId}`

    // Keep in-flight stream/state attached when this new-conversation view
    // is closed and later reopened as a canonical conversation tab.
    migrateContextKey(contextKey, canonicalContextKey)

    if (tid) {
      promoteNewConversationTab(tid, convId, agent, title)
    }
    refreshConversations()
  }, [
    promoteNewConversationTab,
    refreshConversations,
    migrateContextKey,
    contextKey,
  ])

  // Update conversation status on disconnect/error + promote tab
  useEffect(() => {
    if (!dbConvIdRef.current || statusUpdatedRef.current) return
    if (connStatus === "disconnected") {
      statusUpdatedRef.current = true
      updateConversationStatus(dbConvIdRef.current, "completed").catch((e) =>
        console.error("[WelcomePanel] update status:", e)
      )
      promoteTab()
    } else if (connStatus === "error") {
      statusUpdatedRef.current = true
      updateConversationStatus(dbConvIdRef.current, "cancelled").catch((e) =>
        console.error("[WelcomePanel] update status:", e)
      )
      promoteTab()
    }
  }, [connStatus, promoteTab])

  // Promote tab on unmount if not yet promoted (e.g. user closes tab)
  useEffect(() => {
    return () => {
      promoteTab()
    }
  }, [promoteTab])

  const handleAgentSelect = useCallback(
    (agentType: AgentType) => {
      if (agentType === selectedAgent) return
      setSelectedAgent(agentType)
      setModeId(null)
      setAgentConnectError(null)
      connDisconnect()
        .catch((e) => console.error("[WelcomePanel] disconnect old agent:", e))
        .finally(() => {
          connConnect(agentType, workingDir, undefined, {
            source: "auto_link",
          })
            .then(() => {
              setAgentConnectError(null)
            })
            .catch((e) => {
              setAgentConnectError(normalizeErrorMessage(e))
              if (!isExpectedAutoLinkError(e)) {
                console.error("[WelcomePanel] switch agent:", e)
              }
            })
        })
    },
    [selectedAgent, connConnect, connDisconnect, workingDir]
  )

  // Welcome phase: submit first message.
  const handleWelcomeSend = useCallback(
    (draft: PromptDraft, selectedModeId?: string | null) => {
      const displayText = getPromptDraftDisplayText(draft)
      const userMsg: AdaptedMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: buildUserMessageTextPartsFromDraft(draft),
        userResources: extractUserResourcesFromDraft(draft),
        timestamp: new Date().toISOString(),
      }
      setHistory([userMsg])
      setPhase("conversation")
      applySessionStats(null)
      statsRefreshSeqRef.current += 1

      // If already connected, send directly; otherwise queue for when connected
      if (connStatus === "connected") {
        lifecycleSend(draft, selectedModeId)
      } else {
        pendingPromptRef.current = {
          draft,
          modeId: selectedModeId ?? null,
        }
        // Ensure connection is being established
        if (
          !connStatus ||
          connStatus === "disconnected" ||
          connStatus === "error"
        ) {
          connConnect(selectedAgent, workingDir, undefined, {
            source: "auto_link",
          }).catch((e) => {
            setAgentConnectError(normalizeErrorMessage(e))
          })
        }
      }

      // DB persistence: create conversation
      const title = displayText.slice(0, 80)
      convTitleRef.current = title
      createConversation(folderId, selectedAgent, title)
        .then((convId) => {
          dbConvIdRef.current = convId
          setDbConversationId(convId)
          moveMessageInputDraft(
            newConversationDraftStorageKey,
            buildConversationDraftStorageKey(selectedAgent, convId)
          )
          // Link tab to DB conversation so status dot updates and tab is persisted
          if (tabIdRef.current) {
            linkTabConversation(tabIdRef.current, convId, selectedAgent, title)
          }
          // If ACP session ID already arrived, save external_id now
          trySaveExternalId()
          refreshConversations()
        })
        .catch((e: unknown) =>
          console.error("[WelcomePanel] create conversation:", e)
        )
    },
    [
      selectedAgent,
      workingDir,
      connStatus,
      connConnect,
      lifecycleSend,
      folderId,
      refreshConversations,
      linkTabConversation,
      trySaveExternalId,
      applySessionStats,
      newConversationDraftStorageKey,
    ]
  )

  // Conversation phase: prepend user message to history before sending
  const handleSendWithHistory = useCallback(
    (draft: PromptDraft, selectedModeId?: string | null) => {
      const userMsg: AdaptedMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: buildUserMessageTextPartsFromDraft(draft),
        userResources: extractUserResourcesFromDraft(draft),
        timestamp: new Date().toISOString(),
      }
      setHistory((h) => [...h, userMsg])
      lifecycleSend(draft, selectedModeId)

      // Update status
      if (dbConvIdRef.current) {
        updateConversationStatus(dbConvIdRef.current, "in_progress")
          .then(() => refreshConversations())
          .catch((e: unknown) =>
            console.error("[WelcomePanel] update status:", e)
          )
        statusUpdatedRef.current = false
      }
    },
    [lifecycleSend, refreshConversations]
  )

  const handleOpenAgentsSettings = useCallback(() => {
    openSettingsWindow("agents", { agentType: selectedAgent }).catch((err) => {
      console.error("[WelcomePanel] failed to open settings window:", err)
    })
  }, [selectedAgent])

  // Track live message visibility across turn completion.
  // Hooks must be called before any conditional returns.
  const prevConnStatusForLiveRef = useRef(connStatus)
  const showLiveTransitionRef = useRef(false)
  const prevHistoryLenRef = useRef(history.length)

  if (connStatus === "prompting") {
    showLiveTransitionRef.current = false
  } else if (prevConnStatusForLiveRef.current === "prompting") {
    showLiveTransitionRef.current = true
  }
  prevConnStatusForLiveRef.current = connStatus

  // Once the effect adds the adapted message to history, hide the live block.
  if (
    history.length > prevHistoryLenRef.current &&
    showLiveTransitionRef.current
  ) {
    showLiveTransitionRef.current = false
  }
  prevHistoryLenRef.current = history.length

  // ── Welcome phase ──
  if (phase === "welcome") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4">
        <div className="w-full max-w-2xl space-y-6">
          <AgentSelector
            defaultAgentType={selectedAgent}
            onSelect={handleAgentSelect}
            onAgentsLoaded={(agents) => {
              setAgentsLoaded(true)
              setUsableAgentCount(
                agents.filter((agent) => agent.enabled && agent.available)
                  .length
              )
            }}
            onOpenAgentsSettings={handleOpenAgentsSettings}
            disabled={isConnecting}
          />

          {autoConnectError || agentConnectError ? (
            <button
              type="button"
              onClick={handleOpenAgentsSettings}
              className="w-full cursor-pointer rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-center text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              {(() => {
                const inlineMessage = buildInlineAutoConnectErrorMessage(
                  autoConnectError ?? agentConnectError ?? ""
                )
                return (
                  <div
                    className="overflow-hidden text-ellipsis whitespace-nowrap text-center"
                    title={inlineMessage}
                  >
                    {inlineMessage}
                  </div>
                )
              })()}
            </button>
          ) : null}

          <MessageInput
            key={newConversationDraftStorageKey}
            onSend={handleWelcomeSend}
            defaultPath={workingDir}
            placeholder={
              agentsLoaded && usableAgentCount === 0
                ? "请先启用至少一个 Agent 后开始会话..."
                : "Ask anything..."
            }
            autoFocus
            attachmentTabId={tabId ?? null}
            modes={connectionModes}
            configOptions={connectionConfigOptions}
            modeLoading={modeLoading}
            configOptionsLoading={configOptionsLoading}
            selectedModeId={selectedModeId}
            onModeChange={setModeId}
            onConfigOptionChange={handleSetConfigOption}
            availableCommands={connectionCommands}
            disabled={!canAutoConnect || isConnecting}
            className="min-h-28 max-h-60"
            draftStorageKey={newConversationDraftStorageKey}
          />
        </div>
      </div>
    )
  }

  // ── Conversation phase ──

  const showLive = Boolean(
    conn.liveMessage &&
    (connStatus === "prompting" ||
      (conn.liveMessage.content.length > 0 && showLiveTransitionRef.current))
  )

  return (
    <ConversationShell
      status={connStatus}
      defaultPath={workingDir}
      error={conn.error}
      pendingPermission={conn.pendingPermission}
      onFocus={handleFocus}
      onSend={handleSendWithHistory}
      onCancel={handleCancel}
      onRespondPermission={handleRespondPermission}
      modes={connectionModes}
      configOptions={connectionConfigOptions}
      modeLoading={modeLoading}
      configOptionsLoading={configOptionsLoading}
      selectedModeId={selectedModeId}
      onModeChange={setModeId}
      onConfigOptionChange={handleSetConfigOption}
      availableCommands={connectionCommands}
      attachmentTabId={tabId ?? null}
      draftStorageKey={activeDraftStorageKey}
    >
      <div className="relative flex flex-col h-full">
        <MessageThread className="flex-1 min-h-0">
          <MessageThreadContent className="p-4 max-w-3xl mx-auto">
            {history.map((msg) => (
              <div key={msg.id}>
                <Message from={msg.role === "tool" ? "assistant" : msg.role}>
                  <MessageContent>
                    <ContentPartsRenderer parts={msg.content} role={msg.role} />
                  </MessageContent>
                  {msg.role === "user" && msg.userResources?.length ? (
                    <UserResourceLinks
                      resources={msg.userResources}
                      className="self-end"
                    />
                  ) : null}
                </Message>
                {msg.role === "assistant" && (
                  <TurnStats
                    usage={msg.usage}
                    duration_ms={msg.duration_ms}
                    model={msg.model}
                  />
                )}
              </div>
            ))}
            {showLive && <LiveMessageBlock message={conn.liveMessage!} />}
          </MessageThreadContent>
        </MessageThread>
        {showLive && <LiveTurnStats message={conn.liveMessage!} />}
        <AgentPlanOverlay
          message={conn.liveMessage}
          entries={historicalPlanEntries}
          planKey={historicalPlanKey}
        />
      </div>
    </ConversationShell>
  )
}
