"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpenText,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  acpDeleteAgentSkill,
  acpListAgents,
  acpListAgentSkills,
  openFolderWindow,
  acpReadAgentSkill,
  acpSaveAgentSkill,
} from "@/lib/tauri"
import type {
  AcpAgentInfo,
  AgentSkillItem,
  AgentSkillLayout,
  AgentSkillLocation,
  AgentType,
} from "@/lib/types"

function defaultSkillContent(agentType: AgentType): string {
  if (agentType === "gemini") {
    return `---
name: example-skill
description: Describe when this skill should be used.
---

# Skill Name

Instructions for the agent when this skill is active.

## Workflow

1. Add actionable step one.
2. Add actionable step two.
`
  }

  if (agentType === "open_code") {
    return `---
name: example-skill
description: Describe when this skill should be used.
---

# Purpose

Describe what this skill helps with.

# Steps

1. Add actionable step one.
2. Add actionable step two.
`
  }

  if (agentType === "open_claw") {
    return `---
name: example-skill
description: Describe when this skill should be used.
user-invocable: true
disable-model-invocation: false
---

# Purpose

Describe what this skill helps with.

# Instructions

1. Add actionable instruction one.
2. Add actionable instruction two.
`
  }

  return `# Skill: example-skill

## When to use

- Describe trigger conditions.

## Instructions

1. Add actionable instruction one.
2. Add actionable instruction two.
`
}

function defaultSkillLayoutForAgent(
  agentType: AgentType,
  existingLayout?: AgentSkillLayout | null
): AgentSkillLayout | null {
  if (existingLayout) return existingLayout
  if (agentType === "claude_code") return "skill_directory"
  if (agentType === "open_code") return "skill_directory"
  if (agentType === "codex") return "skill_directory"
  if (agentType === "gemini") return "skill_directory"
  if (agentType === "open_claw") return "skill_directory"
  return null
}

function pathJoin(base: string, suffix: string): string {
  if (base.endsWith("/") || base.endsWith("\\")) {
    return `${base}${suffix}`
  }
  return `${base}/${suffix}`
}

function buildDraftPathPreview(params: {
  location: AgentSkillLocation | null
  id: string
  layout: AgentSkillLayout | null
  selectedSkillPath: string | null
  isExisting: boolean
}): string | null {
  const { location, id, layout, selectedSkillPath, isExisting } = params
  if (isExisting && selectedSkillPath) return selectedSkillPath
  if (!location || !id.trim()) return null

  const trimmedId = id.trim()
  if (layout === "skill_directory") {
    return pathJoin(location.path, `${trimmedId}/SKILL.md`)
  }
  return pathJoin(location.path, `${trimmedId}.md`)
}

function dirname(path: string): string {
  const normalized = path.replace(/[/\\]+$/, "")
  const sepIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\")
  )
  if (sepIndex <= 0) return normalized
  return normalized.slice(0, sepIndex)
}

function skillDirectoryPath(skill: AgentSkillItem): string {
  if (skill.layout === "skill_directory") {
    return dirname(skill.path)
  }
  return dirname(skill.path)
}

interface FrontMatterField {
  key: string
  value: string
}

interface ParsedFrontMatter {
  frontMatterRaw: string | null
  fields: FrontMatterField[]
  body: string
}

const SKILLS_LEFT_MIN_WIDTH = 300
const SKILLS_RIGHT_MIN_WIDTH = 420

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toPercent(pixels: number, totalPixels: number): number {
  if (totalPixels <= 0) return 0
  return (pixels / totalPixels) * 100
}

function parseYamlFrontMatter(content: string): ParsedFrontMatter {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?/)
  if (!match) {
    return {
      frontMatterRaw: null,
      fields: [],
      body: content,
    }
  }

  const raw = match[1].trim()
  const lines = raw.split(/\r?\n/)
  const fields: FrontMatterField[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields.push({ key: kv[1], value })
  }

  return {
    frontMatterRaw: raw,
    fields,
    body: content.slice(match[0].length),
  }
}

export function SkillsSettings() {
  const panelContainerRef = useRef<HTMLDivElement | null>(null)
  const [panelContainerWidth, setPanelContainerWidth] = useState(0)
  const [agents, setAgents] = useState<AcpAgentInfo[]>([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [selectedAgentType, setSelectedAgentType] = useState<AgentType | null>(
    null
  )

  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [skillsSupported, setSkillsSupported] = useState(true)
  const [skillLocation, setSkillLocation] = useState<AgentSkillLocation | null>(
    null
  )
  const [skillItems, setSkillItems] = useState<AgentSkillItem[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)

  const [skillDraftId, setSkillDraftId] = useState("")
  const [skillDraftContent, setSkillDraftContent] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  const [skillReading, setSkillReading] = useState(false)
  const [skillSaving, setSkillSaving] = useState(false)
  const [skillDeletingId, setSkillDeletingId] = useState<string | null>(null)
  const [deleteTargetSkill, setDeleteTargetSkill] =
    useState<AgentSkillItem | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isContentEditing, setIsContentEditing] = useState(false)

  const sortedAgents = useMemo(
    () =>
      [...agents].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      ),
    [agents]
  )

  const selectedAgent = useMemo(
    () =>
      sortedAgents.find((agent) => agent.agent_type === selectedAgentType) ??
      null,
    [selectedAgentType, sortedAgents]
  )

  const filteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return skillItems.filter((skill) => {
      if (!q) return true
      return (
        skill.id.toLowerCase().includes(q) ||
        skill.name.toLowerCase().includes(q) ||
        skill.path.toLowerCase().includes(q)
      )
    })
  }, [searchQuery, skillItems])

  const selectedSkill = useMemo(
    () => skillItems.find((item) => item.id === selectedSkillId) ?? null,
    [selectedSkillId, skillItems]
  )

  const isEditingExisting = Boolean(
    selectedSkill && skillDraftId.trim() === selectedSkill.id
  )

  const resolvedLayout = useMemo(
    () =>
      selectedAgent
        ? defaultSkillLayoutForAgent(
            selectedAgent.agent_type,
            selectedSkill?.layout
          )
        : null,
    [selectedAgent, selectedSkill?.layout]
  )

  const draftPathPreview = useMemo(
    () =>
      buildDraftPathPreview({
        location: skillLocation,
        id: skillDraftId,
        layout: resolvedLayout,
        selectedSkillPath: selectedSkill?.path ?? null,
        isExisting: isEditingExisting,
      }),
    [
      isEditingExisting,
      resolvedLayout,
      selectedSkill?.path,
      skillDraftId,
      skillLocation,
    ]
  )

  const parsedPreviewContent = useMemo(
    () => parseYamlFrontMatter(skillDraftContent),
    [skillDraftContent]
  )

  const resetDraft = useCallback(
    (agentType: AgentType, contentEditing = false) => {
      setSelectedSkillId(null)
      setSkillDraftId("")
      setSkillDraftContent(defaultSkillContent(agentType))
      setIsContentEditing(contentEditing)
    },
    []
  )

  const openSkill = useCallback(
    async (
      agentType: AgentType,
      skill: AgentSkillItem,
      mode: "preview" | "edit" = "preview"
    ) => {
      setSkillReading(true)
      try {
        const detail = await acpReadAgentSkill({
          agentType,
          scope: "global",
          skillId: skill.id,
        })
        setSelectedSkillId(detail.skill.id)
        setSkillDraftId(detail.skill.id)
        setSkillDraftContent(detail.content)
        setIsContentEditing(mode === "edit")
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error("加载 Skill 失败", { description: message })
      } finally {
        setSkillReading(false)
      }
    },
    []
  )

  const loadSkills = useCallback(async (agentType: AgentType) => {
    setSkillsLoading(true)
    setSkillsError(null)

    try {
      const result = await acpListAgentSkills({ agentType })
      setSkillsSupported(result.supported)
      setSkillLocation(
        result.locations.find((location) => location.scope === "global") ?? null
      )
      setSkillItems(result.skills.filter((skill) => skill.scope === "global"))
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSkillsError(message)
      setSkillsSupported(true)
      setSkillLocation(null)
      setSkillItems([])
      return null
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  const refreshAgents = useCallback(async () => {
    setLoadingAgents(true)
    setLoadingError(null)

    try {
      const next = await acpListAgents()
      const supportChecks = await Promise.allSettled(
        next.map(async (agent) => {
          const result = await acpListAgentSkills({
            agentType: agent.agent_type,
          })
          return result.supported ? agent.agent_type : null
        })
      )

      const supported = new Set<AgentType>()
      for (const check of supportChecks) {
        if (check.status !== "fulfilled") continue
        if (!check.value) continue
        supported.add(check.value)
      }

      setAgents(next.filter((agent) => supported.has(agent.agent_type)))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setLoadingError(message)
      setAgents([])
    } finally {
      setLoadingAgents(false)
    }
  }, [])

  const handleCreateDraft = useCallback(() => {
    if (!selectedAgent) return
    resetDraft(selectedAgent.agent_type, true)
  }, [resetDraft, selectedAgent])

  const handlePreviewSkill = useCallback(
    async (skill: AgentSkillItem) => {
      if (!selectedAgent) return
      await openSkill(selectedAgent.agent_type, skill, "preview")
    },
    [openSkill, selectedAgent]
  )

  const handleEditSkill = useCallback(
    async (skill: AgentSkillItem) => {
      if (!selectedAgent) return
      await openSkill(selectedAgent.agent_type, skill, "edit")
    },
    [openSkill, selectedAgent]
  )

  const handleOpenSkillDirectory = useCallback(
    async (skill: AgentSkillItem) => {
      const dirPath = skillDirectoryPath(skill)
      try {
        await openFolderWindow(dirPath)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error("打开目录失败", { description: message })
      }
    },
    []
  )

  const handleRequestDeleteSkill = useCallback((skill: AgentSkillItem) => {
    setDeleteTargetSkill(skill)
    setDeleteDialogOpen(true)
  }, [])

  const handleResetDraft = useCallback(() => {
    if (!selectedAgent) return
    if (selectedSkill && isEditingExisting) {
      openSkill(
        selectedAgent.agent_type,
        selectedSkill,
        isContentEditing ? "edit" : "preview"
      ).catch((err) => {
        console.error("[SkillsSettings] reset/open failed:", err)
      })
      return
    }
    resetDraft(selectedAgent.agent_type, isContentEditing)
  }, [
    isContentEditing,
    isEditingExisting,
    openSkill,
    resetDraft,
    selectedAgent,
    selectedSkill,
  ])

  const handleSaveSkill = useCallback(async () => {
    if (!selectedAgent) return
    if (!skillLocation) {
      toast.error("当前 Agent 未找到可用的 Skills 目录")
      return
    }

    const trimmedId = skillDraftId.trim()
    if (!trimmedId) {
      toast.error("Skill 名称不能为空")
      return
    }

    setSkillSaving(true)
    try {
      const saved = await acpSaveAgentSkill({
        agentType: selectedAgent.agent_type,
        scope: "global",
        skillId: trimmedId,
        content: skillDraftContent,
        layout: resolvedLayout,
      })

      await loadSkills(selectedAgent.agent_type)
      await openSkill(
        selectedAgent.agent_type,
        saved,
        isContentEditing ? "edit" : "preview"
      )
      toast.success(isEditingExisting ? "Skill 已更新" : "Skill 已创建")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error("保存 Skill 失败", { description: message })
    } finally {
      setSkillSaving(false)
    }
  }, [
    isEditingExisting,
    loadSkills,
    openSkill,
    resolvedLayout,
    selectedAgent,
    skillDraftContent,
    skillDraftId,
    skillLocation,
    isContentEditing,
  ])

  const handleDeleteSkill = useCallback(
    async (skill: AgentSkillItem) => {
      if (!selectedAgent) return

      const deletingCurrent = selectedSkillId === skill.id
      setSkillDeletingId(skill.id)

      try {
        await acpDeleteAgentSkill({
          agentType: selectedAgent.agent_type,
          scope: "global",
          skillId: skill.id,
        })

        const latest = await loadSkills(selectedAgent.agent_type)
        toast.success("Skill 已删除")

        if (!deletingCurrent) return

        const nextSkill = latest?.skills.find((item) => item.scope === "global")
        if (nextSkill) {
          await openSkill(selectedAgent.agent_type, nextSkill)
        } else {
          resetDraft(selectedAgent.agent_type, true)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error("删除 Skill 失败", { description: message })
      } finally {
        setSkillDeletingId(null)
        setDeleteDialogOpen(false)
        setDeleteTargetSkill(null)
      }
    },
    [loadSkills, openSkill, resetDraft, selectedAgent, selectedSkillId]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTargetSkill) return
    await handleDeleteSkill(deleteTargetSkill)
  }, [deleteTargetSkill, handleDeleteSkill])

  useEffect(() => {
    const container = panelContainerRef.current
    if (!container) return

    const updateWidth = (next: number) => {
      setPanelContainerWidth((prev) =>
        Math.abs(prev - next) < 1 ? prev : next
      )
    }

    updateWidth(container.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      updateWidth(
        entries[0]?.contentRect.width ?? container.getBoundingClientRect().width
      )
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [])

  const safeContainerWidth =
    panelContainerWidth > 0 ? panelContainerWidth : 1200
  const leftMinSize = clamp(
    toPercent(SKILLS_LEFT_MIN_WIDTH, safeContainerWidth),
    5,
    95
  )
  const rightMinSize = clamp(
    toPercent(SKILLS_RIGHT_MIN_WIDTH, safeContainerWidth),
    5,
    95
  )
  const leftMaxSize = Math.max(leftMinSize, 100 - rightMinSize)

  useEffect(() => {
    refreshAgents().catch((err) => {
      console.error("[SkillsSettings] refresh agents failed:", err)
    })
  }, [refreshAgents])

  useEffect(() => {
    if (sortedAgents.length === 0) {
      setSelectedAgentType(null)
      return
    }

    setSelectedAgentType((prev) => {
      if (prev && sortedAgents.some((agent) => agent.agent_type === prev)) {
        return prev
      }
      return sortedAgents[0].agent_type
    })
  }, [sortedAgents])

  useEffect(() => {
    const currentAgentType = selectedAgent?.agent_type
    if (!currentAgentType) {
      setSkillsError(null)
      setSkillsSupported(true)
      setSkillLocation(null)
      setSkillItems([])
      setSelectedSkillId(null)
      setSkillDraftId("")
      setSkillDraftContent("")
      setSearchQuery("")
      setIsContentEditing(false)
      return
    }

    let cancelled = false
    setSearchQuery("")
    resetDraft(currentAgentType)

    loadSkills(currentAgentType)
      .then((result) => {
        if (cancelled || !result || !result.supported) return

        const firstGlobalSkill = result.skills.find(
          (skill) => skill.scope === "global"
        )

        if (!firstGlobalSkill) return

        openSkill(currentAgentType, firstGlobalSkill).catch((err) => {
          console.error("[SkillsSettings] initial open skill failed:", err)
        })
      })
      .catch((err) => {
        console.error("[SkillsSettings] load skills failed:", err)
      })

    return () => {
      cancelled = true
    }
  }, [loadSkills, openSkill, resetDraft, selectedAgent])

  if (loadingAgents) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        正在加载支持 Skills 的 Agent...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="text-base font-semibold">Skills</h2>
          <p className="text-xs text-muted-foreground mt-1">
            左侧选择 Skill，右侧默认预览 Markdown，点击编辑后可修改并保存。
          </p>
        </div>
      </div>

      {loadingError && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {loadingError}
        </div>
      )}

      {sortedAgents.length === 0 ? (
        <div className="h-full rounded-lg border bg-card flex items-center justify-center text-sm text-muted-foreground">
          当前没有可管理 Skills 的 Agent。
        </div>
      ) : (
        <div ref={panelContainerRef} className="flex-1 min-h-0 min-w-0">
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full min-h-0 min-w-0"
          >
            <ResizablePanel
              defaultSize={36}
              minSize={leftMinSize}
              maxSize={leftMaxSize}
            >
              <div className="min-h-0 h-full min-w-0 rounded-lg border bg-card flex flex-col overflow-hidden lg:rounded-r-none">
                <div className="border-b p-3 space-y-2.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    管理对象
                  </div>
                  <Select
                    value={selectedAgentType ?? ""}
                    onValueChange={(value) => {
                      setSelectedAgentType(value as AgentType)
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="请选择 Agent" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {sortedAgents.map((agent) => (
                        <SelectItem
                          key={agent.agent_type}
                          value={agent.agent_type}
                        >
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value)
                    }}
                    placeholder="搜索名称 / ID / 路径..."
                  />
                </div>

                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between gap-2">
                  <span>Skills 列表</span>
                  <span>{filteredSkills.length}</span>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
                  {skillsLoading && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 p-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      加载 Skills 中...
                    </div>
                  )}

                  {!skillsLoading && skillsError && (
                    <div className="text-xs text-red-400 rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-2">
                      {skillsError}
                    </div>
                  )}

                  {!skillsLoading && !skillsError && !skillsSupported && (
                    <div className="text-xs text-muted-foreground rounded-md border bg-muted/20 px-2.5 py-2">
                      当前 Agent 暂不支持 Skills 管理。
                    </div>
                  )}

                  {!skillsLoading &&
                    skillsSupported &&
                    filteredSkills.length === 0 && (
                      <div className="text-xs text-muted-foreground px-1">
                        暂无 Skill，可点击“新建 Skill”。
                      </div>
                    )}

                  {!skillsLoading &&
                    skillsSupported &&
                    filteredSkills.map((skill) => {
                      const isActive = skill.id === selectedSkillId
                      const deleting = skillDeletingId === skill.id

                      return (
                        <ContextMenu key={skill.id}>
                          <ContextMenuTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                                isActive
                                  ? "border-primary/60 bg-primary/5"
                                  : "hover:bg-muted/30"
                              )}
                              onClick={() => {
                                handlePreviewSkill(skill).catch((err) => {
                                  console.error(
                                    "[SkillsSettings] preview skill failed:",
                                    err
                                  )
                                })
                              }}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-xs font-medium truncate">
                                  {skill.name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="h-6 px-2 inline-flex items-center gap-1 text-xs leading-none shrink-0 border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                >
                                  {skill.scope}
                                </Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate mt-1">
                                {skill.path}
                              </div>
                            </button>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              onSelect={() => {
                                handlePreviewSkill(skill).catch((err) => {
                                  console.error(
                                    "[SkillsSettings] context preview skill failed:",
                                    err
                                  )
                                })
                              }}
                            >
                              预览
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => {
                                handleEditSkill(skill).catch((err) => {
                                  console.error(
                                    "[SkillsSettings] context edit skill failed:",
                                    err
                                  )
                                })
                              }}
                            >
                              编辑
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => {
                                handleOpenSkillDirectory(skill).catch((err) => {
                                  console.error(
                                    "[SkillsSettings] context open folder failed:",
                                    err
                                  )
                                })
                              }}
                            >
                              在新窗口打开
                            </ContextMenuItem>
                            <ContextMenuItem
                              disabled={skillSaving || skillReading || deleting}
                              onSelect={() => {
                                handleRequestDeleteSkill(skill)
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              {deleting ? "删除中..." : "删除"}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })}
                </div>

                <div className="border-t p-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      if (!selectedAgent) return
                      loadSkills(selectedAgent.agent_type).catch((err) => {
                        console.error(
                          "[SkillsSettings] refresh skills failed:",
                          err
                        )
                      })
                    }}
                    disabled={skillsLoading}
                  >
                    {skillsLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    刷新
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleCreateDraft}
                    disabled={!selectedAgent}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新建 Skill
                  </Button>
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={64} minSize={rightMinSize}>
              <div className="h-full flex-1 min-h-0 min-w-0 rounded-lg border bg-card overflow-hidden lg:rounded-l-none lg:border-l-0">
                {selectedAgent ? (
                  <div className="h-full flex flex-col">
                    <div className="border-b px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold truncate">
                          {skillDraftId.trim() || "新建 Skill"}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={handleResetDraft}
                          disabled={skillSaving || skillReading}
                        >
                          <RotateCcw className="h-3 w-3" />
                          重置
                        </Button>
                        <Button
                          size="xs"
                          onClick={() => {
                            handleSaveSkill().catch((err) => {
                              console.error(
                                "[SkillsSettings] save skill failed:",
                                err
                              )
                            })
                          }}
                          disabled={skillSaving || skillReading}
                        >
                          {skillSaving ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              保存中...
                            </>
                          ) : (
                            <>
                              <Save className="h-3 w-3" />
                              保存
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      <div className="rounded-md border p-3 space-y-2.5">
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <BookOpenText className="h-3.5 w-3.5" />
                          Skill 信息
                        </div>

                        <Input
                          value={skillDraftId}
                          onChange={(event) => {
                            setSkillDraftId(event.target.value)
                          }}
                          placeholder="skill-id (letters/numbers/-/_/.)"
                        />

                        {draftPathPreview ? (
                          <div className="text-[11px] text-muted-foreground break-all">
                            Skills目录：{draftPathPreview}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground break-all">
                            Skills目录：请输入 Skill ID 以生成完整路径
                          </div>
                        )}
                      </div>

                      <div className="rounded-md border p-3 space-y-2">
                        <div className="text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                          <span>Markdown 内容</span>
                          <div className="flex items-center gap-1.5">
                            <span>
                              {isContentEditing ? "编辑中" : "预览中"}
                            </span>
                            <Button
                              size="xs"
                              variant={
                                isContentEditing ? "secondary" : "outline"
                              }
                              onClick={() => {
                                setIsContentEditing((prev) => !prev)
                              }}
                              disabled={skillReading}
                            >
                              {isContentEditing ? (
                                <>
                                  <Eye className="h-3 w-3" />
                                  预览
                                </>
                              ) : (
                                <>
                                  <Pencil className="h-3 w-3" />
                                  编辑
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        {isContentEditing ? (
                          <Textarea
                            value={skillDraftContent}
                            onChange={(event) => {
                              setSkillDraftContent(event.target.value)
                            }}
                            placeholder="输入 Skill 文本内容..."
                            className="min-h-80 font-mono text-xs"
                          />
                        ) : (
                          <div className="space-y-2">
                            {parsedPreviewContent.frontMatterRaw && (
                              <div className="rounded-md border bg-muted/10 p-3">
                                <div className="text-[11px] text-muted-foreground mb-2">
                                  Skills 元信息
                                </div>
                                {parsedPreviewContent.fields.length > 0 ? (
                                  <div className="grid gap-1.5">
                                    {parsedPreviewContent.fields.map(
                                      (field) => (
                                        <div
                                          key={field.key}
                                          className="text-xs grid grid-cols-[100px_1fr] gap-2 items-start"
                                        >
                                          <span className="text-muted-foreground font-mono truncate">
                                            {field.key}
                                          </span>
                                          <span className="font-mono break-all">
                                            {field.value}
                                          </span>
                                        </div>
                                      )
                                    )}
                                  </div>
                                ) : (
                                  <pre className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground">
                                    {parsedPreviewContent.frontMatterRaw}
                                  </pre>
                                )}
                              </div>
                            )}

                            <div className="min-h-80 rounded-md border bg-muted/10 p-3 overflow-auto">
                              {parsedPreviewContent.body.trim() ? (
                                <div
                                  className={cn(
                                    "text-sm leading-6",
                                    "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mb-3",
                                    "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2",
                                    "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2",
                                    "[&_p]:mb-3 [&_li]:mb-1",
                                    "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
                                    "[&_code]:font-mono [&_code]:text-xs [&_code]:bg-muted [&_code]:rounded [&_code]:px-1",
                                    "[&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto"
                                  )}
                                >
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {parsedPreviewContent.body}
                                  </ReactMarkdown>
                                </div>
                              ) : parsedPreviewContent.frontMatterRaw ? (
                                <div className="text-xs text-muted-foreground py-3">
                                  该 Skill 仅包含 YAML 元信息。
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground py-3">
                                  暂无内容。点击“编辑”开始输入。
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {skillReading && (
                          <div className="text-[11px] text-muted-foreground">
                            正在加载 Skill...
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    暂无可用 Agent。
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open && !skillDeletingId) {
            setDeleteTargetSkill(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Skill</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTargetSkill ? (
                <>
                  确认删除 Skill <code>{deleteTargetSkill.name}</code>{" "}
                  吗？该操作无法撤销。
                </>
              ) : (
                "确认删除当前 Skill 吗？该操作无法撤销。"
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(skillDeletingId)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!deleteTargetSkill || Boolean(skillDeletingId)}
              onClick={() => {
                handleConfirmDelete().catch((err) => {
                  console.error("[SkillsSettings] confirm delete failed:", err)
                })
              }}
            >
              {skillDeletingId ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
