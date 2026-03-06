"use client"

import { useEffect, useMemo, useState } from "react"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import { inferLiveToolName } from "@/lib/tool-call-normalization"
import {
  countUnifiedDiffLineChanges,
  estimateChangedLineStats,
} from "@/lib/line-change-stats"
import { FilePenLine, Timer, Wrench } from "lucide-react"

function formatElapsed(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
  return `${(ms / 1_000).toFixed(1)}s`
}

interface LiveTurnStatsProps {
  message: LiveMessage
}

interface LineChangeStats {
  additions: number
  deletions: number
}

interface LiveEditStats extends LineChangeStats {
  files: number
}

const COMPACT_NUMBER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

function formatCompactInt(n: number): string {
  if (n < 1000) return String(n)
  return COMPACT_NUMBER.format(n).toUpperCase()
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseInputObject(
  input: string | null
): Record<string, unknown> | null {
  if (!input) return null
  try {
    return asObject(JSON.parse(input))
  } catch {
    return null
  }
}

function unescapeInlineEscapes(text: string): string {
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
}

function looksLikeDiffPayload(input: string): boolean {
  const normalized = unescapeInlineEscapes(input)
  return (
    normalized.includes("*** Begin Patch") ||
    normalized.includes("*** Update File:") ||
    /^diff --git /m.test(normalized) ||
    (/^--- .+/m.test(normalized) && /^\+\+\+ .+/m.test(normalized)) ||
    /^@@ /m.test(normalized)
  )
}

function extractPatchText(
  rawInput: string | null,
  parsed: Record<string, unknown> | null
): string | null {
  if (!rawInput) return null
  if (looksLikeDiffPayload(rawInput)) return unescapeInlineEscapes(rawInput)
  if (!parsed) return null

  const candidates = [
    parsed.patch,
    parsed.diff,
    parsed.unified_diff,
    parsed.unifiedDiff,
    parsed.command,
    parsed.input,
    parsed.arguments,
    parsed.payload,
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue
    if (looksLikeDiffPayload(candidate)) return unescapeInlineEscapes(candidate)
  }

  return null
}

function addPathIfValid(paths: Set<string>, value: unknown): void {
  if (typeof value !== "string") return
  const path = value.trim()
  if (!path) return
  paths.add(path)
}

function collectParsedPaths(
  parsed: Record<string, unknown> | null
): Set<string> {
  const paths = new Set<string>()
  if (!parsed) return paths

  addPathIfValid(
    paths,
    parsed.file_path ?? parsed.filePath ?? parsed.path ?? parsed.notebook_path
  )

  const changes = asObject(parsed.changes)
  if (changes) {
    for (const path of Object.keys(changes)) {
      addPathIfValid(paths, path)
    }
  }

  return paths
}

function parseApplyPatchStats(patch: string): {
  files: Set<string>
  additions: number
  deletions: number
} {
  const files = new Set<string>()
  let additions = 0
  let deletions = 0

  for (const line of patch.split("\n")) {
    if (line.startsWith("*** Add File: ")) {
      addPathIfValid(files, line.slice(14))
      continue
    }
    if (line.startsWith("*** Update File: ")) {
      addPathIfValid(files, line.slice(17))
      continue
    }
    if (line.startsWith("*** Delete File: ")) {
      addPathIfValid(files, line.slice(17))
      continue
    }
    if (line.startsWith("+++ ")) {
      const normalized = line.slice(4).replace(/^b\//, "").trim()
      if (normalized && normalized !== "/dev/null") {
        files.add(normalized)
      }
      continue
    }
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1
  }

  return { files, additions, deletions }
}

function extractEditStats(parsed: Record<string, unknown>): LineChangeStats {
  const changes = asObject(parsed.changes)
  if (changes) {
    let additions = 0
    let deletions = 0

    for (const change of Object.values(changes)) {
      const record = asObject(change)
      if (!record) continue

      const unifiedDiff =
        (typeof record.unifiedDiff === "string" && record.unifiedDiff) ||
        (typeof record.unified_diff === "string" && record.unified_diff) ||
        null

      if (unifiedDiff) {
        const stats = countUnifiedDiffLineChanges(unifiedDiff)
        additions += stats.additions
        deletions += stats.deletions
        continue
      }

      const oldString =
        (typeof record.oldText === "string" && record.oldText) ||
        (typeof record.old_string === "string" && record.old_string) ||
        ""
      const newString =
        (typeof record.newText === "string" && record.newText) ||
        (typeof record.new_string === "string" && record.new_string) ||
        ""

      const estimated = estimateChangedLineStats(oldString, newString)
      additions += estimated.additions
      deletions += estimated.deletions
    }

    return { additions, deletions }
  }

  const oldString =
    (typeof parsed.old_string === "string" && parsed.old_string) ||
    (typeof parsed.oldText === "string" && parsed.oldText) ||
    ""
  const newString =
    (typeof parsed.new_string === "string" && parsed.new_string) ||
    (typeof parsed.newText === "string" && parsed.newText) ||
    ""

  return estimateChangedLineStats(oldString, newString)
}

function extractWriteStats(parsed: Record<string, unknown>): LineChangeStats {
  const content =
    (typeof parsed.content === "string" && parsed.content) ||
    (typeof parsed.new_source === "string" && parsed.new_source) ||
    ""

  const additions = content.length === 0 ? 0 : content.split("\n").length
  return { additions, deletions: 0 }
}

function extractLiveEditStats(message: LiveMessage): LiveEditStats {
  const files = new Set<string>()
  let additions = 0
  let deletions = 0

  for (const block of message.content) {
    if (block.type !== "tool_call") continue
    const toolName = inferLiveToolName({
      title: block.info.title,
      kind: block.info.kind,
      rawInput: block.info.raw_input,
    })
    if (
      toolName !== "edit" &&
      toolName !== "write" &&
      toolName !== "apply_patch"
    )
      continue

    const parsed = parseInputObject(block.info.raw_input)
    for (const path of collectParsedPaths(parsed)) files.add(path)

    if (toolName === "apply_patch") {
      const patch = extractPatchText(block.info.raw_input, parsed)
      if (!patch) continue
      const stats = parseApplyPatchStats(patch)
      for (const path of stats.files) files.add(path)
      additions += stats.additions
      deletions += stats.deletions
      continue
    }

    if (!parsed) continue

    const stats =
      toolName === "edit" ? extractEditStats(parsed) : extractWriteStats(parsed)
    additions += stats.additions
    deletions += stats.deletions
  }

  return { files: files.size, additions, deletions }
}

export function LiveTurnStats({ message }: LiveTurnStatsProps) {
  const [elapsed, setElapsed] = useState(() => Date.now() - message.startedAt)
  const editStats = useMemo(() => extractLiveEditStats(message), [message])

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - message.startedAt)
    }, 100)
    return () => clearInterval(timer)
  }, [message.startedAt])

  // Count tool calls from live content
  let toolCallCount = 0
  let isThinking = false

  for (const block of message.content) {
    if (block.type === "tool_call") {
      toolCallCount++
    } else if (block.type === "thinking") {
      isThinking = true
    }
  }

  // If the last block is thinking, mark as currently thinking
  const lastBlock = message.content[message.content.length - 1]
  if (lastBlock?.type === "thinking") {
    isThinking = true
  }

  return (
    <div className="flex h-8 shrink-0 items-center justify-center gap-3 px-4 text-xs leading-none text-muted-foreground">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
      {isThinking && message.content.length <= 1 ? (
        <span>Thinking...</span>
      ) : (
        <span>Streaming</span>
      )}
      <span className="text-border leading-none">|</span>
      <span className="inline-flex items-center gap-1 leading-none">
        <Timer className="h-3 w-3 shrink-0" />
        {formatElapsed(elapsed)}
      </span>
      {editStats.files > 0 && (
        <>
          <span className="text-border leading-none">|</span>
          <span className="inline-flex items-center gap-1 leading-none">
            <FilePenLine className="h-3 w-3 shrink-0" />
            {editStats.files}F +{formatCompactInt(editStats.additions)}/-
            {formatCompactInt(editStats.deletions)}
          </span>
        </>
      )}
      {toolCallCount > 0 && (
        <>
          <span className="text-border leading-none">|</span>
          <span className="inline-flex items-center gap-1 leading-none">
            <Wrench className="h-3 w-3 shrink-0" />
            {toolCallCount} tool {toolCallCount === 1 ? "use" : "uses"}
          </span>
        </>
      )}
    </div>
  )
}
