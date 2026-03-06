"use client"

import {
  type ReactElement,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  ChevronsDownUp,
  ChevronsUpDown,
  CircleHelp,
  CloudCheck,
  CloudOff,
  GitBranch,
  GitBranchPlus,
  GitCompare,
  RefreshCw,
} from "lucide-react"
import {
  Commit,
  CommitActions,
  CommitContent,
  CommitCopyButton,
  CommitFileAdditions,
  CommitFileChanges,
  CommitFileDeletions,
  CommitFileIcon,
  CommitFileInfo,
  CommitFilePath,
  CommitFiles,
  CommitFileStatus,
  CommitHash,
  CommitHeader,
  CommitInfo,
  CommitMessage,
  CommitMetadata,
  CommitTimestamp,
} from "@/components/ai-elements/commit"
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useFolderContext } from "@/contexts/folder-context"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import {
  getGitBranch,
  gitCommitBranches,
  gitListAllBranches,
  gitLog,
  gitNewBranch,
} from "@/lib/tauri"
import type { GitBranchList, GitLogEntry, GitLogFileChange } from "@/lib/types"
import { toast } from "sonner"

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffDay > 30) {
    const diffMonth = Math.floor(diffDay / 30)
    return diffMonth === 1 ? "1 month ago" : `${diffMonth} months ago`
  }
  if (diffDay > 0) return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`
  if (diffHour > 0)
    return diffHour === 1 ? "1 hour ago" : `${diffHour} hours ago`
  if (diffMin > 0) return diffMin === 1 ? "1 min ago" : `${diffMin} mins ago`
  return "just now"
}

function parseDate(dateStr: string): Date | null {
  const date = new Date(dateStr)
  return Number.isNaN(date.getTime()) ? null : date
}

function filterRecordByCommitHashes<T>(
  record: Record<string, T>,
  hashes: Set<string>
): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    if (hashes.has(key)) {
      next[key] = value
    }
  }
  return next
}

function mapFileStatus(
  status: string
): "added" | "modified" | "deleted" | "renamed" {
  switch (status.toUpperCase().charAt(0)) {
    case "A":
      return "added"
    case "D":
      return "deleted"
    case "R":
      return "renamed"
    default:
      return "modified"
  }
}

function getPushStatusMeta(pushed: boolean | null): {
  label: string
  icon: typeof CloudCheck
  className: string
} {
  if (pushed === true) {
    return {
      label: "Pushed to remote",
      icon: CloudCheck,
      className: "text-emerald-500",
    }
  }

  if (pushed === false) {
    return {
      label: "Not pushed to remote",
      icon: CloudOff,
      className: "text-amber-500",
    }
  }

  return {
    label: "Push status unknown (no upstream configured)",
    icon: CircleHelp,
    className: "text-muted-foreground",
  }
}

type CommitFileTreeDirNode = {
  kind: "dir"
  name: string
  path: string
  children: CommitFileTreeNode[]
  fileCount: number
}

type CommitFileTreeFileNode = {
  kind: "file"
  name: string
  path: string
  change: GitLogFileChange
}

type CommitFileTreeNode = CommitFileTreeDirNode | CommitFileTreeFileNode

interface CommitBranchTarget {
  fullHash: string
  shortHash: string
}

interface MutableCommitFileTreeDirNode {
  kind: "dir"
  name: string
  path: string
  children: Map<string, MutableCommitFileTreeDirNode | CommitFileTreeFileNode>
}

function normalizePathSegments(path: string): string[] {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!normalized) return []
  return normalized.split("/").filter(Boolean)
}

function toSortedTreeNodes(
  dir: MutableCommitFileTreeDirNode
): CommitFileTreeNode[] {
  return Array.from(dir.children.values())
    .map<CommitFileTreeNode>((node) => {
      if (node.kind === "file") return node
      return {
        kind: "dir" as const,
        fileCount: 0,
        name: node.name,
        path: node.path,
        children: toSortedTreeNodes(node),
      }
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    })
}

function compressAndAnnotateDir(
  node: CommitFileTreeDirNode
): CommitFileTreeDirNode {
  let compressedChildren: CommitFileTreeNode[] = node.children.map((child) => {
    if (child.kind === "file") return child
    return compressAndAnnotateDir(child)
  })

  let fileCount = compressedChildren.reduce((count, child) => {
    if (child.kind === "file") return count + 1
    return count + child.fileCount
  }, 0)

  let nextNode: CommitFileTreeDirNode = {
    ...node,
    children: compressedChildren,
    fileCount,
  }

  // Merge "dir/dir/dir" chains where each directory only has one directory child.
  while (
    nextNode.children.length === 1 &&
    nextNode.children[0].kind === "dir"
  ) {
    const onlyChild = nextNode.children[0]
    nextNode = {
      kind: "dir",
      name: `${nextNode.name}/${onlyChild.name}`,
      path: onlyChild.path,
      children: onlyChild.children,
      fileCount: onlyChild.fileCount,
    }
  }

  compressedChildren = nextNode.children
  fileCount = compressedChildren.reduce((count, child) => {
    if (child.kind === "file") return count + 1
    return count + child.fileCount
  }, 0)

  return {
    ...nextNode,
    children: compressedChildren,
    fileCount,
  }
}

function buildCommitFileTree(files: GitLogFileChange[]): CommitFileTreeNode[] {
  const root: MutableCommitFileTreeDirNode = {
    kind: "dir",
    name: "",
    path: "",
    children: new Map(),
  }

  for (const change of files) {
    const segments = normalizePathSegments(change.path)
    if (segments.length === 0) continue

    let current = root
    for (const [index, segment] of segments.entries()) {
      const nodePath = segments.slice(0, index + 1).join("/")
      const isLeaf = index === segments.length - 1

      if (isLeaf) {
        current.children.set(`file:${nodePath}`, {
          kind: "file",
          name: segment,
          path: nodePath,
          change,
        })
        continue
      }

      const dirKey = `dir:${nodePath}`
      const existing = current.children.get(dirKey)
      if (existing && existing.kind === "dir") {
        current = existing
        continue
      }

      const nextDir: MutableCommitFileTreeDirNode = {
        kind: "dir",
        name: segment,
        path: nodePath,
        children: new Map(),
      }
      current.children.set(dirKey, nextDir)
      current = nextDir
    }
  }

  const sortedNodes = toSortedTreeNodes(root)
  return sortedNodes.map((node) => {
    if (node.kind === "file") return node
    return compressAndAnnotateDir(node)
  })
}

function collectExpandedDirectoryPaths(
  nodes: CommitFileTreeNode[],
  expanded = new Set<string>()
): Set<string> {
  for (const node of nodes) {
    if (node.kind !== "dir") continue
    expanded.add(node.path)
    collectExpandedDirectoryPaths(node.children, expanded)
  }
  return expanded
}

function CommitFilesTree({
  commitHash,
  files,
  folderName,
  onOpenCommitDiff,
  onOpenFilePreview,
}: {
  commitHash: string
  files: GitLogFileChange[]
  folderName: string
  onOpenCommitDiff: (
    commit: string,
    path?: string,
    description?: string
  ) => void
  onOpenFilePreview: (path: string) => void
}) {
  const rootPath = "__commit_file_tree_root__"
  const treeNodes = useMemo(() => buildCommitFileTree(files), [files])
  const allDirectoryPaths = useMemo(() => {
    const paths = collectExpandedDirectoryPaths(treeNodes)
    paths.add(rootPath)
    return paths
  }, [treeNodes])
  const [expandedPaths, setExpandedPaths] =
    useState<Set<string>>(allDirectoryPaths)

  useEffect(() => {
    setExpandedPaths(allDirectoryPaths)
  }, [allDirectoryPaths])

  const canExpandAll = useMemo(() => {
    if (allDirectoryPaths.size === 0) return false
    for (const path of allDirectoryPaths) {
      if (!expandedPaths.has(path)) return true
    }
    return false
  }, [allDirectoryPaths, expandedPaths])

  const canCollapseAll = expandedPaths.size > 0

  const toggleExpanded = useCallback(() => {
    if (canExpandAll) {
      setExpandedPaths(new Set(allDirectoryPaths))
      return
    }
    setExpandedPaths(new Set())
  }, [allDirectoryPaths, canExpandAll])

  const renderNode = (node: CommitFileTreeNode): ReactElement => {
    if (node.kind === "dir") {
      return (
        <FileTreeFolder
          key={node.path}
          path={node.path}
          name={node.name}
          suffix={`(${node.fileCount})`}
          suffixClassName="text-muted-foreground/45"
          title={node.path}
        >
          {node.children.map(renderNode)}
        </FileTreeFolder>
      )
    }

    const file = node.change
    return (
      <ContextMenu key={`${commitHash}:${file.path}`}>
        <ContextMenuTrigger asChild>
          <FileTreeFile
            className="w-full min-w-0 cursor-pointer"
            name={node.name}
            onClick={() => {
              void onOpenCommitDiff(commitHash, file.path)
            }}
            path={node.path}
            title={file.path}
          >
            <>
              <span className="size-4 shrink-0" />
              <CommitFileInfo className="flex-1 min-w-0 gap-1.5">
                <CommitFileStatus status={mapFileStatus(file.status)}>
                  {file.status}
                </CommitFileStatus>
                <CommitFileIcon />
                <CommitFilePath title={file.path}>{node.name}</CommitFilePath>
              </CommitFileInfo>
              <CommitFileChanges>
                <CommitFileAdditions count={file.additions} />
                <CommitFileDeletions count={file.deletions} />
              </CommitFileChanges>
            </>
          </FileTreeFile>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              void onOpenCommitDiff(commitHash, file.path)
            }}
          >
            查看差异
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              void onOpenFilePreview(file.path)
            }}
          >
            打开文件
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">Files</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            onClick={toggleExpanded}
            disabled={!canExpandAll && !canCollapseAll}
            title={canExpandAll ? "展开全部文件" : "折叠全部文件"}
            aria-label={canExpandAll ? "展开全部文件" : "折叠全部文件"}
          >
            {canExpandAll ? (
              <ChevronsUpDown className="size-3.5" />
            ) : (
              <ChevronsDownUp className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
      <CommitFiles>
        <FileTree
          className="max-h-[32rem] overflow-auto rounded-md border-border/60 bg-transparent text-xs [&>div]:p-1"
          expanded={expandedPaths}
          onExpandedChange={setExpandedPaths}
        >
          <FileTreeFolder
            path={rootPath}
            name={folderName}
            suffix={`(${files.length})`}
            suffixClassName="text-muted-foreground/45"
            title={folderName}
          >
            {treeNodes.map(renderNode)}
          </FileTreeFolder>
        </FileTree>
      </CommitFiles>
    </div>
  )
}

function BranchSelector({
  branchList,
  currentBranch,
  selectedBranch,
  onBranchChange,
  onRefresh,
  refreshing,
}: {
  branchList: GitBranchList
  currentBranch: string | null
  selectedBranch: string | null
  onBranchChange: (branch: string) => void
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      <Select value={selectedBranch ?? ""} onValueChange={onBranchChange}>
        <SelectTrigger
          size="sm"
          className="cursor-pointer flex-1 w-full text-xs bg-input/30 hover:bg-input/50 aria-expanded:bg-muted"
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <SelectValue placeholder="选择分支..." />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          {branchList.local.length > 0 && (
            <SelectGroup>
              <SelectLabel>本地分支</SelectLabel>
              {branchList.local.map((branch) => (
                <SelectItem
                  key={`local-${branch}`}
                  value={branch}
                  className="text-xs"
                >
                  {branch}
                  {branch === currentBranch && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      当前
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {branchList.remote.length > 0 && (
            <>
              {branchList.local.length > 0 && <SelectSeparator />}
              <SelectGroup>
                <SelectLabel>远程分支</SelectLabel>
                {branchList.remote.map((branch) => (
                  <SelectItem
                    key={`remote-${branch}`}
                    value={branch}
                    className="text-xs"
                  >
                    {branch}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0 rounded-full"
        onClick={onRefresh}
        disabled={refreshing}
        title="刷新提交记录"
        aria-label="刷新提交记录"
      >
        <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  )
}

export function GitLogTab() {
  const { folder } = useFolderContext()
  const { openCommitDiff, openFilePreview } = useWorkspaceContext()
  const [entries, setEntries] = useState<GitLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [openByCommit, setOpenByCommit] = useState<Record<string, boolean>>({})
  const [branchesByCommit, setBranchesByCommit] = useState<
    Record<string, string[]>
  >({})
  const [branchesLoading, setBranchesLoading] = useState<
    Record<string, boolean>
  >({})
  const [branchesError, setBranchesError] = useState<Record<string, string>>({})

  // Branch filter state
  const [branchList, setBranchList] = useState<GitBranchList>({
    local: [],
    remote: [],
    worktree_branches: [],
  })
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [newBranchTarget, setNewBranchTarget] =
    useState<CommitBranchTarget | null>(null)
  const [newBranchName, setNewBranchName] = useState("")
  const [creatingBranch, setCreatingBranch] = useState(false)

  const hasBranches =
    branchList.local.length > 0 || branchList.remote.length > 0
  const folderName = useMemo(() => {
    const path = folder?.path ?? ""
    const parts = path.split(/[\\/]/).filter(Boolean)
    return (parts[parts.length - 1] ?? path) || "workspace"
  }, [folder?.path])

  const handleBranchChange = useCallback((branch: string) => {
    setSelectedBranch(branch)
  }, [])

  const refreshBranches = useCallback(
    async (nextSelectedBranch?: string | null) => {
      if (!folder?.path) return
      try {
        const [allBranches, current] = await Promise.all([
          gitListAllBranches(folder.path),
          getGitBranch(folder.path),
        ])
        setBranchList(allBranches)
        setCurrentBranch(current)
        setSelectedBranch(nextSelectedBranch ?? current)
      } catch {
        // Silently ignore — branches dropdown won't appear
      }
    },
    [folder?.path]
  )

  // Fetch branches on mount
  useEffect(() => {
    void refreshBranches()
  }, [refreshBranches])

  const fetchCommitBranches = useCallback(
    async (fullHash: string) => {
      if (!folder?.path) return
      if (branchesByCommit[fullHash] || branchesLoading[fullHash]) return

      setBranchesLoading((prev) => ({ ...prev, [fullHash]: true }))
      setBranchesError((prev) => {
        if (!prev[fullHash]) return prev
        const next = { ...prev }
        delete next[fullHash]
        return next
      })

      try {
        const branches = await gitCommitBranches(folder.path, fullHash)
        setBranchesByCommit((prev) => ({ ...prev, [fullHash]: branches }))
      } catch (e) {
        setBranchesError((prev) => ({
          ...prev,
          [fullHash]: e instanceof Error ? e.message : String(e),
        }))
      } finally {
        setBranchesLoading((prev) => ({ ...prev, [fullHash]: false }))
      }
    },
    [branchesByCommit, branchesLoading, folder?.path]
  )

  const fetchLog = useCallback(
    async (options?: { inline?: boolean; branch?: string | null }) => {
      const inline = options?.inline ?? false
      const branch = options?.branch ?? selectedBranch
      if (!folder?.path) return
      if (inline) {
        setRefreshing(true)
      } else {
        setLoading(true)
        setOpenByCommit({})
        setBranchesByCommit({})
        setBranchesLoading({})
        setBranchesError({})
      }
      setError(null)
      try {
        const log = await gitLog(folder.path, 100, branch ?? undefined)
        setEntries(log)
        if (inline) {
          const commitHashes = new Set(log.map((entry) => entry.full_hash))
          setOpenByCommit((prev) =>
            filterRecordByCommitHashes(prev, commitHashes)
          )
          setBranchesByCommit((prev) =>
            filterRecordByCommitHashes(prev, commitHashes)
          )
          setBranchesLoading((prev) =>
            filterRecordByCommitHashes(prev, commitHashes)
          )
          setBranchesError((prev) =>
            filterRecordByCommitHashes(prev, commitHashes)
          )
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (inline) {
          setRefreshing(false)
        } else {
          setLoading(false)
        }
      }
    },
    [folder?.path, selectedBranch]
  )

  const handleRefresh = useCallback(() => {
    void fetchLog({ inline: true })
  }, [fetchLog])

  const handleOpenNewBranchDialog = useCallback((entry: GitLogEntry) => {
    setNewBranchName("")
    setNewBranchTarget({
      fullHash: entry.full_hash,
      shortHash: entry.hash,
    })
  }, [])

  const handleCreateBranchFromCommit = useCallback(async () => {
    const name = newBranchName.trim()
    if (!folder?.path || !newBranchTarget || !name || creatingBranch) return

    setCreatingBranch(true)
    try {
      await gitNewBranch(folder.path, name, newBranchTarget.fullHash)
      setNewBranchTarget(null)
      setNewBranchName("")
      await refreshBranches(name)
      toast.success("已创建并切换到新分支", {
        description: `${name} (from ${newBranchTarget.shortHash})`,
      })
    } catch (error) {
      toast.error("新建分支失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setCreatingBranch(false)
    }
  }, [
    creatingBranch,
    folder?.path,
    newBranchName,
    newBranchTarget,
    refreshBranches,
  ])

  useEffect(() => {
    void fetchLog()
  }, [fetchLog])

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const nextScrolled = e.currentTarget.scrollTop > 0
    setScrolled((prev) => (prev === nextScrolled ? prev : nextScrolled))
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-2">
        {hasBranches && (
          <BranchSelector
            branchList={branchList}
            currentBranch={currentBranch}
            selectedBranch={selectedBranch}
            onBranchChange={handleBranchChange}
            onRefresh={handleRefresh}
            refreshing={loading || refreshing}
          />
        )}
        <div className="space-y-3 pt-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-2">
        {hasBranches && (
          <BranchSelector
            branchList={branchList}
            currentBranch={currentBranch}
            selectedBranch={selectedBranch}
            onBranchChange={handleBranchChange}
            onRefresh={handleRefresh}
            refreshing={loading || refreshing}
          />
        )}
        <div className="pt-1 text-xs text-destructive">
          <p>{error}</p>
          <Button
            variant="ghost"
            size="xs"
            className="mt-2"
            onClick={() => {
              void fetchLog()
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-2">
        {hasBranches && (
          <BranchSelector
            branchList={branchList}
            currentBranch={currentBranch}
            selectedBranch={selectedBranch}
            onBranchChange={handleBranchChange}
            onRefresh={handleRefresh}
            refreshing={loading || refreshing}
          />
        )}
        <div className="pt-1 text-xs text-muted-foreground">
          No commits found
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2"
          >
            {hasBranches && (
              <div
                className={`sticky top-0 z-10 rounded-full bg-sidebar/85 supports-[backdrop-filter]:bg-sidebar/70 backdrop-blur ${scrolled ? "p-2 shadow-md" : "p-0"}`}
              >
                <BranchSelector
                  branchList={branchList}
                  currentBranch={currentBranch}
                  selectedBranch={selectedBranch}
                  onBranchChange={handleBranchChange}
                  onRefresh={handleRefresh}
                  refreshing={loading || refreshing}
                />
              </div>
            )}
            {entries.map((entry) => {
              const commitKey = entry.full_hash
              const commitDate = parseDate(entry.date)
              const pushStatus = getPushStatusMeta(entry.pushed)
              const PushStatusIcon = pushStatus.icon
              const commitBranches = branchesByCommit[commitKey]
              const isBranchLoading = !!branchesLoading[commitKey]
              const branchError = branchesError[commitKey]
              const isOpen = !!openByCommit[commitKey]

              return (
                <ContextMenu key={entry.full_hash}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <Commit
                        onOpenChange={(open) => {
                          setOpenByCommit((prev) => ({
                            ...prev,
                            [commitKey]: open,
                          }))
                          if (open) {
                            void fetchCommitBranches(commitKey)
                          }
                        }}
                        open={isOpen}
                      >
                        <CommitHeader>
                          <CommitInfo className="min-w-0">
                            <CommitMessage className="line-clamp-1 leading-snug">
                              {entry.message}
                            </CommitMessage>
                            <CommitMetadata className="mt-1 min-w-0 flex items-center gap-1.5">
                              <span
                                className="inline-flex shrink-0"
                                title={pushStatus.label}
                                aria-label={pushStatus.label}
                              >
                                <PushStatusIcon
                                  className={pushStatus.className}
                                  size={12}
                                />
                              </span>
                              <span className="truncate">{entry.author}</span>
                              <CommitTimestamp
                                className="shrink-0"
                                date={commitDate ?? new Date()}
                              >
                                {formatRelativeTime(entry.date)}
                              </CommitTimestamp>
                              <CommitHash className="text-primary/70">
                                {entry.hash}
                              </CommitHash>
                            </CommitMetadata>
                          </CommitInfo>
                          <CommitActions className="shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                void openCommitDiff(
                                  entry.full_hash,
                                  undefined,
                                  entry.message
                                )
                              }}
                              title="查看差异"
                              aria-label={`查看提交 ${entry.hash} 的差异`}
                            >
                              <GitCompare size={14} />
                            </Button>
                          </CommitActions>
                        </CommitHeader>
                        <CommitContent>
                          <div className="space-y-3">
                            <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-xs">
                              <span className="text-muted-foreground">
                                Hash
                              </span>
                              <span className="group/hash flex items-center gap-1 min-w-0">
                                <code
                                  className="block min-w-0 flex-1 truncate font-mono"
                                  title={entry.full_hash}
                                >
                                  {entry.full_hash}
                                </code>
                                <CommitCopyButton
                                  aria-label={`Copy full commit hash ${entry.full_hash}`}
                                  className="size-5 shrink-0 opacity-0 transition-opacity group-hover/hash:opacity-100 group-focus-within/hash:opacity-100"
                                  hash={entry.full_hash}
                                  title="Copy hash"
                                />
                              </span>
                              <span className="text-muted-foreground">
                                Author
                              </span>
                              <span className="min-w-0 flex items-center gap-1">
                                <span className="min-w-0 truncate">
                                  {entry.author}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  ·
                                </span>
                                <time
                                  className="shrink-0"
                                  dateTime={commitDate?.toISOString()}
                                >
                                  {commitDate
                                    ? commitDate.toLocaleString()
                                    : entry.date}
                                </time>
                              </span>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                              <p className="text-xs whitespace-pre-wrap break-words">
                                {entry.message}
                              </p>
                            </div>
                            {entry.files.length === 0 ? (
                              <div className="space-y-1">
                                <p className="text-[11px] text-muted-foreground">
                                  Files
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  No file change details available.
                                </p>
                              </div>
                            ) : (
                              <CommitFilesTree
                                commitHash={entry.full_hash}
                                files={entry.files}
                                folderName={folderName}
                                onOpenCommitDiff={openCommitDiff}
                                onOpenFilePreview={openFilePreview}
                              />
                            )}
                            <div className="pt-3 space-y-1">
                              <p className="text-[11px] text-muted-foreground">
                                Branches
                              </p>
                              {isBranchLoading ? (
                                <p className="text-xs text-muted-foreground">
                                  Loading branches...
                                </p>
                              ) : branchError ? (
                                <p className="text-xs text-destructive">
                                  {branchError}
                                </p>
                              ) : commitBranches &&
                                commitBranches.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {commitBranches.map((branch) => (
                                    <span
                                      key={`${commitKey}-${branch}`}
                                      className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                      title={branch}
                                    >
                                      {branch}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  No containing branches found.
                                </p>
                              )}
                            </div>
                          </div>
                        </CommitContent>
                      </Commit>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => {
                        handleOpenNewBranchDialog(entry)
                      }}
                    >
                      <GitBranchPlus className="h-3.5 w-3.5" />
                      新建分支...
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => {
                        void openCommitDiff(
                          entry.full_hash,
                          undefined,
                          entry.message
                        )
                      }}
                    >
                      <GitCompare className="h-3.5 w-3.5" />
                      查看差异
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              void fetchLog()
            }}
          >
            刷新
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog
        open={newBranchTarget !== null}
        onOpenChange={(open) => {
          if (!open && !creatingBranch) {
            setNewBranchTarget(null)
            setNewBranchName("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建分支</DialogTitle>
            <DialogDescription>
              以提交 {newBranchTarget?.shortHash ?? "-"}{" "}
              作为最后提交创建新分支。
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="分支名称"
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.key === "Process" ||
                event.key !== "Enter"
              ) {
                return
              }
              void handleCreateBranchFromCommit()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={creatingBranch}
              onClick={() => {
                setNewBranchTarget(null)
                setNewBranchName("")
              }}
            >
              取消
            </Button>
            <Button
              disabled={!newBranchName.trim() || creatingBranch}
              onClick={() => {
                void handleCreateBranchFromCommit()
              }}
            >
              创建并切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
