"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { FileSearch, Plus, Send, Square, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  AvailableCommandInfo,
  PromptDraft,
  PromptInputBlock,
  SessionConfigOptionInfo,
  SessionModeInfo,
} from "@/lib/types"
import {
  ATTACH_FILE_TO_SESSION_EVENT,
  type AttachFileToSessionDetail,
} from "@/lib/session-attachment-events"
import { ModeSelector } from "@/components/chat/mode-selector"
import { SessionConfigSelector } from "@/components/chat/session-config-selector"
import { SlashCommandMenu } from "@/components/chat/slash-command-menu"
import {
  clearMessageInputDraft,
  loadMessageInputDraft,
  saveMessageInputDraft,
} from "@/lib/message-input-draft"

interface MessageInputProps {
  onSend: (draft: PromptDraft, modeId?: string | null) => void
  placeholder?: string
  defaultPath?: string
  disabled?: boolean
  autoFocus?: boolean
  onFocus?: () => void
  className?: string
  isPrompting?: boolean
  onCancel?: () => void
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

interface InputAttachment {
  path: string
  uri: string
  name: string
  mimeType: string | null
}

const MIME_BY_EXT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/tsx",
  jsx: "text/jsx",
  py: "text/x-python",
  rs: "text/rust",
  go: "text/x-go",
  java: "text/x-java-source",
  xml: "application/xml",
  toml: "application/toml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function mimeTypeFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXT[ext] ?? null
}

function toFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const encoded = normalized.split("/").map(encodeURIComponent).join("/")
  if (normalized.startsWith("/")) {
    return `file://${encoded}`
  }
  return `file:///${encoded}`
}

function SelectorLoadingChip({ label }: { label: string }) {
  return (
    <div className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
      <span>{label}</span>
    </div>
  )
}

export function MessageInput({
  onSend,
  placeholder = "Ask anything...",
  defaultPath,
  disabled = false,
  autoFocus = false,
  onFocus,
  className,
  isPrompting = false,
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
}: MessageInputProps) {
  const effectiveDraftStorageKey = draftStorageKey ?? attachmentTabId ?? null
  const [text, setText] = useState(() => {
    if (!effectiveDraftStorageKey) return ""
    return loadMessageInputDraft(effectiveDraftStorageKey) ?? ""
  })
  const [attachments, setAttachments] = useState<InputAttachment[]>([])
  const composingRef = useRef(false)
  const textRef = useRef(text)

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    if (!effectiveDraftStorageKey) return
    saveMessageInputDraft(effectiveDraftStorageKey, text)
  }, [effectiveDraftStorageKey, text])

  const availableModes = useMemo(() => modes ?? [], [modes])
  const availableConfigOptions = useMemo(
    () => configOptions ?? [],
    [configOptions]
  )
  const hasConfigOptions = availableConfigOptions.length > 0
  const hasModes = availableModes.length > 0

  const effectiveModeId = useMemo(() => {
    if (!hasModes) return null
    if (
      selectedModeId &&
      availableModes.some((mode) => mode.id === selectedModeId)
    ) {
      return selectedModeId
    }
    return availableModes[0]?.id ?? null
  }, [hasModes, selectedModeId, availableModes])
  const showModeSelector =
    hasModes && Boolean(effectiveModeId) && !hasConfigOptions
  const showModeLoading = modeLoading && !hasConfigOptions && !showModeSelector
  const showConfigLoading = configOptionsLoading && !hasConfigOptions
  const hasAttachments = attachments.length > 0
  const hasSendableContent = text.trim().length > 0 || hasAttachments

  // ── Slash command autocomplete ──
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const slashCommands = useMemo(
    () => availableCommands ?? [],
    [availableCommands]
  )
  const filteredSlashCommands = useMemo(() => {
    if (!slashMenuOpen || slashCommands.length === 0) return []
    const match = text.match(/^\/(\S*)$/)
    if (!match) return []
    const filter = match[1].toLowerCase()
    return slashCommands.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(filter)
    )
  }, [slashMenuOpen, slashCommands, text])

  const appendAttachments = useCallback((paths: string[]) => {
    setAttachments((prev) => {
      const seen = new Set(prev.map((item) => item.path))
      const next = [...prev]
      for (const path of paths) {
        if (typeof path !== "string" || !path || seen.has(path)) continue
        seen.add(path)
        next.push({
          path,
          uri: toFileUri(path),
          name: fileNameFromPath(path),
          mimeType: mimeTypeFromPath(path),
        })
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!showModeSelector) return
    if (!effectiveModeId || !onModeChange) return
    if (effectiveModeId !== selectedModeId) {
      onModeChange(effectiveModeId)
    }
  }, [showModeSelector, effectiveModeId, selectedModeId, onModeChange])

  const handleModeSelect = useCallback(
    (modeId: string) => {
      onModeChange?.(modeId)
    },
    [onModeChange]
  )

  const handleSlashSelect = useCallback((cmd: AvailableCommandInfo) => {
    setText(`/${cmd.name} `)
    setSlashMenuOpen(false)
  }, [])

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      setText(value)
      if (slashCommands.length > 0 && /^\/(\S*)$/.test(value)) {
        setSlashSelectedIndex(0)
        setSlashMenuOpen(true)
      } else {
        setSlashMenuOpen(false)
      }
    },
    [slashCommands.length]
  )

  const handlePickFiles = useCallback(async () => {
    if (disabled) return
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        defaultPath: defaultPath || undefined,
      })
      if (!selected) return
      const picked = Array.isArray(selected) ? selected : [selected]
      appendAttachments(picked.filter((item): item is string => !!item))
    } catch (error) {
      console.error("[MessageInput] pick files failed:", error)
    }
  }, [appendAttachments, defaultPath, disabled])

  useEffect(() => {
    if (!attachmentTabId) return

    const handleAttachFile = (event: Event) => {
      const customEvent = event as CustomEvent<AttachFileToSessionDetail>
      if (!customEvent.detail) return
      if (customEvent.detail.tabId !== attachmentTabId) return
      appendAttachments([customEvent.detail.path])
    }

    window.addEventListener(ATTACH_FILE_TO_SESSION_EVENT, handleAttachFile)
    return () => {
      window.removeEventListener(ATTACH_FILE_TO_SESSION_EVENT, handleAttachFile)
    }
  }, [appendAttachments, attachmentTabId])

  const removeAttachment = useCallback((path: string) => {
    setAttachments((prev) => prev.filter((item) => item.path !== path))
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = textRef.current.trim()
    if (!trimmed && attachments.length === 0) return

    const blocks: PromptInputBlock[] = []
    if (trimmed) {
      blocks.push({ type: "text", text: trimmed })
    }
    for (const attachment of attachments) {
      blocks.push({
        type: "resource_link",
        uri: attachment.uri,
        name: attachment.name,
        mime_type: attachment.mimeType,
        description: null,
      })
    }

    const displayText =
      trimmed ||
      `Attached ${attachments.length} resource${attachments.length > 1 ? "s" : ""}`
    onSend({ blocks, displayText }, showModeSelector ? effectiveModeId : null)
    if (effectiveDraftStorageKey) {
      clearMessageInputDraft(effectiveDraftStorageKey)
    }
    setText("")
    setAttachments([])
  }, [
    attachments,
    onSend,
    effectiveModeId,
    showModeSelector,
    effectiveDraftStorageKey,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        e.nativeEvent.isComposing ||
        composingRef.current ||
        e.key === "Process" ||
        e.keyCode === 229
      ) {
        return
      }

      if (slashMenuOpen && filteredSlashCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setSlashSelectedIndex((i) =>
            i < filteredSlashCommands.length - 1 ? i + 1 : 0
          )
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setSlashSelectedIndex((i) =>
            i > 0 ? i - 1 : filteredSlashCommands.length - 1
          )
          return
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault()
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex])
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setSlashMenuOpen(false)
          return
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (!disabled) handleSend()
      }
    },
    [
      disabled,
      handleSend,
      slashMenuOpen,
      filteredSlashCommands,
      slashSelectedIndex,
      handleSlashSelect,
    ]
  )

  const bottomPaddingClass = "pb-10"
  const topPaddingClass = hasAttachments ? "pt-10" : ""

  return (
    <div className="relative">
      {slashMenuOpen && filteredSlashCommands.length > 0 && (
        <SlashCommandMenu
          commands={filteredSlashCommands}
          selectedIndex={slashSelectedIndex}
          onSelect={handleSlashSelect}
        />
      )}
      <Textarea
        value={text}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => (composingRef.current = true)}
        onCompositionEnd={() => (composingRef.current = false)}
        onFocus={onFocus}
        placeholder={placeholder}
        className={cn(
          "text-sm pr-12 resize-none bg-transparent",
          topPaddingClass,
          bottomPaddingClass,
          className
        )}
        autoFocus={autoFocus}
      />
      {hasAttachments && (
        <div className="absolute left-2 right-2 top-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            {attachments.map((attachment) => (
              <div
                key={attachment.path}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] text-muted-foreground"
              >
                <FileSearch className="h-3 w-3" />
                <span className="max-w-40 truncate">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.path)}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/15"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="absolute left-2 right-24 bottom-2 flex flex-col gap-1">
        <div className="flex items-center gap-1 overflow-x-auto">
          <Button
            onClick={handlePickFiles}
            disabled={disabled || isPrompting}
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title="Attach files"
          >
            <Plus className="size-4" />
          </Button>
          {showConfigLoading && (
            <SelectorLoadingChip label="Loading settings..." />
          )}
          {hasConfigOptions &&
            availableConfigOptions.map((option) => (
              <SessionConfigSelector
                key={option.id}
                option={option}
                onSelect={(configId, valueId) =>
                  onConfigOptionChange?.(configId, valueId)
                }
              />
            ))}
          {showModeLoading && <SelectorLoadingChip label="Loading mode..." />}
          {showModeSelector && effectiveModeId && (
            <ModeSelector
              modes={availableModes}
              selectedModeId={effectiveModeId}
              onSelect={handleModeSelect}
            />
          )}
        </div>
      </div>
      {isPrompting && onCancel ? (
        <Button
          onClick={onCancel}
          variant="destructive"
          size="icon"
          className="absolute right-2 bottom-2"
          title="Cancel"
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          onClick={handleSend}
          disabled={disabled || !hasSendableContent}
          size="icon"
          className="absolute right-2 bottom-2"
          title="Send"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
