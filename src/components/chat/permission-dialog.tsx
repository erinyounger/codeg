"use client"

import { useMemo } from "react"
import {
  ShieldAlert,
  Terminal,
  FilePenLine,
  ListTodo,
  Compass,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CodeBlock } from "@/components/ai-elements/code-block"
import type { PendingPermission } from "@/contexts/acp-connections-context"
import { parsePermissionToolCall } from "@/lib/permission-request"

interface PermissionDialogProps {
  permission: PendingPermission | null
  onRespond: (requestId: string, optionId: string) => void
}

function formatKindLabel(kind: string): string {
  const normalized = kind.replace(/_/g, " ").trim()
  return normalized.length > 0 ? normalized : "tool"
}

export function PermissionDialog({
  permission,
  onRespond,
}: PermissionDialogProps) {
  const parsed = useMemo(
    () => parsePermissionToolCall(permission?.tool_call),
    [permission?.tool_call]
  )
  if (!permission) return null

  const hasFileChanges = parsed.fileChanges.length > 0
  const hasPlan =
    parsed.planEntries.length > 0 || Boolean(parsed.planExplanation)
  const hasStructured =
    Boolean(parsed.command) ||
    hasFileChanges ||
    hasPlan ||
    Boolean(parsed.modeTarget)

  return (
    <div className="mx-4 mb-3 rounded-xl border border-border/70 bg-card/95 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="truncate">{parsed.title}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Agent requests permission to continue this turn.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {formatKindLabel(parsed.normalizedKind)}
        </Badge>
      </div>

      <div className="mt-3 max-h-[min(36vh,18rem)] space-y-2 overflow-y-auto pr-1">
        {parsed.command && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Terminal className="h-3.5 w-3.5" />
              <span>Command</span>
            </div>
            <CodeBlock code={parsed.command} language="bash" />
            {parsed.cwd && (
              <div className="break-all text-xs text-muted-foreground">
                CWD: {parsed.cwd}
              </div>
            )}
          </div>
        )}

        {hasFileChanges && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <FilePenLine className="h-3.5 w-3.5" />
              <span>Files: {parsed.fileChanges.length}</span>
              {(parsed.additions > 0 || parsed.deletions > 0) && (
                <span>
                  +{parsed.additions} / -{parsed.deletions}
                </span>
              )}
            </div>
            <div className="space-y-1 rounded-md bg-muted/40 p-2">
              {parsed.fileChanges.slice(0, 8).map((change, index) => (
                <div
                  key={`${change.path}-${index}`}
                  className="break-all font-mono text-xs text-foreground/90"
                >
                  {change.path}
                </div>
              ))}
              {parsed.fileChanges.length > 8 && (
                <div className="text-xs text-muted-foreground">
                  +{parsed.fileChanges.length - 8} more files
                </div>
              )}
            </div>
            {parsed.diffPreview && (
              <CodeBlock code={parsed.diffPreview} language="diff" />
            )}
          </div>
        )}

        {hasPlan && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <ListTodo className="h-3.5 w-3.5" />
              <span>Plan</span>
            </div>
            {parsed.planExplanation && (
              <p className="text-xs text-foreground/90">
                {parsed.planExplanation}
              </p>
            )}
            {parsed.planEntries.length > 0 && (
              <div className="space-y-1 rounded-md bg-muted/40 p-2">
                {parsed.planEntries.map((entry, index) => (
                  <div key={`${entry.text}-${index}`} className="text-xs">
                    <span className="text-foreground/90">{entry.text}</span>
                    {entry.status && (
                      <span className="ml-2 text-muted-foreground">
                        ({entry.status})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {parsed.modeTarget && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Compass className="h-3.5 w-3.5" />
              <span>Target mode: {parsed.modeTarget}</span>
            </div>
          </div>
        )}

        {!hasStructured && (
          <pre className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs whitespace-pre-wrap break-all text-foreground/90">
            {parsed.jsonPreview}
          </pre>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {permission.options.map((opt) => {
          const isReject = opt.kind.startsWith("reject")
          return (
            <Button
              key={opt.option_id}
              variant={isReject ? "outline" : "default"}
              className="h-auto min-h-9 whitespace-normal break-words text-left"
              onClick={() => onRespond(permission.request_id, opt.option_id)}
            >
              {opt.name}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
