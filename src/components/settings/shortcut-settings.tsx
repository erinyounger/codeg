"use client"

import { useEffect, useMemo, useState } from "react"
import { Keyboard, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { useIsMac } from "@/hooks/use-is-mac"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  formatShortcutLabel,
  shortcutFromKeyboardEvent,
} from "@/lib/keyboard-shortcuts"
import { Button } from "@/components/ui/button"

const SHARED_SHORTCUT_PAIRS: Array<[ShortcutActionId, ShortcutActionId]> = [
  ["new_terminal_tab", "new_conversation"],
  ["close_current_terminal_tab", "close_current_tab"],
]

function canShareShortcut(a: ShortcutActionId, b: ShortcutActionId): boolean {
  return SHARED_SHORTCUT_PAIRS.some(
    ([left, right]) =>
      (left === a && right === b) || (left === b && right === a)
  )
}

export function ShortcutSettings() {
  const { shortcuts, updateShortcut, resetShortcuts } = useShortcutSettings()
  const isMac = useIsMac()
  const [recordingAction, setRecordingAction] =
    useState<ShortcutActionId | null>(null)

  const isDefault = useMemo(
    () =>
      SHORTCUT_DEFINITIONS.every(
        (definition) =>
          shortcuts[definition.id] === DEFAULT_SHORTCUTS[definition.id]
      ),
    [shortcuts]
  )

  useEffect(() => {
    if (!recordingAction) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      event.preventDefault()
      event.stopPropagation()

      if (event.key === "Escape") {
        setRecordingAction(null)
        return
      }

      const shortcut = shortcutFromKeyboardEvent(event)
      if (!shortcut) return

      const conflict = SHORTCUT_DEFINITIONS.find(
        (definition) =>
          definition.id !== recordingAction &&
          !canShareShortcut(definition.id, recordingAction) &&
          shortcuts[definition.id] === shortcut
      )

      if (conflict) {
        toast.error(`快捷键已被「${conflict.title}」占用`)
        return
      }

      if (updateShortcut(recordingAction, shortcut)) {
        toast.success("快捷键已更新")
      } else {
        toast.error("快捷键无效，请重试")
      }

      setRecordingAction(null)
    }

    window.addEventListener("keydown", onKeyDown, true)

    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [recordingAction, shortcuts, updateShortcut])

  return (
    <div className="h-full overflow-auto">
      <div className="w-full space-y-4">
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">快捷键</h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetShortcuts()
                setRecordingAction(null)
                toast.success("已恢复默认快捷键")
              }}
              disabled={isDefault}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复默认
            </Button>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            点击右侧按钮后按下组合键即可修改。建议使用 Ctrl/Cmd、Alt、Shift
            的组合。按 Esc 可取消录制。
          </p>

          <div className="space-y-2">
            {SHORTCUT_DEFINITIONS.map((definition) => {
              const isRecording = recordingAction === definition.id

              return (
                <div
                  key={definition.id}
                  className="rounded-lg border px-3 py-2 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {definition.title}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {definition.description}
                    </p>
                  </div>
                  <Button
                    variant={isRecording ? "default" : "secondary"}
                    size="sm"
                    className="font-mono min-w-36 justify-center"
                    onClick={() => {
                      setRecordingAction((previous) =>
                        previous === definition.id ? null : definition.id
                      )
                    }}
                  >
                    {isRecording
                      ? "按下快捷键..."
                      : formatShortcutLabel(shortcuts[definition.id], isMac)}
                  </Button>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
