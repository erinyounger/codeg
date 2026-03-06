"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowUpCircle, Loader2, RefreshCw, Save, Wifi } from "lucide-react"
import type { Update } from "@tauri-apps/plugin-updater"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSystemProxySettings, updateSystemProxySettings } from "@/lib/tauri"
import {
  checkAppUpdate,
  closeAppUpdate,
  getCurrentAppVersion,
  installAppUpdate,
  relaunchApp,
} from "@/lib/updater"

const PROXY_EXAMPLE = "http://127.0.0.1:7890"

export function SystemNetworkSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [proxyUrl, setProxyUrl] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string>("")
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const settings = await getSystemProxySettings()
      setEnabled(settings.enabled)
      setProxyUrl(settings.proxy_url ?? "")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAppVersion = useCallback(async () => {
    try {
      const version = await getCurrentAppVersion()
      setCurrentVersion(version)
    } catch (err) {
      console.error("[Settings] load app version failed:", err)
    }
  }, [])

  useEffect(() => {
    loadSettings().catch((err) => {
      console.error("[Settings] load system proxy settings failed:", err)
    })
    loadAppVersion().catch((err) => {
      console.error("[Settings] load app version failed:", err)
    })
  }, [loadSettings, loadAppVersion])

  useEffect(() => {
    return () => {
      if (!availableUpdate) return
      closeAppUpdate(availableUpdate).catch((err) => {
        console.error("[Settings] release updater resource failed:", err)
      })
    }
  }, [availableUpdate])

  const saveSettings = useCallback(async () => {
    if (enabled && !proxyUrl.trim()) {
      toast.error("启用代理时必须填写代理地址")
      return
    }

    setSaving(true)
    try {
      const next = await updateSystemProxySettings({
        enabled,
        proxy_url: proxyUrl.trim() || null,
      })
      setEnabled(next.enabled)
      setProxyUrl(next.proxy_url ?? "")
      toast.success("系统代理设置已保存")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`保存失败：${message}`)
    } finally {
      setSaving(false)
    }
  }, [enabled, proxyUrl])

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdate(true)
    setUpdateError(null)

    try {
      const previousUpdate = availableUpdate
      const result = await checkAppUpdate()
      setCurrentVersion(result.currentVersion)
      setLastCheckedAt(new Date())

      if (result.update) {
        setAvailableUpdate(result.update)
        toast.success(`发现新版本 v${result.update.version}`)
      } else {
        setAvailableUpdate(null)
        toast.success("当前已经是最新版本")
      }

      if (previousUpdate && previousUpdate !== result.update) {
        await closeAppUpdate(previousUpdate)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setUpdateError(message)
      toast.error(`检查更新失败：${message}`)
    } finally {
      setCheckingUpdate(false)
    }
  }, [availableUpdate])

  const installUpdate = useCallback(async () => {
    if (!availableUpdate) return

    setInstallingUpdate(true)
    setUpdateError(null)

    try {
      await installAppUpdate(availableUpdate)
      toast.success("升级包已安装，正在重启应用")
      await relaunchApp()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setUpdateError(message)
      toast.error(`升级失败：${message}`)
    } finally {
      setInstallingUpdate(false)
    }
  }, [availableUpdate])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载中...
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="w-full space-y-4">
        <section className="space-y-1">
          <h1 className="text-sm font-semibold">系统管理</h1>
          <p className="text-xs text-muted-foreground">
            管理网络代理和应用版本升级。
          </p>
        </section>

        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">网络代理</h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            开启后，后续网络请求将优先走该代理（包括 ACP 对话、Agent 安装、 Git
            远程操作等）。
          </p>

          {loadError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              加载失败：{loadError}
            </div>
          )}

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            启用系统代理
          </label>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              代理地址
            </label>
            <Input
              value={proxyUrl}
              onChange={(event) => setProxyUrl(event.target.value)}
              placeholder={PROXY_EXAMPLE}
            />
            <p className="text-[11px] text-muted-foreground">
              支持 http(s)/socks5，示例：{PROXY_EXAMPLE}
              。仅在启用系统代理时生效。
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={saveSettings} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  保存
                </>
              )}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">应用升级</h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            点击检查后会从配置的发布源拉取最新版本信息，有新版本时可直接下载并安装。
          </p>

          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-muted-foreground">当前版本</div>
              <div className="mt-1 font-medium">
                {currentVersion ? `v${currentVersion}` : "-"}
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-muted-foreground">可升级版本</div>
              <div className="mt-1 font-medium">
                {availableUpdate ? `v${availableUpdate.version}` : "暂无"}
              </div>
            </div>
          </div>

          {lastCheckedAt && (
            <p className="text-[11px] text-muted-foreground">
              上次检查：{lastCheckedAt.toLocaleString()}
            </p>
          )}

          {updateError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              更新异常：{updateError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={checkForUpdates}
              disabled={checkingUpdate || installingUpdate}
            >
              {checkingUpdate ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  检查中...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  检查更新
                </>
              )}
            </Button>

            {availableUpdate && (
              <Button
                size="sm"
                onClick={installUpdate}
                disabled={installingUpdate || checkingUpdate}
              >
                {installingUpdate ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    升级中...
                  </>
                ) : (
                  <>
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                    升级到 v{availableUpdate.version}
                  </>
                )}
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
