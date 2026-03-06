"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { formatDistanceToNow } from "date-fns"
import { useFolderContext } from "@/contexts/folder-context"
import { useTabContext } from "@/contexts/tab-context"
import { listFolderConversations } from "@/lib/tauri"
import type {
  AgentType,
  ConversationStatus,
  DbConversationSummary,
} from "@/lib/types"
import { AGENT_LABELS, STATUS_COLORS, compareAgentType } from "@/lib/types"
import { AgentIcon } from "@/components/agent-icon"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

interface SearchCommandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SearchCommandDialog({
  open,
  onOpenChange,
}: SearchCommandDialogProps) {
  const { folderId, conversations } = useFolderContext()
  const { openTab } = useTabContext()

  const [query, setQuery] = useState("")
  const [agentFilter, setAgentFilter] = useState<AgentType | null>(null)
  const [results, setResults] = useState<DbConversationSummary[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Compute which agent types exist in current folder
  const availableAgents = Array.from(
    new Set(conversations.map((c) => c.agent_type))
  ).sort(compareAgentType)

  const doSearch = useCallback(
    async (q: string, agent: AgentType | null) => {
      if (!q.trim() && !agent) {
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      try {
        const data = await listFolderConversations({
          folder_id: folderId,
          search: q.trim() || null,
          agent_type: agent,
        })
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    },
    [folderId]
  )

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSearch(query, agentFilter)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, agentFilter, doSearch])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("")
      setAgentFilter(null)
      setResults([])
    }
  }, [open])

  const handleSelect = (conv: DbConversationSummary) => {
    openTab(conv.id, conv.agent_type, true)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      title="Search conversations"
      open={open}
      onOpenChange={onOpenChange}
    >
      <CommandInput
        placeholder="Search conversations..."
        value={query}
        onValueChange={setQuery}
      />
      {availableAgents.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-2 border-b">
          <button
            onClick={() => setAgentFilter(null)}
            className={cn(
              "h-6 text-xs px-2 rounded-md transition-colors",
              agentFilter === null
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All
          </button>
          {availableAgents.map((at) => (
            <button
              key={at}
              onClick={() => setAgentFilter(at)}
              className={cn(
                "flex items-center gap-1.5 h-6 text-xs px-2 rounded-md transition-colors",
                agentFilter === at
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <AgentIcon agentType={at} className="w-3.5 h-3.5" />
              {AGENT_LABELS[at]}
            </button>
          ))}
        </div>
      )}
      <CommandList className="min-h-96">
        <CommandEmpty>
          {searching
            ? "Searching..."
            : !query.trim() && !agentFilter
              ? "键入搜索以查询会话"
              : "No results found."}
        </CommandEmpty>
        {results.length > 0 && (
          <CommandGroup>
            {results.map((conv) => (
              <CommandItem
                key={conv.id}
                value={`${conv.id}-${conv.title ?? ""}`}
                onSelect={() => handleSelect(conv)}
              >
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    STATUS_COLORS[conv.status as ConversationStatus] ??
                      "bg-gray-400"
                  )}
                />
                <span className="flex-1 truncate">
                  {conv.title || "Untitled conversation"}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {AGENT_LABELS[conv.agent_type]}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(conv.created_at), {
                    addSuffix: true,
                  })}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
