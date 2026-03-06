"use client"

import type {
  ConnectionStatus,
  PromptDraft,
  SessionConfigOptionInfo,
  SessionModeInfo,
  AvailableCommandInfo,
} from "@/lib/types"
import { MessageInput } from "@/components/chat/message-input"

interface ChatInputProps {
  status: ConnectionStatus | null
  defaultPath?: string
  onFocus?: () => void
  onSend: (draft: PromptDraft, modeId?: string | null) => void
  onCancel: () => void
  modes?: SessionModeInfo[]
  configOptions?: SessionConfigOptionInfo[]
  modeLoading?: boolean
  configOptionsLoading?: boolean
  selectedModeId?: string | null
  onModeChange?: (modeId: string) => void
  onConfigOptionChange?: (configId: string, valueId: string) => void
  availableCommands?: AvailableCommandInfo[] | null
  attachmentTabId?: string | null
  draftStorageKey?: string | null
}

export function ChatInput({
  status,
  defaultPath,
  onFocus,
  onSend,
  onCancel,
  modes,
  configOptions,
  modeLoading = false,
  configOptionsLoading = false,
  selectedModeId,
  onModeChange,
  onConfigOptionChange,
  availableCommands,
  attachmentTabId,
  draftStorageKey,
}: ChatInputProps) {
  const isConnected = status === "connected"
  const isPrompting = status === "prompting"
  const isConnecting = status === "connecting" || status === "downloading"

  return (
    <div className="p-4 pt-0">
      <MessageInput
        onSend={onSend}
        onFocus={onFocus}
        defaultPath={defaultPath}
        disabled={!isConnected}
        isPrompting={isPrompting}
        onCancel={onCancel}
        modes={modes}
        configOptions={configOptions}
        modeLoading={modeLoading}
        configOptionsLoading={configOptionsLoading}
        selectedModeId={selectedModeId}
        onModeChange={onModeChange}
        onConfigOptionChange={onConfigOptionChange}
        availableCommands={availableCommands}
        attachmentTabId={attachmentTabId}
        draftStorageKey={draftStorageKey}
        placeholder={
          isConnecting
            ? "Connecting..."
            : isPrompting
              ? "Agent is responding..."
              : "Send a message..."
        }
        className="min-h-28 max-h-60"
      />
    </div>
  )
}
