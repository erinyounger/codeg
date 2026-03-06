"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import ignore from "ignore"
import { Check, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { useFolderContext } from "@/contexts/folder-context"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useTabContext } from "@/contexts/tab-context"
import { useTerminalContext } from "@/contexts/terminal-context"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import {
  deleteFileTreeEntry,
  gitAddFiles,
  getGitBranch,
  getFileTree,
  gitListAllBranches,
  gitRollbackFile,
  gitStatus,
  readFileForEdit,
  readFilePreview,
  renameFileTreeEntry,
  saveFileCopy,
  startFileTreeWatch,
  stopFileTreeWatch,
} from "@/lib/tauri"
import { emitAttachFileToSession } from "@/lib/session-attachment-events"
import type {
  FileTreeChangedEvent,
  FileTreeNode,
  GitBranchList,
  GitStatusEntry,
} from "@/lib/types"
import {
  FileTree,
  FileTreeFolder,
  FileTreeFile,
} from "@/components/ai-elements/file-tree"
import { Button } from "@/components/ui/button"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"

function joinFsPath(basePath: string, relPath: string): string {
  if (!relPath) return basePath
  const separator = basePath.includes("\\") ? "\\" : "/"
  const normalizedRel = relPath.replace(/[\\/]/g, separator)
  if (basePath.endsWith("/") || basePath.endsWith("\\")) {
    return `${basePath}${normalizedRel}`
  }
  return `${basePath}${separator}${normalizedRel}`
}

function parentDir(filePath: string): string {
  const slashIndex = filePath.lastIndexOf("/")
  const backslashIndex = filePath.lastIndexOf("\\")
  const splitIndex = Math.max(slashIndex, backslashIndex)
  if (splitIndex < 0) return filePath
  if (splitIndex === 0) return filePath.slice(0, 1)
  return filePath.slice(0, splitIndex)
}

function baseName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

const FILE_TREE_ROOT_PATH = "__workspace_root__"
const GITIGNORE_MUTED_CLASS = "text-muted-foreground/55"

function getSystemExplorerLabel(): string {
  if (typeof navigator === "undefined") return "在文件管理器打开"
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  if (platform.includes("mac")) return "在访达打开"
  if (platform.includes("win")) return "在资源管理器打开"
  return "在文件管理器打开"
}

interface FileActionTarget {
  kind: "file" | "dir"
  path: string
  name: string
}

interface ExternalConflictPrompt {
  path: string
  diskContent: string
  unsavedContent: string
  signature: string
}

type GitFileState =
  | "untracked"
  | "modified"
  | "staged"
  | "conflicted"
  | "deleted"
  | "renamed"

function normalizeGitStatusPath(path: string): string {
  const normalized = path.trim()
  const renameSeparator = " -> "
  const renameIndex = normalized.lastIndexOf(renameSeparator)
  if (renameIndex < 0) return normalized
  return normalized.slice(renameIndex + renameSeparator.length).trim()
}

function normalizeComparePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "")
}

function isGitMetadataPath(path: string): boolean {
  const normalized = normalizeComparePath(path)
  return normalized === ".git" || normalized.startsWith(".git/")
}

function classifyGitFileState(status: string): GitFileState | null {
  const code = status.trim().toUpperCase()
  if (!code) return null
  if (code === "??") return "untracked"
  if (code.includes("U")) return "conflicted"
  if (code.includes("R") || code.includes("C")) return "renamed"
  if (code.includes("D")) return "deleted"
  if (code.includes("M") || code.includes("T")) return "modified"
  if (code.includes("A")) return "staged"
  return null
}

function getGitFileStateClassName(status?: string): string {
  if (!status) return ""
  const state = classifyGitFileState(status)
  if (state === "untracked") return "text-red-500 dark:text-red-400"
  if (state === "modified") return "text-emerald-600 dark:text-emerald-400"
  if (state === "staged") return "text-emerald-500 dark:text-emerald-400"
  if (state === "conflicted") return "text-amber-500 dark:text-amber-400"
  if (state === "deleted") return "text-orange-500 dark:text-orange-400"
  if (state === "renamed") return "text-violet-500 dark:text-violet-400"
  return ""
}

function getParentPath(path: string): string | null {
  const splitIdx = path.lastIndexOf("/")
  if (splitIdx < 0) return null
  return path.slice(0, splitIdx)
}

function hasIgnoredAncestor(path: string, ignoredPaths: ReadonlySet<string>) {
  let current = path
  while (true) {
    const parent = getParentPath(current)
    if (!parent) return false
    if (ignoredPaths.has(parent)) return true
    current = parent
  }
}

function getRelativePathDepth(path: string): number {
  if (!path) return 0
  return path.split("/").filter(Boolean).length
}

type DirectoryGitAction = "add" | "rollback"

interface DirectoryGitCandidateEntry {
  path: string
  status: string
}

type DirectoryGitTreeNode = DirectoryGitTreeDirNode | DirectoryGitTreeFileNode

interface DirectoryGitTreeDirNode {
  kind: "dir"
  name: string
  path: string
  children: DirectoryGitTreeNode[]
  fileCount: number
}

interface DirectoryGitTreeFileNode {
  kind: "file"
  name: string
  path: string
  status: string
}

interface MutableDirectoryGitTreeDirNode {
  kind: "dir"
  name: string
  path: string
  children: Map<
    string,
    MutableDirectoryGitTreeDirNode | DirectoryGitTreeFileNode
  >
}

const DIRECTORY_GIT_TREE_ROOT_PATH = "__directory_git_tree_root__"

function isPathInDirectory(path: string, directoryPath: string): boolean {
  const normalizedPath = normalizeComparePath(path)
  const normalizedDir = normalizeComparePath(directoryPath)
  if (!normalizedDir) return normalizedPath.length > 0
  return (
    normalizedPath === normalizedDir ||
    normalizedPath.startsWith(`${normalizedDir}/`)
  )
}

function scopeGitStatusEntriesForDirectory(
  entries: GitStatusEntry[],
  directoryPath: string
): DirectoryGitCandidateEntry[] {
  const normalizedDirPath = normalizeComparePath(directoryPath)
  const scopedEntries: DirectoryGitCandidateEntry[] = []
  const dedupByPath = new Set<string>()

  for (const entry of entries) {
    const normalizedPath = normalizeComparePath(
      normalizeGitStatusPath(entry.file)
    )
    if (!normalizedPath) continue
    if (!isPathInDirectory(normalizedPath, normalizedDirPath)) continue
    if (normalizedPath === normalizedDirPath) continue
    if (dedupByPath.has(normalizedPath)) continue
    dedupByPath.add(normalizedPath)
    scopedEntries.push({ path: normalizedPath, status: entry.status })
  }

  return scopedEntries.sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
  )
}

function filterDirectoryGitCandidates(
  entries: DirectoryGitCandidateEntry[],
  action: DirectoryGitAction
): DirectoryGitCandidateEntry[] {
  if (action === "add") {
    return entries.filter((entry) => entry.status.trim().length > 0)
  }

  return entries.filter((entry) => {
    const fileState = classifyGitFileState(entry.status)
    return fileState !== "untracked"
  })
}

function buildDirectoryGitTree(
  entries: DirectoryGitCandidateEntry[],
  directoryPath: string
): DirectoryGitTreeNode[] {
  const normalizedDirPath = normalizeComparePath(directoryPath)
  const root: MutableDirectoryGitTreeDirNode = {
    kind: "dir",
    name: "",
    path: "",
    children: new Map(),
  }

  for (const entry of entries) {
    let relativePath = normalizeComparePath(entry.path)
    if (normalizedDirPath && relativePath.startsWith(`${normalizedDirPath}/`)) {
      relativePath = relativePath.slice(normalizedDirPath.length + 1)
    }
    const segments = relativePath.split("/").filter(Boolean)
    if (segments.length === 0) continue

    let current = root
    for (const [index, segment] of segments.entries()) {
      const isLeaf = index === segments.length - 1
      const nestedPath = segments.slice(0, index + 1).join("/")
      const nodePath = normalizedDirPath
        ? `${normalizedDirPath}/${nestedPath}`
        : nestedPath

      if (isLeaf) {
        current.children.set(`file:${nodePath}`, {
          kind: "file",
          name: segment,
          path: nodePath,
          status: entry.status,
        })
        continue
      }

      const dirKey = `dir:${nodePath}`
      const existing = current.children.get(dirKey)
      if (existing && existing.kind === "dir") {
        current = existing
        continue
      }

      const nextDir: MutableDirectoryGitTreeDirNode = {
        kind: "dir",
        name: segment,
        path: nodePath,
        children: new Map(),
      }
      current.children.set(dirKey, nextDir)
      current = nextDir
    }
  }

  const toSortedTreeNodes = (
    dir: MutableDirectoryGitTreeDirNode
  ): DirectoryGitTreeNode[] => {
    return Array.from(dir.children.values())
      .map<DirectoryGitTreeNode>((node) => {
        if (node.kind === "file") return node
        return {
          kind: "dir" as const,
          name: node.name,
          path: node.path,
          children: toSortedTreeNodes(node),
          fileCount: 0,
        }
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1
        return left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
        })
      })
  }

  const annotateDirectory = (
    node: DirectoryGitTreeDirNode
  ): DirectoryGitTreeDirNode => {
    const nextChildren = node.children.map((child) => {
      if (child.kind === "file") return child
      return annotateDirectory(child)
    })
    const fileCount = nextChildren.reduce((count, child) => {
      if (child.kind === "file") return count + 1
      return count + child.fileCount
    }, 0)
    return {
      ...node,
      children: nextChildren,
      fileCount,
    }
  }

  return toSortedTreeNodes(root).map((node) => {
    if (node.kind === "file") return node
    return annotateDirectory(node)
  })
}

function collectDirectoryGitTreeExpandedPaths(
  nodes: DirectoryGitTreeNode[],
  expanded = new Set<string>()
): Set<string> {
  for (const node of nodes) {
    if (node.kind !== "dir") continue
    expanded.add(node.path)
    collectDirectoryGitTreeExpandedPaths(node.children, expanded)
  }
  return expanded
}

function collectDirectoryGitTreeLeafPaths(
  node: DirectoryGitTreeNode
): string[] {
  if (node.kind === "file") return [node.path]
  return node.children.flatMap(collectDirectoryGitTreeLeafPaths)
}

interface RenderNodeProps {
  node: FileTreeNode
  expandedPaths: ReadonlySet<string>
  workspacePath: string
  activeSessionTabId: string | null
  gitEnabled: boolean
  gitStatusByPath: ReadonlyMap<string, string>
  gitChangedDirPaths: ReadonlySet<string>
  gitignoreIgnoredPaths: ReadonlySet<string>
  ancestorGitignoreIgnored: boolean
  onOpenFilePreview: (path: string) => void
  onOpenFileDiff: (path: string) => void
  onOpenDirDiff: (path: string) => void
  onRequestCompareWithBranch: (target: FileActionTarget) => void
  onRequestRollback: (target: FileActionTarget) => void
  onOpenDirInTerminal: (dirPath: string, fileName: string) => Promise<void>
  onRequestAddToVcs: (target: FileActionTarget) => void
  onRequestRename: (target: FileActionTarget) => void
  onRequestDelete: (target: FileActionTarget) => void
  onRefresh: () => void
}

function RenderNode({
  node,
  expandedPaths,
  workspacePath,
  activeSessionTabId,
  gitEnabled,
  gitStatusByPath,
  gitChangedDirPaths,
  gitignoreIgnoredPaths,
  ancestorGitignoreIgnored,
  onOpenFilePreview,
  onOpenFileDiff,
  onOpenDirDiff,
  onRequestCompareWithBranch,
  onRequestRollback,
  onOpenDirInTerminal,
  onRequestAddToVcs,
  onRequestRename,
  onRequestDelete,
  onRefresh,
}: RenderNodeProps) {
  const isGitignoreIgnored =
    ancestorGitignoreIgnored || gitignoreIgnoredPaths.has(node.path)

  if (node.kind === "file") {
    const gitStatusCode = gitStatusByPath.get(node.path)
    const absolutePath = joinFsPath(workspacePath, node.path)
    const dirPath = parentDir(absolutePath)
    const systemExplorerLabel = getSystemExplorerLabel()
    const isGitMenuDisabled = !gitEnabled || isGitignoreIgnored

    const handleAttachToSession = () => {
      if (!activeSessionTabId) return
      emitAttachFileToSession({
        tabId: activeSessionTabId,
        path: absolutePath,
      })
    }

    const handleOpenInSystemExplorer = async () => {
      try {
        await revealItemInDir(absolutePath)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast.error("打开目录失败", { description: message })
      }
    }

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <FileTreeFile
            path={node.path}
            name={node.name}
            className={
              isGitignoreIgnored
                ? GITIGNORE_MUTED_CLASS
                : getGitFileStateClassName(gitStatusCode)
            }
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onOpenFilePreview(node.path)}>
            打开文件
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => void handleAttachToSession()}
            disabled={!activeSessionTabId}
          >
            附加到当前会话
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={isGitMenuDisabled}>
              Git
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                onSelect={() => onRequestAddToVcs(node)}
                disabled={
                  isGitMenuDisabled ||
                  classifyGitFileState(gitStatusCode ?? "") !== "untracked"
                }
              >
                添加到VCS
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => onOpenFileDiff(node.path)}
                disabled={isGitMenuDisabled}
              >
                查看差异
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => onRequestCompareWithBranch(node)}
                disabled={isGitMenuDisabled}
              >
                与分支比较...
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onSelect={() => onRequestRollback(node)}
                disabled={isGitMenuDisabled}
              >
                回滚
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => onRequestRename(node)}>
            重命名
          </ContextMenuItem>
          <ContextMenuItem onSelect={onRefresh}>从磁盘重新加载</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>打开于</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                onSelect={() => void handleOpenInSystemExplorer()}
              >
                {systemExplorerLabel}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => void onOpenDirInTerminal(dirPath, node.name)}
              >
                在终端打开
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem
            onSelect={() => onRequestDelete(node)}
            variant="destructive"
          >
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const absolutePath = joinFsPath(workspacePath, node.path)
  const systemExplorerLabel = getSystemExplorerLabel()
  const dirHasChanges = !isGitignoreIgnored && gitChangedDirPaths.has(node.path)
  const isGitMenuDisabled = !gitEnabled || isGitignoreIgnored
  const shouldRenderChildren = expandedPaths.has(node.path)

  const handleOpenDirInSystemExplorer = async () => {
    try {
      await revealItemInDir(absolutePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error("打开目录失败", { description: message })
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <FileTreeFolder
          path={node.path}
          name={node.name}
          nameClassName={
            isGitignoreIgnored
              ? GITIGNORE_MUTED_CLASS
              : dirHasChanges
                ? "text-emerald-600 dark:text-emerald-400"
                : undefined
          }
          iconClassName={isGitignoreIgnored ? GITIGNORE_MUTED_CLASS : undefined}
        >
          {shouldRenderChildren
            ? node.children.map((child) => (
                <RenderNode
                  key={child.path}
                  node={child}
                  expandedPaths={expandedPaths}
                  workspacePath={workspacePath}
                  activeSessionTabId={activeSessionTabId}
                  gitEnabled={gitEnabled}
                  gitStatusByPath={gitStatusByPath}
                  gitChangedDirPaths={gitChangedDirPaths}
                  gitignoreIgnoredPaths={gitignoreIgnoredPaths}
                  ancestorGitignoreIgnored={isGitignoreIgnored}
                  onOpenFilePreview={onOpenFilePreview}
                  onOpenFileDiff={onOpenFileDiff}
                  onOpenDirDiff={onOpenDirDiff}
                  onRequestCompareWithBranch={onRequestCompareWithBranch}
                  onRequestRollback={onRequestRollback}
                  onOpenDirInTerminal={onOpenDirInTerminal}
                  onRequestAddToVcs={onRequestAddToVcs}
                  onRequestRename={onRequestRename}
                  onRequestDelete={onRequestDelete}
                  onRefresh={onRefresh}
                />
              ))
            : null}
        </FileTreeFolder>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isGitMenuDisabled}>
            Git
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              onSelect={() => onRequestAddToVcs(node)}
              disabled={isGitMenuDisabled}
            >
              添加到VCS
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => onOpenDirDiff(node.path)}
              disabled={isGitMenuDisabled}
            >
              查看差异
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => onRequestCompareWithBranch(node)}
              disabled={isGitMenuDisabled}
            >
              与分支比较...
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              onSelect={() => onRequestRollback(node)}
              disabled={isGitMenuDisabled}
            >
              回滚
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={() => onRequestRename(node)}>
          重命名
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>打开于</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              onSelect={() => void handleOpenDirInSystemExplorer()}
            >
              {systemExplorerLabel}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void onOpenDirInTerminal(absolutePath, node.name)}
            >
              在终端打开
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={onRefresh}>从磁盘重新加载</ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onRequestDelete(node)}
          variant="destructive"
        >
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function FileTreeTab() {
  const { activeTab } = useAuxPanelContext()
  const { folder } = useFolderContext()
  const { tabs, activeTabId } = useTabContext()
  const { createTerminalInDirectory } = useTerminalContext()
  const {
    activeFileTab,
    activeFilePath,
    openBranchDiff,
    openExternalConflictDiff,
    openFilePreview,
    openWorkingTreeDiff,
  } = useWorkspaceContext()
  const [nodes, setNodes] = useState<FileTreeNode[]>([])
  const [gitStatusByPath, setGitStatusByPath] = useState<Map<string, string>>(
    new Map()
  )
  const [gitEnabled, setGitEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<FileActionTarget | null>(
    null
  )
  const [renameValue, setRenameValue] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FileActionTarget | null>(
    null
  )
  const [deleting, setDeleting] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<FileActionTarget | null>(
    null
  )
  const [rollingBack, setRollingBack] = useState(false)
  const [compareTarget, setCompareTarget] = useState<FileActionTarget | null>(
    null
  )
  const [externalConflictPrompt, setExternalConflictPrompt] =
    useState<ExternalConflictPrompt | null>(null)
  const [savingExternalConflictCopy, setSavingExternalConflictCopy] =
    useState(false)
  const [directoryGitActionType, setDirectoryGitActionType] =
    useState<DirectoryGitAction | null>(null)
  const [directoryGitActionTarget, setDirectoryGitActionTarget] =
    useState<FileActionTarget | null>(null)
  const [directoryGitCandidates, setDirectoryGitCandidates] = useState<
    DirectoryGitCandidateEntry[]
  >([])
  const [directoryGitSelectedPaths, setDirectoryGitSelectedPaths] = useState<
    Set<string>
  >(new Set())
  const [directoryGitExpandedPaths, setDirectoryGitExpandedPaths] = useState<
    Set<string>
  >(new Set([DIRECTORY_GIT_TREE_ROOT_PATH]))
  const [directoryGitLoading, setDirectoryGitLoading] = useState(false)
  const [directoryGitSubmitting, setDirectoryGitSubmitting] = useState(false)
  const [directoryGitError, setDirectoryGitError] = useState<string | null>(
    null
  )
  const [compareBranchFilter, setCompareBranchFilter] = useState("")
  const [compareCurrentBranch, setCompareCurrentBranch] = useState<
    string | null
  >(null)
  const [compareBranchList, setCompareBranchList] = useState<GitBranchList>({
    local: [],
    remote: [],
    worktree_branches: [],
  })
  const [compareBranchLoading, setCompareBranchLoading] = useState(false)
  const [compareRecentOpen, setCompareRecentOpen] = useState(true)
  const [compareLocalOpen, setCompareLocalOpen] = useState(false)
  const [compareRemoteOpen, setCompareRemoteOpen] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set([FILE_TREE_ROOT_PATH])
  )
  const [loadedTreeDepth, setLoadedTreeDepth] = useState(1)
  const [gitignoreIgnoredPaths, setGitignoreIgnoredPaths] = useState<
    Set<string>
  >(new Set())
  const isFileTreeTabActive = activeTab === "file_tree"
  const activeFileTabRef = useRef(activeFileTab)
  const filePathSetRef = useRef<Set<string>>(new Set())
  const loadedTreeDepthRef = useRef(1)
  const isFileTreeTabActiveRef = useRef(isFileTreeTabActive)
  const pendingTreeRefreshRef = useRef(false)
  const pendingTreeRefreshNeedsStatusRef = useRef(false)
  const pendingStatusRefreshRef = useRef(false)
  const treeRefreshNeedsStatusRef = useRef(false)
  const externalConflictSignatureByPathRef = useRef<Map<string, string>>(
    new Map()
  )
  const treeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  useEffect(() => {
    activeFileTabRef.current = activeFileTab
  }, [activeFileTab])

  useEffect(() => {
    setExpandedPaths(new Set([FILE_TREE_ROOT_PATH]))
    loadedTreeDepthRef.current = 1
    setLoadedTreeDepth(1)
    setGitignoreIgnoredPaths(new Set())
    setExternalConflictPrompt(null)
    setSavingExternalConflictCopy(false)
    externalConflictSignatureByPathRef.current.clear()
  }, [folder?.path])

  useEffect(() => {
    if (!activeFileTab || activeFileTab.kind !== "file") return
    if (!activeFileTab.path) return
    if (activeFileTab.loading || activeFileTab.isDirty) return
    const activeFilePath = activeFileTab.path
    externalConflictSignatureByPathRef.current.delete(activeFilePath)
    setExternalConflictPrompt((current) =>
      current &&
      normalizeComparePath(current.path) ===
        normalizeComparePath(activeFilePath)
        ? null
        : current
    )
  }, [activeFileTab])

  useEffect(() => {
    loadedTreeDepthRef.current = loadedTreeDepth
  }, [loadedTreeDepth])

  const activeSessionTabId = useMemo(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    if (!activeTab) return null
    if (
      activeTab.kind !== "conversation" &&
      activeTab.kind !== "new_conversation"
    ) {
      return null
    }
    return activeTab.id
  }, [tabs, activeTabId])

  const applyGitStatusResult = useCallback(
    (entries: { file: string; status: string }[]) => {
      const nextStatusByPath = new Map<string, string>()
      for (const entry of entries) {
        const normalizedPath = normalizeGitStatusPath(entry.file)
        if (!normalizedPath) continue
        nextStatusByPath.set(normalizedPath, entry.status)
      }
      setGitEnabled(true)
      setGitStatusByPath(nextStatusByPath)
    },
    []
  )

  const refreshGitStatus = useCallback(async () => {
    if (!folder?.path) {
      setGitStatusByPath(new Map())
      setGitEnabled(false)
      return
    }

    try {
      const result = await gitStatus(folder.path)
      applyGitStatusResult(result)
    } catch {
      setGitEnabled(false)
      setGitStatusByPath(new Map())
    }
  }, [applyGitStatusResult, folder?.path])

  const fetchTree = useCallback(
    async (options?: {
      skipTree?: boolean
      skipStatus?: boolean
      silent?: boolean
      maxDepth?: number
    }) => {
      if (!folder?.path) {
        setNodes([])
        loadedTreeDepthRef.current = 1
        setLoadedTreeDepth(1)
        setGitStatusByPath(new Map())
        setGitEnabled(false)
        setLoading(false)
        return
      }

      const skipTree = options?.skipTree ?? false
      const skipStatus = options?.skipStatus ?? false
      const silent = options?.silent ?? false
      const maxDepth = options?.maxDepth ?? loadedTreeDepthRef.current

      if (!silent) setLoading(true)
      setError(null)
      let loadingReleased = false

      try {
        if (skipTree) {
          if (!skipStatus) {
            await refreshGitStatus()
          }
          return
        }

        if (skipStatus) {
          const treeResult = await getFileTree(folder.path, maxDepth)
          setNodes(treeResult)
          setLoadedTreeDepth((prev) => {
            const next = Math.max(prev, maxDepth)
            loadedTreeDepthRef.current = next
            return next
          })
          return
        }

        const treePromise = getFileTree(folder.path, maxDepth)
        const gitStatusPromise = gitStatus(folder.path)
        const treeResult = await treePromise
        setNodes(treeResult)
        setLoadedTreeDepth((prev) => {
          const next = Math.max(prev, maxDepth)
          loadedTreeDepthRef.current = next
          return next
        })

        // Show file tree as soon as it's ready; git status can follow.
        if (!silent) {
          setLoading(false)
          loadingReleased = true
        }

        try {
          const gitStatusResult = await gitStatusPromise
          applyGitStatusResult(gitStatusResult)
        } catch {
          setGitEnabled(false)
          setGitStatusByPath(new Map())
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!silent && !loadingReleased) setLoading(false)
      }
    },
    [applyGitStatusResult, folder?.path, refreshGitStatus]
  )

  useEffect(() => {
    isFileTreeTabActiveRef.current = isFileTreeTabActive
    if (!isFileTreeTabActive) return

    if (pendingTreeRefreshRef.current) {
      const needsStatus =
        pendingTreeRefreshNeedsStatusRef.current ||
        pendingStatusRefreshRef.current
      pendingTreeRefreshRef.current = false
      pendingTreeRefreshNeedsStatusRef.current = false
      pendingStatusRefreshRef.current = false
      void fetchTree({ silent: true, skipStatus: !needsStatus })
      return
    }

    if (pendingStatusRefreshRef.current) {
      pendingStatusRefreshRef.current = false
      void fetchTree({ skipTree: true, silent: true })
    }
  }, [fetchTree, isFileTreeTabActive])

  useEffect(() => {
    pendingTreeRefreshRef.current = false
    pendingTreeRefreshNeedsStatusRef.current = false
    pendingStatusRefreshRef.current = false
    treeRefreshNeedsStatusRef.current = false
  }, [folder?.path])

  const filePathSet = useMemo(() => {
    const paths = new Set<string>()
    const collect = (items: FileTreeNode[]) => {
      for (const item of items) {
        if (item.kind === "file") {
          paths.add(item.path)
        } else {
          collect(item.children)
        }
      }
    }
    collect(nodes)
    return paths
  }, [nodes])

  const dirChildrenByPath = useMemo(() => {
    const next = new Map<string, FileTreeNode[]>()
    next.set("", nodes)

    const collect = (items: FileTreeNode[]) => {
      for (const item of items) {
        if (item.kind !== "dir") continue
        next.set(item.path, item.children)
        collect(item.children)
      }
    }

    collect(nodes)
    return next
  }, [nodes])

  const expandedDirPaths = useMemo(() => {
    const dirs = new Set<string>([""])
    for (const path of expandedPaths) {
      if (path === FILE_TREE_ROOT_PATH) continue
      dirs.add(path)
    }
    return Array.from(dirs)
  }, [expandedPaths])

  const desiredTreeDepth = useMemo(() => {
    let nextDepth = 1
    for (const path of expandedPaths) {
      if (path === FILE_TREE_ROOT_PATH) continue
      nextDepth = Math.max(nextDepth, getRelativePathDepth(path) + 1)
    }
    return nextDepth
  }, [expandedPaths])

  useEffect(() => {
    filePathSetRef.current = filePathSet
  }, [filePathSet])

  useEffect(() => {
    if (!folder?.path) {
      setGitignoreIgnoredPaths(new Set())
      return
    }

    let canceled = false

    const loadIgnoredPaths = async () => {
      const nextIgnoredPaths = new Set<string>()
      const sortedDirs = [...expandedDirPaths].sort(
        (left, right) => left.length - right.length
      )

      for (const dirPath of sortedDirs) {
        if (hasIgnoredAncestor(dirPath, nextIgnoredPaths)) continue

        const children = dirChildrenByPath.get(dirPath)
        if (!children || children.length === 0) continue

        const gitignoreNode = children.find(
          (child) => child.kind === "file" && child.name === ".gitignore"
        )
        if (!gitignoreNode || gitignoreNode.kind !== "file") continue

        try {
          const result = await readFilePreview(folder.path, gitignoreNode.path)
          const matcher = ignore().add(result.content)

          for (const child of children) {
            const ignored =
              child.kind === "dir"
                ? matcher.ignores(`${child.name}/`) ||
                  matcher.ignores(`${child.name}/.codeg-ignore-probe`)
                : matcher.ignores(child.name)
            if (ignored) {
              nextIgnoredPaths.add(child.path)
            }
          }
        } catch {
          // Ignore parser/read failures for non-critical visual hints.
        }
      }

      if (!canceled) {
        setGitignoreIgnoredPaths(nextIgnoredPaths)
      }
    }

    void loadIgnoredPaths()

    return () => {
      canceled = true
    }
  }, [dirChildrenByPath, expandedDirPaths, folder?.path])

  const gitChangedDirPaths = useMemo(() => {
    const dirs = new Set<string>()
    for (const filePath of gitStatusByPath.keys()) {
      let current = filePath
      // Walk up the path collecting all parent directories
      while (true) {
        const slashIdx = current.lastIndexOf("/")
        const backslashIdx = current.lastIndexOf("\\")
        const splitIdx = Math.max(slashIdx, backslashIdx)
        if (splitIdx <= 0) break
        current = current.slice(0, splitIdx)
        dirs.add(current)
      }
    }
    return dirs
  }, [gitStatusByPath])

  const handleTreeSelect = useCallback(
    (path: string) => {
      if (!filePathSet.has(path)) return
      void openFilePreview(path)
    },
    [filePathSet, openFilePreview]
  )

  const handleOpenDirInTerminal = useCallback(
    async (dirPath: string, fileName: string) => {
      const terminalTitle = `Terminal · ${baseName(fileName)}`
      const terminalId = await createTerminalInDirectory(dirPath, terminalTitle)
      if (!terminalId) {
        toast.error("无法打开内置终端")
      }
    },
    [createTerminalInDirectory]
  )

  const handleRequestRename = useCallback((target: FileActionTarget) => {
    setRenameTarget(target)
    setRenameValue(target.name)
  }, [])

  const handleRequestDelete = useCallback((target: FileActionTarget) => {
    setDeleteTarget(target)
  }, [])

  const resetDirectoryGitActionDialog = useCallback(() => {
    setDirectoryGitActionType(null)
    setDirectoryGitActionTarget(null)
    setDirectoryGitCandidates([])
    setDirectoryGitSelectedPaths(new Set())
    setDirectoryGitExpandedPaths(new Set([DIRECTORY_GIT_TREE_ROOT_PATH]))
    setDirectoryGitError(null)
    setDirectoryGitLoading(false)
    setDirectoryGitSubmitting(false)
  }, [])

  const openDirectoryGitActionDialog = useCallback(
    async (action: DirectoryGitAction, target: FileActionTarget) => {
      if (!folder?.path) return
      setDirectoryGitActionType(action)
      setDirectoryGitActionTarget(target)
      setDirectoryGitCandidates([])
      setDirectoryGitSelectedPaths(new Set())
      setDirectoryGitExpandedPaths(new Set([DIRECTORY_GIT_TREE_ROOT_PATH]))
      setDirectoryGitError(null)
      setDirectoryGitLoading(true)

      try {
        const statusEntries = await gitStatus(folder.path)
        const scopedEntries = scopeGitStatusEntriesForDirectory(
          statusEntries,
          target.path
        )
        const candidates = filterDirectoryGitCandidates(scopedEntries, action)
        if (candidates.length === 0) {
          resetDirectoryGitActionDialog()
          toast.info(
            action === "add"
              ? "该目录下没有可添加到VCS的变更文件"
              : "该目录下没有可回滚的变更文件"
          )
          return
        }

        const treeNodes = buildDirectoryGitTree(candidates, target.path)
        const expanded = collectDirectoryGitTreeExpandedPaths(treeNodes)
        expanded.add(DIRECTORY_GIT_TREE_ROOT_PATH)

        setDirectoryGitCandidates(candidates)
        setDirectoryGitSelectedPaths(
          new Set(candidates.map((entry) => entry.path))
        )
        setDirectoryGitExpandedPaths(expanded)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setDirectoryGitError(message)
      } finally {
        setDirectoryGitLoading(false)
      }
    },
    [folder?.path, resetDirectoryGitActionDialog]
  )

  const handleRequestRollback = useCallback(
    (target: FileActionTarget) => {
      if (target.kind === "dir") {
        void openDirectoryGitActionDialog("rollback", target)
        return
      }
      setRollbackTarget(target)
    },
    [openDirectoryGitActionDialog]
  )

  const handleAddToVcs = useCallback(
    async (target: FileActionTarget) => {
      if (target.kind === "dir") {
        await openDirectoryGitActionDialog("add", target)
        return
      }
      if (!folder?.path) return
      try {
        await gitAddFiles(folder.path, [target.path])
        toast.success(`已添加 ${target.name} 到VCS`)
        await fetchTree()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast.error("添加到VCS失败", { description: message })
      }
    },
    [fetchTree, folder?.path, openDirectoryGitActionDialog]
  )

  const loadCompareBranches = useCallback(async () => {
    if (!folder?.path) {
      setCompareBranchList({ local: [], remote: [], worktree_branches: [] })
      setCompareCurrentBranch(null)
      return
    }
    setCompareBranchLoading(true)
    try {
      const [branchesResult, currentBranchResult] = await Promise.allSettled([
        gitListAllBranches(folder.path),
        getGitBranch(folder.path),
      ])

      if (branchesResult.status === "fulfilled") {
        setCompareBranchList(branchesResult.value)
      } else {
        setCompareBranchList({ local: [], remote: [], worktree_branches: [] })
        const message =
          branchesResult.reason instanceof Error
            ? branchesResult.reason.message
            : String(branchesResult.reason)
        toast.error("加载分支失败", { description: message })
      }

      if (currentBranchResult.status === "fulfilled") {
        setCompareCurrentBranch(currentBranchResult.value)
      } else {
        setCompareCurrentBranch(null)
      }
    } catch (error) {
      setCompareBranchList({ local: [], remote: [], worktree_branches: [] })
      setCompareCurrentBranch(null)
      const message = error instanceof Error ? error.message : String(error)
      toast.error("加载分支失败", { description: message })
    } finally {
      setCompareBranchLoading(false)
    }
  }, [folder?.path])

  const handleRequestCompareWithBranch = useCallback(
    (target: FileActionTarget) => {
      setCompareTarget(target)
      setCompareBranchFilter("")
      setCompareRecentOpen(true)
      setCompareLocalOpen(false)
      setCompareRemoteOpen(false)
      void loadCompareBranches()
    },
    [loadCompareBranches]
  )

  const compareFilterKeyword = useMemo(
    () => compareBranchFilter.trim().toLowerCase(),
    [compareBranchFilter]
  )

  const filteredCompareRecentBranches = useMemo(() => {
    if (!compareCurrentBranch) return []
    if (!compareFilterKeyword) return [compareCurrentBranch]
    return compareCurrentBranch.toLowerCase().includes(compareFilterKeyword)
      ? [compareCurrentBranch]
      : []
  }, [compareCurrentBranch, compareFilterKeyword])

  const filteredCompareBranches = useMemo(() => {
    if (!compareFilterKeyword) {
      return compareBranchList
    }

    return {
      local: compareBranchList.local.filter((branch) =>
        branch.toLowerCase().includes(compareFilterKeyword)
      ),
      remote: compareBranchList.remote.filter((branch) =>
        branch.toLowerCase().includes(compareFilterKeyword)
      ),
    }
  }, [compareBranchList, compareFilterKeyword])

  const directoryGitTreeNodes = useMemo(() => {
    if (!directoryGitActionTarget) return []
    return buildDirectoryGitTree(
      directoryGitCandidates,
      directoryGitActionTarget.path
    )
  }, [directoryGitActionTarget, directoryGitCandidates])

  const directoryGitAllFilePaths = useMemo(
    () => directoryGitCandidates.map((entry) => entry.path),
    [directoryGitCandidates]
  )

  const directoryGitAllSelected = useMemo(
    () =>
      directoryGitAllFilePaths.length > 0 &&
      directoryGitAllFilePaths.every((path) =>
        directoryGitSelectedPaths.has(path)
      ),
    [directoryGitAllFilePaths, directoryGitSelectedPaths]
  )

  const directoryGitFilePathSet = useMemo(
    () => new Set(directoryGitAllFilePaths),
    [directoryGitAllFilePaths]
  )

  const directoryGitLeafPathsByDirPath = useMemo(() => {
    const next = new Map<string, string[]>()
    const collect = (node: DirectoryGitTreeNode) => {
      if (node.kind === "file") return
      next.set(node.path, collectDirectoryGitTreeLeafPaths(node))
      for (const child of node.children) {
        if (child.kind === "dir") collect(child)
      }
    }
    for (const node of directoryGitTreeNodes) {
      if (node.kind === "dir") collect(node)
    }
    return next
  }, [directoryGitTreeNodes])

  const handleToggleDirectoryGitFile = useCallback((path: string) => {
    setDirectoryGitSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleToggleDirectoryGitSelectAll = useCallback(() => {
    setDirectoryGitSelectedPaths((prev) => {
      if (
        directoryGitAllFilePaths.length > 0 &&
        directoryGitAllFilePaths.every((path) => prev.has(path))
      ) {
        return new Set<string>()
      }
      return new Set(directoryGitAllFilePaths)
    })
  }, [directoryGitAllFilePaths])

  const handleToggleDirectoryGitDir = useCallback(
    (dirPath: string) => {
      const leafPaths = directoryGitLeafPathsByDirPath.get(dirPath) ?? []
      if (leafPaths.length === 0) return
      setDirectoryGitSelectedPaths((prev) => {
        const next = new Set(prev)
        const allSelected = leafPaths.every((path) => next.has(path))
        if (allSelected) {
          for (const path of leafPaths) next.delete(path)
        } else {
          for (const path of leafPaths) next.add(path)
        }
        return next
      })
    },
    [directoryGitLeafPathsByDirPath]
  )

  const handleDirectoryGitTreeSelect = useCallback(
    (path: string) => {
      if (path === DIRECTORY_GIT_TREE_ROOT_PATH) {
        handleToggleDirectoryGitSelectAll()
        return
      }

      if (directoryGitLeafPathsByDirPath.has(path)) {
        handleToggleDirectoryGitDir(path)
        return
      }

      if (directoryGitFilePathSet.has(path)) {
        handleToggleDirectoryGitFile(path)
      }
    },
    [
      directoryGitFilePathSet,
      directoryGitLeafPathsByDirPath,
      handleToggleDirectoryGitDir,
      handleToggleDirectoryGitFile,
      handleToggleDirectoryGitSelectAll,
    ]
  )

  const renderDirectoryGitTreeNode = useCallback(
    (node: DirectoryGitTreeNode): ReactNode => {
      if (node.kind === "dir") {
        const leafPaths = directoryGitLeafPathsByDirPath.get(node.path) ?? []
        const allSelected =
          leafPaths.length > 0 &&
          leafPaths.every((path) => directoryGitSelectedPaths.has(path))
        const partiallySelected =
          !allSelected &&
          leafPaths.some((path) => directoryGitSelectedPaths.has(path))
        return (
          <FileTreeFolder
            key={node.path}
            path={node.path}
            name={`${allSelected ? "[x]" : partiallySelected ? "[-]" : "[ ]"} ${node.name}`}
            suffix={`(${node.fileCount})`}
            suffixClassName="text-muted-foreground/45"
            title={node.path}
          >
            {node.children.map(renderDirectoryGitTreeNode)}
          </FileTreeFolder>
        )
      }

      const selected = directoryGitSelectedPaths.has(node.path)
      return (
        <FileTreeFile
          key={node.path}
          path={node.path}
          name={node.name}
          className="gap-1 px-1.5 py-1"
          title={node.path}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              handleToggleDirectoryGitFile(node.path)
            }}
            className={
              selected
                ? "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary bg-primary text-primary-foreground transition-colors"
                : "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input transition-colors"
            }
            aria-label={`${selected ? "取消选择" : "选择"} ${node.path}`}
            disabled={directoryGitSubmitting}
          >
            {selected && <Check className="h-3 w-3" />}
          </button>
          <button
            type="button"
            className="flex-1 truncate text-left"
            onClick={(event) => {
              event.stopPropagation()
              handleToggleDirectoryGitFile(node.path)
            }}
            title={node.path}
            disabled={directoryGitSubmitting}
          >
            {node.name}
          </button>
          <span className="w-8 shrink-0 text-right text-[10px] font-medium text-muted-foreground">
            {node.status}
          </span>
        </FileTreeFile>
      )
    },
    [
      directoryGitLeafPathsByDirPath,
      directoryGitSelectedPaths,
      directoryGitSubmitting,
      handleToggleDirectoryGitFile,
    ]
  )

  const handleRenameConfirm = useCallback(async () => {
    if (!folder?.path || !renameTarget) return
    const nextName = renameValue.trim()
    if (!nextName || nextName === renameTarget.name) {
      setRenameTarget(null)
      return
    }

    setRenaming(true)
    try {
      await renameFileTreeEntry(folder.path, renameTarget.path, nextName)
      setRenameTarget(null)
      setRenameValue("")
      await fetchTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error("重命名失败", { description: message })
    } finally {
      setRenaming(false)
    }
  }, [fetchTree, folder?.path, renameTarget, renameValue])

  const handleDeleteConfirm = useCallback(async () => {
    if (!folder?.path || !deleteTarget) return
    setDeleting(true)
    try {
      await deleteFileTreeEntry(folder.path, deleteTarget.path)
      setDeleteTarget(null)
      await fetchTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error("删除失败", { description: message })
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, fetchTree, folder?.path])

  const handleRollbackConfirm = useCallback(async () => {
    if (!folder?.path || !rollbackTarget) return
    setRollingBack(true)
    try {
      await gitRollbackFile(folder.path, rollbackTarget.path)
      toast.success(`已回滚 ${rollbackTarget.name}`)
      setRollbackTarget(null)
      await fetchTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error("回滚失败", { description: message })
    } finally {
      setRollingBack(false)
    }
  }, [fetchTree, folder?.path, rollbackTarget])

  const handleDirectoryGitActionConfirm = useCallback(async () => {
    if (!folder?.path || !directoryGitActionType) return
    if (directoryGitSelectedPaths.size === 0) return

    const selectedPaths = Array.from(directoryGitSelectedPaths)
    setDirectoryGitSubmitting(true)
    setDirectoryGitError(null)

    try {
      if (directoryGitActionType === "add") {
        await gitAddFiles(folder.path, selectedPaths)
        toast.success(`已添加 ${selectedPaths.length} 个文件到VCS`)
      } else {
        for (const filePath of selectedPaths) {
          await gitRollbackFile(folder.path, filePath)
        }
        toast.success(`已回滚 ${selectedPaths.length} 个文件`)
      }

      resetDirectoryGitActionDialog()
      await fetchTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDirectoryGitError(message)
      toast.error(
        directoryGitActionType === "add" ? "添加到VCS失败" : "回滚失败",
        {
          description: message,
        }
      )
    } finally {
      setDirectoryGitSubmitting(false)
    }
  }, [
    directoryGitActionType,
    directoryGitSelectedPaths,
    fetchTree,
    folder?.path,
    resetDirectoryGitActionDialog,
  ])

  const handleCompareBranchClick = useCallback(
    async (branch: string) => {
      const nextBranch = branch.trim()
      if (!compareTarget || !nextBranch || comparing) return
      setComparing(true)
      try {
        if (compareTarget.kind === "dir") {
          await openBranchDiff(nextBranch, compareTarget.path, {
            mode: "overview",
          })
        } else {
          await openBranchDiff(nextBranch, compareTarget.path)
        }
        setCompareTarget(null)
        setCompareBranchFilter("")
        setCompareCurrentBranch(null)
      } finally {
        setComparing(false)
      }
    },
    [compareTarget, comparing, openBranchDiff]
  )

  const handleCompareExternalConflict = useCallback(() => {
    if (!externalConflictPrompt) return

    const latestTab = activeFileTabRef.current
    const unsavedContent =
      latestTab &&
      latestTab.kind === "file" &&
      latestTab.path &&
      normalizeComparePath(latestTab.path) ===
        normalizeComparePath(externalConflictPrompt.path) &&
      !latestTab.loading
        ? latestTab.content
        : externalConflictPrompt.unsavedContent

    openExternalConflictDiff(
      externalConflictPrompt.path,
      externalConflictPrompt.diskContent,
      unsavedContent
    )
    setExternalConflictPrompt(null)
  }, [externalConflictPrompt, openExternalConflictDiff])

  const handleReloadExternalConflict = useCallback(() => {
    if (!externalConflictPrompt) return
    externalConflictSignatureByPathRef.current.delete(
      externalConflictPrompt.path
    )
    setExternalConflictPrompt(null)
    void openFilePreview(externalConflictPrompt.path)
  }, [externalConflictPrompt, openFilePreview])

  const handleSaveExternalConflictCopy = useCallback(async () => {
    if (!folder?.path || !externalConflictPrompt) return

    const latestTab = activeFileTabRef.current
    const unsavedContent =
      latestTab &&
      latestTab.kind === "file" &&
      latestTab.path &&
      normalizeComparePath(latestTab.path) ===
        normalizeComparePath(externalConflictPrompt.path) &&
      !latestTab.loading
        ? latestTab.content
        : externalConflictPrompt.unsavedContent

    setSavingExternalConflictCopy(true)
    try {
      const result = await saveFileCopy(
        folder.path,
        externalConflictPrompt.path,
        unsavedContent
      )
      toast.success("已另存为副本", {
        description: result.path,
      })
      setExternalConflictPrompt(null)
      void fetchTree({ silent: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error("另存为副本失败", { description: message })
    } finally {
      setSavingExternalConflictCopy(false)
    }
  }, [externalConflictPrompt, fetchTree, folder?.path])

  const rootNodeName = useMemo(() => {
    if (!folder?.path) return "Workspace"
    return baseName(folder.path)
  }, [folder?.path])

  useEffect(() => {
    if (!isFileTreeTabActive) return
    void fetchTree()
  }, [fetchTree, isFileTreeTabActive])

  useEffect(() => {
    if (!isFileTreeTabActive || !folder?.path) return
    if (desiredTreeDepth <= loadedTreeDepth) return
    void fetchTree({ silent: true, maxDepth: desiredTreeDepth })
  }, [
    desiredTreeDepth,
    fetchTree,
    folder?.path,
    isFileTreeTabActive,
    loadedTreeDepth,
  ])

  useEffect(() => {
    const rootPath = folder?.path
    if (!rootPath) return

    let unlisten: UnlistenFn | null = null
    const normalizedRootPath = normalizeComparePath(rootPath)

    const scheduleTreeRefresh = (refreshGitStatus: boolean) => {
      if (!isFileTreeTabActiveRef.current) {
        pendingTreeRefreshRef.current = true
        pendingTreeRefreshNeedsStatusRef.current =
          pendingTreeRefreshNeedsStatusRef.current || refreshGitStatus
        if (refreshGitStatus) {
          pendingStatusRefreshRef.current = false
        }
        return
      }
      treeRefreshNeedsStatusRef.current =
        treeRefreshNeedsStatusRef.current || refreshGitStatus
      if (treeRefreshTimerRef.current) {
        clearTimeout(treeRefreshTimerRef.current)
      }
      treeRefreshTimerRef.current = setTimeout(() => {
        const needsStatus = treeRefreshNeedsStatusRef.current
        treeRefreshNeedsStatusRef.current = false
        void fetchTree({ silent: true, skipStatus: !needsStatus })
      }, 180)
    }

    const scheduleStatusRefresh = () => {
      if (!isFileTreeTabActiveRef.current) {
        if (pendingTreeRefreshRef.current) {
          pendingTreeRefreshNeedsStatusRef.current = true
        } else {
          pendingStatusRefreshRef.current = true
        }
        return
      }
      if (statusRefreshTimerRef.current) {
        clearTimeout(statusRefreshTimerRef.current)
      }
      statusRefreshTimerRef.current = setTimeout(() => {
        void fetchTree({ skipTree: true, silent: true })
      }, 120)
    }

    const getActiveChangedFilePath = (
      changedPaths: string[],
      fullReload: boolean
    ) => {
      if (fullReload) return null
      const currentTab = activeFileTabRef.current
      if (!currentTab || currentTab.kind !== "file") return null
      if (!currentTab.path || currentTab.loading) return null

      const normalizedActivePath = normalizeComparePath(currentTab.path)
      const activePathChanged = changedPaths.some(
        (changedPath) =>
          normalizeComparePath(changedPath) === normalizedActivePath
      )
      if (!activePathChanged) return null

      return currentTab.path
    }

    type ActiveFileChangeDecision =
      | { kind: "none" }
      | { kind: "reload"; path: string }
      | {
          kind: "conflict"
          path: string
          diskContent: string
          unsavedContent: string
          signature: string
        }

    const resolveActiveFileChangeDecision = async (
      path: string
    ): Promise<ActiveFileChangeDecision> => {
      const currentTab = activeFileTabRef.current
      if (!currentTab || currentTab.kind !== "file") return { kind: "none" }
      if (
        normalizeComparePath(currentTab.path ?? "") !==
        normalizeComparePath(path)
      ) {
        return { kind: "none" }
      }
      if (currentTab.loading) return { kind: "none" }

      const knownTabEtag = currentTab.etag ?? null

      try {
        const latest = await readFileForEdit(rootPath, path)
        const latestTab = activeFileTabRef.current
        if (!latestTab || latestTab.kind !== "file") return { kind: "none" }
        if (
          normalizeComparePath(latestTab.path ?? "") !==
          normalizeComparePath(path)
        ) {
          return { kind: "none" }
        }
        if (latestTab.loading) return { kind: "none" }

        const latestTabEtag = latestTab.etag ?? null
        if (latest.etag === latestTabEtag) return { kind: "none" }

        if (latestTab.isDirty) {
          return {
            kind: "conflict",
            path,
            diskContent: latest.content,
            unsavedContent: latestTab.content,
            signature: `${path}:${latest.etag}`,
          }
        }

        return { kind: "reload", path }
      } catch {
        const latestTab = activeFileTabRef.current
        if (!latestTab || latestTab.kind !== "file") return { kind: "none" }
        if (
          normalizeComparePath(latestTab.path ?? "") !==
          normalizeComparePath(path)
        ) {
          return { kind: "none" }
        }
        if (latestTab.loading) return { kind: "none" }
        if (latestTab.isDirty) return { kind: "none" }
        if (!knownTabEtag) return { kind: "reload", path }
        // Fallback: if probe fails but tab is clean, reload to reflect latest disk state.
        return { kind: "reload", path }
      }
    }

    const setup = async () => {
      try {
        await startFileTreeWatch(rootPath)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast.error("文件监听启动失败", { description: message })
      }

      try {
        unlisten = await listen<FileTreeChangedEvent>(
          "folder://file-tree-changed",
          (event) => {
            if (
              normalizeComparePath(event.payload.root_path) !==
              normalizedRootPath
            ) {
              return
            }

            const changedPaths =
              event.payload.changed_paths.map(normalizeComparePath)
            const shouldRefreshGitStatus =
              event.payload.refresh_git_status ?? true
            const nonGitChangedPaths = changedPaths.filter(
              (path) => !isGitMetadataPath(path)
            )
            const onlyGitMetadataChanges =
              changedPaths.length > 0 && nonGitChangedPaths.length === 0
            const hasUnknownPath = nonGitChangedPaths.some(
              (path) => !filePathSetRef.current.has(path)
            )
            const needsTreeRefresh =
              event.payload.full_reload ||
              (!onlyGitMetadataChanges &&
                (event.payload.kind !== "modify" ||
                  nonGitChangedPaths.length === 0 ||
                  hasUnknownPath))

            if (onlyGitMetadataChanges && !event.payload.full_reload) {
              if (shouldRefreshGitStatus) {
                scheduleStatusRefresh()
              }
            } else if (needsTreeRefresh) {
              scheduleTreeRefresh(shouldRefreshGitStatus)
            } else if (shouldRefreshGitStatus) {
              scheduleStatusRefresh()
            }

            if (onlyGitMetadataChanges && !event.payload.full_reload) {
              return
            }

            const changedActivePath = getActiveChangedFilePath(
              nonGitChangedPaths,
              event.payload.full_reload
            )
            if (!changedActivePath) return

            void (async () => {
              const decision =
                await resolveActiveFileChangeDecision(changedActivePath)
              if (decision.kind === "none") return

              if (decision.kind === "reload") {
                externalConflictSignatureByPathRef.current.delete(decision.path)
                void openFilePreview(decision.path)
                return
              }

              const shownSignature =
                externalConflictSignatureByPathRef.current.get(decision.path)
              if (shownSignature === decision.signature) return
              externalConflictSignatureByPathRef.current.set(
                decision.path,
                decision.signature
              )
              setExternalConflictPrompt((current) => {
                if (current?.signature === decision.signature) return current
                return {
                  path: decision.path,
                  diskContent: decision.diskContent,
                  unsavedContent: decision.unsavedContent,
                  signature: decision.signature,
                }
              })
            })()
          }
        )
      } catch (error) {
        console.error("[FileTreeTab] failed to listen file watch event:", error)
      }
    }

    void setup()

    return () => {
      if (treeRefreshTimerRef.current) {
        clearTimeout(treeRefreshTimerRef.current)
        treeRefreshTimerRef.current = null
      }
      treeRefreshNeedsStatusRef.current = false
      if (statusRefreshTimerRef.current) {
        clearTimeout(statusRefreshTimerRef.current)
        statusRefreshTimerRef.current = null
      }
      pendingTreeRefreshRef.current = false
      pendingTreeRefreshNeedsStatusRef.current = false
      pendingStatusRefreshRef.current = false
      if (unlisten) {
        unlisten()
      }
      void stopFileTreeWatch(rootPath)
    }
  }, [fetchTree, folder?.path, openFilePreview])

  if (loading && nodes.length === 0) {
    return (
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2 ml-4" />
        <Skeleton className="h-4 w-2/3 ml-4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4 ml-4" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-destructive">
        <p>{error}</p>
        <Button
          variant="ghost"
          size="xs"
          className="mt-2"
          onClick={() => {
            void fetchTree()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex-1 min-h-0 overflow-auto pb-1 [scrollbar-gutter:stable] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
            <FileTree
              key={folder?.path ?? "file-tree-empty"}
              className="border-0 rounded-none bg-transparent w-max min-w-full"
              expanded={expandedPaths}
              onExpandedChange={setExpandedPaths}
              selectedPath={activeFilePath ?? undefined}
              onSelect={handleTreeSelect}
            >
              {folder?.path && (
                <FileTreeFolder
                  path={FILE_TREE_ROOT_PATH}
                  name={rootNodeName}
                  className="font-medium"
                >
                  {nodes.map((node) => (
                    <RenderNode
                      key={node.path}
                      node={node}
                      expandedPaths={expandedPaths}
                      workspacePath={folder.path}
                      activeSessionTabId={activeSessionTabId}
                      gitEnabled={gitEnabled}
                      gitStatusByPath={gitStatusByPath}
                      gitChangedDirPaths={gitChangedDirPaths}
                      gitignoreIgnoredPaths={gitignoreIgnoredPaths}
                      ancestorGitignoreIgnored={false}
                      onOpenFilePreview={(path) => {
                        void openFilePreview(path)
                      }}
                      onOpenFileDiff={(path) => {
                        void openWorkingTreeDiff(path)
                      }}
                      onOpenDirDiff={(path) => {
                        void openWorkingTreeDiff(path, { mode: "overview" })
                      }}
                      onRequestCompareWithBranch={
                        handleRequestCompareWithBranch
                      }
                      onRequestRollback={handleRequestRollback}
                      onOpenDirInTerminal={handleOpenDirInTerminal}
                      onRequestAddToVcs={handleAddToVcs}
                      onRequestRename={handleRequestRename}
                      onRequestDelete={handleRequestDelete}
                      onRefresh={fetchTree}
                    />
                  ))}
                </FileTreeFolder>
              )}
            </FileTree>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              void fetchTree()
            }}
          >
            从磁盘重新加载
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (open) return
          setRenameTarget(null)
          setRenameValue("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.kind === "dir" ? "重命名目录" : "重命名文件"}
            </DialogTitle>
            <DialogDescription>
              输入新的名称（仅名称，不含路径）。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleRenameConfirm()
            }}
            className="space-y-4"
          >
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              autoFocus
              disabled={renaming}
              placeholder={
                renameTarget?.kind === "dir"
                  ? "new-folder-name"
                  : "new-file-name.ext"
              }
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={renaming}
                onClick={() => {
                  setRenameTarget(null)
                  setRenameValue("")
                }}
              >
                取消
              </Button>
              <Button type="submit" disabled={renaming}>
                确认
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(directoryGitActionType && directoryGitActionTarget)}
        onOpenChange={(open) => {
          if (open) return
          resetDirectoryGitActionDialog()
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {directoryGitActionType === "add" ? "添加到VCS" : "回滚"}
            </DialogTitle>
            <DialogDescription>
              {directoryGitActionTarget
                ? `选择目录 ${directoryGitActionTarget.path} 下要${directoryGitActionType === "add" ? "添加到VCS" : "回滚"}的文件。`
                : "选择要操作的文件。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                已选择 {directoryGitSelectedPaths.size} /{" "}
                {directoryGitAllFilePaths.length} 个文件
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={directoryGitLoading || directoryGitSubmitting}
                onClick={handleToggleDirectoryGitSelectAll}
              >
                {directoryGitAllSelected ? "取消全选" : "全选"}
              </Button>
            </div>
            <div className="max-h-80 overflow-auto rounded-md border">
              {directoryGitLoading ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  正在加载目录变更...
                </div>
              ) : directoryGitError ? (
                <div className="p-3 text-xs text-destructive">
                  {directoryGitError}
                </div>
              ) : directoryGitTreeNodes.length > 0 &&
                directoryGitActionTarget ? (
                <FileTree
                  className="text-xs [&>div]:p-1"
                  expanded={directoryGitExpandedPaths}
                  onSelect={handleDirectoryGitTreeSelect}
                  onExpandedChange={setDirectoryGitExpandedPaths}
                >
                  <FileTreeFolder
                    path={DIRECTORY_GIT_TREE_ROOT_PATH}
                    name={directoryGitActionTarget.name}
                    suffix={`(${directoryGitAllFilePaths.length})`}
                    suffixClassName="text-muted-foreground/45"
                    title={directoryGitActionTarget.path}
                  >
                    {directoryGitTreeNodes.map(renderDirectoryGitTreeNode)}
                  </FileTreeFolder>
                </FileTree>
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  没有可操作的文件
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={directoryGitSubmitting}
                onClick={resetDirectoryGitActionDialog}
              >
                取消
              </Button>
              <Button
                type="button"
                variant={
                  directoryGitActionType === "rollback"
                    ? "destructive"
                    : "default"
                }
                disabled={
                  directoryGitLoading ||
                  directoryGitSubmitting ||
                  directoryGitSelectedPaths.size === 0
                }
                onClick={() => {
                  void handleDirectoryGitActionConfirm()
                }}
              >
                {directoryGitActionType === "add" ? "添加到VCS" : "回滚"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(compareTarget)}
        onOpenChange={(open) => {
          if (open) return
          setCompareTarget(null)
          setCompareBranchFilter("")
          setCompareCurrentBranch(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>与分支比较</DialogTitle>
            <DialogDescription>
              {compareTarget
                ? `选择分支并与${compareTarget.kind === "dir" ? "目录" : "文件"} ${compareTarget.path} 对比`
                : "选择要比较的分支。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={compareBranchFilter}
              onChange={(event) => setCompareBranchFilter(event.target.value)}
              placeholder="过滤分支，例如 main / origin/main"
              autoFocus
              disabled={comparing}
            />
            <div className="text-xs text-muted-foreground">
              单击分支即可直接比较
            </div>
            <div className="space-y-2">
              <div className="max-h-56 overflow-y-auto rounded-xl border p-2 space-y-3">
                {compareBranchLoading ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    正在加载分支...
                  </div>
                ) : (
                  <>
                    <Collapsible
                      open={compareRecentOpen}
                      onOpenChange={setCompareRecentOpen}
                    >
                      <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground select-none outline-hidden">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
                        最近分支 ({filteredCompareRecentBranches.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-1 pt-1">
                        {filteredCompareRecentBranches.length > 0 ? (
                          filteredCompareRecentBranches.map((branch) => (
                            <Button
                              key={`recent-${branch}`}
                              type="button"
                              size="xs"
                              variant="ghost"
                              className="w-full justify-start"
                              onClick={() => {
                                void handleCompareBranchClick(branch)
                              }}
                              disabled={comparing}
                            >
                              {branch}
                            </Button>
                          ))
                        ) : (
                          <div className="px-2 text-xs text-muted-foreground">
                            无当前分支
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                    <Collapsible
                      open={compareLocalOpen}
                      onOpenChange={setCompareLocalOpen}
                    >
                      <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground select-none outline-hidden">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
                        本地分支 ({filteredCompareBranches.local.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-1 pt-1">
                        {filteredCompareBranches.local.length > 0 ? (
                          filteredCompareBranches.local.map((branch) => (
                            <Button
                              key={`local-${branch}`}
                              type="button"
                              size="xs"
                              variant="ghost"
                              className="w-full justify-start"
                              onClick={() => {
                                void handleCompareBranchClick(branch)
                              }}
                              disabled={comparing}
                            >
                              {branch}
                            </Button>
                          ))
                        ) : (
                          <div className="px-2 text-xs text-muted-foreground">
                            无匹配分支
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                    <Collapsible
                      open={compareRemoteOpen}
                      onOpenChange={setCompareRemoteOpen}
                    >
                      <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground select-none outline-hidden">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
                        远程分支 ({filteredCompareBranches.remote.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-1 pt-1">
                        {filteredCompareBranches.remote.length > 0 ? (
                          filteredCompareBranches.remote.map((branch) => (
                            <Button
                              key={`remote-${branch}`}
                              type="button"
                              size="xs"
                              variant="ghost"
                              className="w-full justify-start"
                              onClick={() => {
                                void handleCompareBranchClick(branch)
                              }}
                              disabled={comparing}
                            >
                              {branch}
                            </Button>
                          ))
                        ) : (
                          <div className="px-2 text-xs text-muted-foreground">
                            无匹配分支
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={comparing}
                onClick={() => {
                  setCompareTarget(null)
                  setCompareBranchFilter("")
                  setCompareCurrentBranch(null)
                }}
              >
                取消
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(externalConflictPrompt)}
        onOpenChange={(open) => {
          if (open) return
          setExternalConflictPrompt(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>检测到外部文件变更</DialogTitle>
            <DialogDescription>
              {externalConflictPrompt
                ? `文件 ${externalConflictPrompt.path} 在磁盘已发生变化，当前编辑内容尚未保存。`
                : "当前文件在磁盘已发生变化，当前编辑内容尚未保存。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={savingExternalConflictCopy}
              onClick={handleCompareExternalConflict}
            >
              对比
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={savingExternalConflictCopy}
              onClick={() => {
                void handleSaveExternalConflictCopy()
              }}
            >
              {savingExternalConflictCopy ? "另存中..." : "另存为副本"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={savingExternalConflictCopy}
              onClick={handleReloadExternalConflict}
            >
              重载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (open) return
          setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `确定删除${deleteTarget.kind === "dir" ? "目录" : "文件"} "${deleteTarget.name}" 吗？此操作不可撤销。`
                : "此操作不可撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                void handleDeleteConfirm()
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(rollbackTarget)}
        onOpenChange={(open) => {
          if (open) return
          setRollbackTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认回滚</AlertDialogTitle>
            <AlertDialogDescription>
              {rollbackTarget
                ? `确定回滚文件 "${rollbackTarget.name}" 的本地修改吗？`
                : "确定回滚该文件的本地修改吗？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rollingBack}
              onClick={() => {
                void handleRollbackConfirm()
              }}
            >
              回滚
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
