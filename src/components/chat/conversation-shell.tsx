import type { ReactNode } from "react"
import type {
  ConnectionStatus,
  PromptCapabilitiesInfo,
  PromptDraft,
  SessionConfigOptionInfo,
  SessionModeInfo,
  AvailableCommandInfo,
} from "@/lib/types"
import type { PendingPermission } from "@/contexts/acp-connections-context"
import { ChatInput } from "@/components/chat/chat-input"
import { PermissionDialog } from "@/components/chat/permission-dialog"

interface ConversationShellProps {
  status: ConnectionStatus | null
  promptCapabilities: PromptCapabilitiesInfo
  defaultPath?: string
  error: string | null
  pendingPermission: PendingPermission | null
  onFocus: () => void
  onSend: (draft: PromptDraft, modeId?: string | null) => void
  onCancel: () => void
  onRespondPermission: (requestId: string, optionId: string) => void
  children: ReactNode
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
  hideInput?: boolean
}

export function ConversationShell({
  status,
  promptCapabilities,
  defaultPath,
  error,
  pendingPermission,
  onFocus,
  onSend,
  onCancel,
  onRespondPermission,
  children,
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
  hideInput = false,
}: ConversationShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0">{children}</div>

      <PermissionDialog
        permission={pendingPermission}
        onRespond={onRespondPermission}
      />

      {!hideInput && (
        <ChatInput
          status={status}
          promptCapabilities={promptCapabilities}
          defaultPath={defaultPath}
          onFocus={onFocus}
          onSend={onSend}
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
        />
      )}

      {error && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/5 border-t border-destructive/20">
          {error}
        </div>
      )}
    </div>
  )
}
