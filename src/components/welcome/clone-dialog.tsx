"use client"

import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { cloneRepository, openFolderWindow } from "@/lib/tauri"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { FolderOpen, Loader2 } from "lucide-react"

interface CloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CloneDialog({ open: isOpen, onOpenChange }: CloneDialogProps) {
  const [url, setUrl] = useState("")
  const [targetDir, setTargetDir] = useState("")
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBrowse = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected) {
      setTargetDir(selected)
    }
  }

  const handleClone = async () => {
    if (!url || !targetDir) return

    // Derive repo name from URL
    const repoName =
      url
        .replace(/\.git$/, "")
        .split("/")
        .pop() ?? "repo"
    const fullPath = `${targetDir}/${repoName}`

    setCloning(true)
    setError(null)

    try {
      await cloneRepository(url, fullPath)
      await openFolderWindow(fullPath)
      onOpenChange(false)
      resetForm()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCloning(false)
    }
  }

  const resetForm = () => {
    setUrl("")
    setTargetDir("")
    setError(null)
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) resetForm()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clone Repository</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <Input
              id="repo-url"
              placeholder="https://github.com/user/repo.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={cloning}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-dir">Directory</Label>
            <div className="flex gap-2">
              <Input
                id="target-dir"
                placeholder="Select target directory..."
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                disabled={cloning}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleBrowse}
                disabled={cloning}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cloning}
          >
            Cancel
          </Button>
          <Button
            onClick={handleClone}
            disabled={!url || !targetDir || cloning}
          >
            {cloning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
