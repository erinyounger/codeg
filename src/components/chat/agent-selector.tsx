"use client"

import { useEffect, useState } from "react"
import { acpListAgents } from "@/lib/tauri"
import type { AgentType, AcpAgentInfo } from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"
import { AgentIcon } from "@/components/agent-icon"
import { cn } from "@/lib/utils"

interface AgentSelectorProps {
  defaultAgentType?: AgentType
  onSelect: (agentType: AgentType) => void
  onAgentsLoaded?: (agents: AcpAgentInfo[]) => void
  onOpenAgentsSettings?: () => void
  disabled?: boolean
}

export function AgentSelector({
  defaultAgentType,
  onSelect,
  onAgentsLoaded,
  onOpenAgentsSettings,
  disabled = false,
}: AgentSelectorProps) {
  const [agents, setAgents] = useState<AcpAgentInfo[]>([])
  const [selected, setSelected] = useState<AgentType | null>(
    defaultAgentType ?? null
  )

  useEffect(() => {
    let cancelled = false
    acpListAgents()
      .then((list) => {
        if (cancelled) return
        const sorted = [...list].sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
        )
        const visible = sorted.filter((a) => a.enabled)
        setAgents(visible)
        onAgentsLoaded?.(visible)
        // Auto-select default if it exists in the list
        if (defaultAgentType) {
          const found = visible.find(
            (a) => a.agent_type === defaultAgentType && a.available
          )
          if (found) {
            setSelected(found.agent_type)
          } else {
            // Fall back to first available
            const first = visible.find((a) => a.available)
            if (first) {
              setSelected(first.agent_type)
              onSelect(first.agent_type)
            }
          }
        } else {
          const first = visible.find((a) => a.available)
          if (first) {
            setSelected(first.agent_type)
            onSelect(first.agent_type)
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([])
          onAgentsLoaded?.([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [defaultAgentType, onAgentsLoaded, onSelect])

  const handleSelect = (agentType: AgentType) => {
    setSelected(agentType)
    onSelect(agentType)
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground">
        <div>暂无已启用的 Agent</div>
        {onOpenAgentsSettings ? (
          <button
            type="button"
            onClick={onOpenAgentsSettings}
            className="mt-2 inline-flex items-center rounded-md border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent cursor-pointer"
          >
            打开 Agents 设置
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {agents.map((agent) => (
        <button
          key={agent.agent_type}
          disabled={disabled || !agent.available}
          onClick={() => handleSelect(agent.agent_type)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            "border",
            disabled || !agent.available
              ? "cursor-not-allowed opacity-40"
              : "cursor-pointer hover:bg-accent",
            selected === agent.agent_type
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          )}
        >
          <AgentIcon agentType={agent.agent_type} className="w-3.5 h-3.5" />
          {AGENT_LABELS[agent.agent_type]}
        </button>
      ))}
    </div>
  )
}
