"use client"

import { useState } from "react"
import { FolderOpen, GitBranch } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { openFolderWindow } from "@/lib/tauri"
import { Button } from "@/components/ui/button"
import { CloneDialog } from "./clone-dialog"

export function FolderActions() {
  const [cloneOpen, setCloneOpen] = useState(false)

  const handleOpen = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected) {
      await openFolderWindow(selected)
    }
  }

  return (
    <div className="w-full flex flex-col gap-1 px-3">
      <Button
        variant="ghost"
        className="justify-start gap-2 h-9"
        onClick={handleOpen}
      >
        <FolderOpen className="h-4 w-4" />
        Open Folder
      </Button>
      <Button
        variant="ghost"
        className="justify-start gap-2 h-9"
        onClick={() => setCloneOpen(true)}
      >
        <GitBranch className="h-4 w-4" />
        Clone Repository
      </Button>

      <CloneDialog open={cloneOpen} onOpenChange={setCloneOpen} />
    </div>
  )
}
