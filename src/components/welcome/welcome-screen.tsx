"use client"

import { useState, useEffect } from "react"
import { Settings } from "lucide-react"
import { loadFolderHistory } from "@/lib/tauri"
import type { FolderHistoryEntry } from "@/lib/types"
import { FolderList } from "@/components/welcome/folder-list"
import { FolderActions } from "@/components/welcome/folder-actions"
import { SoftwareInfo } from "@/components/welcome/software-info"
import { Button } from "@/components/ui/button"
import { openSettingsWindow } from "@/lib/tauri"
import { AppTitleBar } from "@/components/layout/app-title-bar"

export function WelcomeScreen() {
  const [history, setHistory] = useState<FolderHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refreshHistory = async () => {
    try {
      setHistory(await loadFolderHistory())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshHistory()
  }, [])

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      <AppTitleBar
        center={
          <span className="text-sm font-bold tracking-tight">
            欢迎使用Codeg
          </span>
        }
        right={
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:text-foreground/80"
            onClick={() => {
              openSettingsWindow().catch((err) => {
                console.error("[WelcomeScreen] failed to open settings:", err)
              })
            }}
            title="Open Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="w-60 shrink-0 flex flex-col border-r">
          <SoftwareInfo />
          <FolderActions />
        </div>
        <FolderList
          history={history}
          loading={loading}
          onRefresh={refreshHistory}
        />
      </div>
    </div>
  )
}
