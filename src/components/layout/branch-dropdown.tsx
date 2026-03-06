"use client"

import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  ArrowDownToLine,
  Upload,
  GitBranchPlus,
  GitCommitHorizontal,
  Archive,
  ArchiveRestore,
  GitFork,
  GitMerge,
  GitPullRequestArrow,
  Trash2,
  Loader2,
  RefreshCw,
  FolderGit2,
  FolderOpen,
  ArrowLeftRight,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { open } from "@tauri-apps/plugin-dialog"
import {
  gitInit,
  gitPull,
  gitFetch,
  gitPush,
  gitNewBranch,
  gitWorktreeAdd,
  gitCheckout,
  gitListAllBranches,
  gitMerge,
  gitRebase,
  gitDeleteBranch,
  gitStash,
  gitStashPop,
  openFolderWindow,
  openCommitWindow,
  setFolderParentBranch,
} from "@/lib/tauri"
import type { GitBranchList } from "@/lib/types"
import { toast } from "sonner"
import { useFolderContext } from "@/contexts/folder-context"
import { useTaskContext } from "@/contexts/task-context"
import { useAlertContext } from "@/contexts/alert-context"

interface BranchDropdownProps {
  branch: string | null
  parentBranch: string | null
  onBranchChange: () => void
}

type ConfirmAction = {
  type: "merge" | "rebase" | "delete"
  branchName: string
}

interface GitCommitSucceededEventPayload {
  folder_id: number
  committed_files: number
}

export function BranchDropdown({
  branch,
  parentBranch,
  onBranchChange,
}: BranchDropdownProps) {
  const { folder } = useFolderContext()
  const folderPath = folder?.path ?? ""
  const { addTask, updateTask, removeTask } = useTaskContext()
  const { pushAlert } = useAlertContext()
  const [branchList, setBranchList] = useState<GitBranchList>({
    local: [],
    remote: [],
    worktree_branches: [],
  })
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState("")
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [branchLoading, setBranchLoading] = useState(false)
  const [localOpen, setLocalOpen] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [worktreeBranchName, setWorktreeBranchName] = useState("")
  const [worktreePath, setWorktreePath] = useState("")
  const taskSeq = useRef(0)
  const worktreeBranchSet = useMemo(
    () => new Set(branchList.worktree_branches),
    [branchList.worktree_branches]
  )

  useEffect(() => {
    if (!folder) return

    let unlisten: UnlistenFn | null = null

    listen<GitCommitSucceededEventPayload>(
      "folder://git-commit-succeeded",
      (event) => {
        if (event.payload.folder_id !== folder.id) return
        toast.success("提交代码完成", {
          description: `已提交 ${event.payload.committed_files} 个文件`,
        })
        onBranchChange()
      }
    )
      .then((fn) => {
        unlisten = fn
      })
      .catch((err) => {
        console.error("[BranchDropdown] failed to listen commit event:", err)
      })

    return () => {
      if (unlisten) unlisten()
    }
  }, [folder, onBranchChange])

  async function runGitTask<T>(
    label: string,
    action: () => Promise<T>,
    getSuccessDescription?: (result: T) => string | undefined
  ) {
    const taskId = `git-${++taskSeq.current}-${Date.now()}`
    setLoading(true)
    addTask(taskId, label)
    updateTask(taskId, { status: "running" })
    try {
      const result = await action()
      const successDescription = getSuccessDescription?.(result)
      updateTask(taskId, { status: "completed" })
      onBranchChange()
      toast.success(
        `${label} 完成`,
        successDescription
          ? {
              description: successDescription,
            }
          : undefined
      )
    } catch (err) {
      removeTask(taskId)
      pushAlert("error", `${label}失败`, String(err))
      toast.error(`${label} 失败`, { description: String(err) })
    } finally {
      setLoading(false)
    }
  }

  const loadAllBranches = useCallback(async () => {
    setBranchLoading(true)
    try {
      const list = await gitListAllBranches(folderPath)
      setBranchList(list)
    } catch {
      setBranchList({ local: [], remote: [], worktree_branches: [] })
    } finally {
      setBranchLoading(false)
    }
  }, [folderPath])

  function handleDropdownOpenChange(open: boolean) {
    setDropdownOpen(open)
    if (open && branch !== null) {
      loadAllBranches()
    }
    if (!open) {
      setLocalOpen(false)
      setRemoteOpen(false)
      setExpandedBranch(null)
    }
  }

  async function handleNewBranch() {
    const name = newBranchName.trim()
    if (!name) return
    setNewBranchOpen(false)
    setNewBranchName("")
    await runGitTask(`新建分支 ${name}`, () => gitNewBranch(folderPath, name))
  }

  function handleOpenWorktreeDialog() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    let random = ""
    for (let i = 0; i < 6; i++) {
      random += chars[Math.floor(Math.random() * chars.length)]
    }
    const folderName = folderPath.split("/").filter(Boolean).pop() ?? "project"
    const currentBranch = branch ?? "main"
    const defaultBranch = `cv-${currentBranch}-${random}`
    const parentDir = folderPath.substring(0, folderPath.lastIndexOf("/"))
    setWorktreeBranchName(defaultBranch)
    setWorktreePath(`${parentDir}/${folderName}-${currentBranch}-${random}`)
    setWorktreeOpen(true)
  }

  function handleWorktreeBranchChange(name: string) {
    setWorktreeBranchName(name)
  }

  async function handleBrowseWorktreePath() {
    const selected = await open({ directory: true, multiple: false })
    if (selected) {
      setWorktreePath(selected)
    }
  }

  async function handleNewWorktree() {
    const name = worktreeBranchName.trim()
    const wtPath = worktreePath.trim()
    if (!name || !wtPath) return
    setWorktreeOpen(false)
    await runGitTask(`新建工作树 ${name}`, async () => {
      await gitWorktreeAdd(folderPath, name, wtPath)
      await openFolderWindow(wtPath)
      await setFolderParentBranch(wtPath, branch)
    })
  }

  function handleMergeParent() {
    if (!parentBranch) return
    setConfirmAction({ type: "merge", branchName: parentBranch })
  }

  async function handleCheckout(branchName: string) {
    setDropdownOpen(false)
    await runGitTask(`切换到 ${branchName}`, () =>
      gitCheckout(folderPath, branchName)
    )
  }

  async function handleCheckoutRemote(remoteBranch: string) {
    const localName = remoteBranch.replace(/^[^/]+\//, "")
    setDropdownOpen(false)
    await runGitTask(`切换到 ${localName}`, () =>
      gitCheckout(folderPath, localName)
    )
  }

  async function handleConfirm() {
    if (!confirmAction) return
    const { type, branchName } = confirmAction
    setConfirmAction(null)

    switch (type) {
      case "merge":
        await runGitTask(
          `合并 ${branchName}`,
          () => gitMerge(folderPath, branchName),
          (result) => {
            if (result.merged_commits === 0) {
              return `${branchName} 没有新的提交`
            }
            return `已合并 ${result.merged_commits} 个提交`
          }
        )
        break
      case "rebase":
        await runGitTask(`变基到 ${branchName}`, () =>
          gitRebase(folderPath, branchName)
        )
        break
      case "delete":
        await runGitTask(`删除分支 ${branchName}`, () =>
          gitDeleteBranch(folderPath, branchName)
        )
        break
    }
  }

  function getConfirmTitle() {
    if (!confirmAction) return ""
    switch (confirmAction.type) {
      case "merge":
        return "合并分支"
      case "rebase":
        return "变基分支"
      case "delete":
        return "删除分支"
    }
  }

  function getConfirmDescription() {
    if (!confirmAction) return ""
    switch (confirmAction.type) {
      case "merge":
        return `确定将 ${confirmAction.branchName} 合并到当前分支 ${branch} 吗？`
      case "rebase":
        return `确定将当前分支 ${branch} 变基到 ${confirmAction.branchName} 吗？`
      case "delete":
        return `确定删除分支 ${confirmAction.branchName} 吗？此操作不可恢复。`
    }
  }

  function renderBranchItem(b: string, isRemote: boolean) {
    const isCurrent = b === branch
    const isWorktree = worktreeBranchSet.has(
      isRemote ? b.replace(/^[^/]+\//, "") : b
    )
    const BranchIcon = isWorktree ? FolderGit2 : GitBranch

    if (isCurrent) {
      return (
        <div
          key={b}
          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm opacity-50 select-none"
        >
          <BranchIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{b}</span>
          <span className="ml-auto text-xs">当前</span>
        </div>
      )
    }

    return (
      <DropdownMenuSub
        key={b}
        open={expandedBranch === b}
        onOpenChange={(open) => {
          if (!open) setExpandedBranch(null)
        }}
      >
        <DropdownMenuSubTrigger
          className="hover:bg-accent hover:text-accent-foreground"
          disabled={loading}
          onClick={() => setExpandedBranch(expandedBranch === b ? null : b)}
          onPointerMove={(e) => {
            e.preventDefault()
            if (expandedBranch !== null && expandedBranch !== b) {
              setExpandedBranch(null)
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur()
              }
            }
          }}
          onPointerLeave={(e) => e.preventDefault()}
        >
          <BranchIcon className="h-3.5 w-3.5" />
          {b}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem
            onSelect={() => {
              if (isRemote) {
                handleCheckoutRemote(b)
              } else {
                handleCheckout(b)
              }
            }}
          >
            <GitBranch className="h-3.5 w-3.5" />
            切换到此分支
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setDropdownOpen(false)
              setConfirmAction({ type: "merge", branchName: b })
            }}
          >
            <GitMerge className="h-3.5 w-3.5" />将 {b} 合并到 {branch}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setDropdownOpen(false)
              setConfirmAction({ type: "rebase", branchName: b })
            }}
          >
            <GitPullRequestArrow className="h-3.5 w-3.5" />将 {branch} 变基到{" "}
            {b}
          </DropdownMenuItem>
          {!isRemote && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setDropdownOpen(false)
                  setConfirmAction({ type: "delete", branchName: b })
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除分支
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  if (branch === null) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 text-sm tracking-tight hover:text-foreground/80 transition-colors outline-none cursor-default">
            <GitFork className="h-3 w-3 shrink-0" />
            <span className="truncate">版本控制</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-64" align="start">
          <DropdownMenuItem
            disabled={loading}
            onSelect={() =>
              runGitTask("初始化 Git 仓库", () => gitInit(folderPath))
            }
          >
            <GitBranch className="h-3.5 w-3.5" />
            初始化 Git 仓库
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 text-sm tracking-tight hover:text-foreground/80 transition-colors outline-none cursor-default">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{branch}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-64" align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={loading}
              onSelect={() =>
                runGitTask(
                  "更新代码",
                  () => gitPull(folderPath),
                  (result) => {
                    if (result.updated_files === 0) {
                      return "所有文件均为最新版本"
                    }
                    return `已更新 ${result.updated_files} 个文件`
                  }
                )
              }
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              更新代码
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={loading}
              onSelect={() =>
                runGitTask("获取信息", () => gitFetch(folderPath))
              }
            >
              <RefreshCw className="h-3.5 w-3.5" />
              提取远程分支
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={loading}
              onSelect={() => {
                if (!folder) return
                setDropdownOpen(false)
                openCommitWindow(folder.id).catch((err) => {
                  pushAlert("error", "打开提交窗口失败", String(err))
                  toast.error("打开提交窗口失败", { description: String(err) })
                })
              }}
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              提交代码...
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={loading}
              onSelect={() =>
                runGitTask(
                  "推送代码",
                  () => gitPush(folderPath),
                  (result) => {
                    if (result.upstream_set) {
                      if (result.pushed_commits === 0) {
                        return "已设置远程跟踪分支"
                      }
                      return `已设置远程跟踪分支并推送 ${result.pushed_commits} 个提交`
                    }
                    if (result.pushed_commits === 0) {
                      return "没有可推送的提交"
                    }
                    return `已推送 ${result.pushed_commits} 个提交`
                  }
                )
              }
            >
              <Upload className="h-3.5 w-3.5" />
              推送...
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={loading}
              onSelect={() => {
                setNewBranchName("")
                setNewBranchOpen(true)
              }}
            >
              <GitBranchPlus className="h-3.5 w-3.5" />
              新建分支...
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={loading}
              onSelect={handleOpenWorktreeDialog}
            >
              <FolderGit2 className="h-3.5 w-3.5" />
              新建工作树...
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={loading}
              onSelect={() =>
                runGitTask("贮藏更改", () => gitStash(folderPath))
              }
            >
              <Archive className="h-3.5 w-3.5" />
              贮藏更改
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={loading}
              onSelect={() =>
                runGitTask("取消贮藏", () => gitStashPop(folderPath))
              }
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
              取消贮藏...
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {branchLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="max-h-64">
              <Collapsible open={localOpen} onOpenChange={setLocalOpen}>
                <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground select-none outline-hidden">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
                  本地分支 ({branchList.local.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {branchList.local.length === 0 ? (
                    <DropdownMenuItem disabled>无本地分支</DropdownMenuItem>
                  ) : (
                    branchList.local.map((b) => renderBranchItem(b, false))
                  )}
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={remoteOpen} onOpenChange={setRemoteOpen}>
                <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground select-none outline-hidden">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
                  远程分支 ({branchList.remote.length})
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {branchList.remote.length === 0 ? (
                    <DropdownMenuItem disabled>无远程分支</DropdownMenuItem>
                  ) : (
                    branchList.remote.map((b) => renderBranchItem(b, true))
                  )}
                </CollapsibleContent>
              </Collapsible>
            </ScrollArea>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {parentBranch && (
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-orange-500 dark:text-orange-400 hover:bg-accent hover:text-orange-600 dark:hover:text-orange-300 transition-colors cursor-default select-none"
          disabled={loading}
          onClick={handleMergeParent}
          title={`当前分支从 ${parentBranch} 创建，点击合并 ${parentBranch} 到当前分支`}
        >
          <ArrowLeftRight className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-32">{parentBranch}</span>
        </button>
      )}

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{getConfirmTitle()}</AlertDialogTitle>
            <AlertDialogDescription>
              {getConfirmDescription()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={
                confirmAction?.type === "delete" ? "destructive" : "default"
              }
              onClick={handleConfirm}
            >
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建分支</DialogTitle>
            <DialogDescription>
              从当前分支 {branch} 创建新分支
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="分支名称"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.key === "Process") return
              if (e.key === "Enter") handleNewBranch()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBranchOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!newBranchName.trim() || loading}
              onClick={handleNewBranch}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={worktreeOpen} onOpenChange={setWorktreeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建工作树</DialogTitle>
            <DialogDescription>
              从当前分支 {branch} 创建新的工作树
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="wt-branch">分支名称</Label>
              <Input
                id="wt-branch"
                placeholder="分支名称"
                value={worktreeBranchName}
                onChange={(e) => handleWorktreeBranchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.key === "Process") return
                  if (e.key === "Enter") handleNewWorktree()
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wt-path">工作树路径</Label>
              <div className="flex gap-2">
                <Input
                  id="wt-path"
                  placeholder="工作树路径"
                  value={worktreePath}
                  onChange={(e) => setWorktreePath(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleBrowseWorktreePath}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorktreeOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                !worktreeBranchName.trim() || !worktreePath.trim() || loading
              }
              onClick={handleNewWorktree}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
