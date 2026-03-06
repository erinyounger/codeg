"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Loader2 } from "lucide-react"
import { CommitWorkspace } from "@/components/layout/commit-dialog"
import { AppTitleBar } from "@/components/layout/app-title-bar"
import { AppToaster } from "@/components/ui/app-toaster"
import { getFolder } from "@/lib/tauri"
import type { FolderDetail } from "@/lib/types"

const TOAST_DURATION_MS = 6000

interface FolderLoadState {
  loadedId: number | null
  folder: FolderDetail | null
  error: string | null
}

function CommitPageInner() {
  const searchParams = useSearchParams()
  const [state, setState] = useState<FolderLoadState>({
    loadedId: null,
    folder: null,
    error: null,
  })

  const folderId = Number(searchParams.get("folderId") ?? "0")
  const normalizedFolderId = Number.isFinite(folderId) ? folderId : 0
  const hasValidFolderId = normalizedFolderId > 0
  const loading = hasValidFolderId && state.loadedId !== normalizedFolderId
  const folder = state.loadedId === normalizedFolderId ? state.folder : null
  const error = state.loadedId === normalizedFolderId ? state.error : null

  const closeWindow = useCallback(() => {
    getCurrentWindow()
      .close()
      .catch((err) => {
        console.error("[CommitPage] failed to close window:", err)
      })
  }, [])

  useEffect(() => {
    if (!hasValidFolderId) return

    let cancelled = false

    getFolder(normalizedFolderId)
      .then((detail) => {
        if (!cancelled) {
          setState({
            loadedId: normalizedFolderId,
            folder: detail,
            error: null,
          })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            loadedId: normalizedFolderId,
            folder: null,
            error: String(err),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [hasValidFolderId, normalizedFolderId])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppTitleBar
        center={
          <div className="text-sm font-semibold tracking-tight">
            Git Commit{hasValidFolderId && folder ? ` · ${folder.name}` : ""}
          </div>
        }
      />

      <main className="flex-1 min-h-0 p-3">
        {!hasValidFolderId ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            缺少有效的 folderId 参数
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载仓库信息...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : folder ? (
          <CommitWorkspace
            folderPath={folder.path}
            onCommitted={closeWindow}
            onCancel={closeWindow}
          />
        ) : null}
      </main>

      <AppToaster
        position="bottom-right"
        duration={TOAST_DURATION_MS}
        closeButton
      />
    </div>
  )
}

export default function CommitPage() {
  return (
    <Suspense>
      <CommitPageInner />
    </Suspense>
  )
}
