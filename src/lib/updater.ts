import { getVersion } from "@tauri-apps/api/app"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"

export interface AppUpdateCheckResult {
  currentVersion: string
  update: Update | null
}

export async function getCurrentAppVersion(): Promise<string> {
  return getVersion()
}

export async function checkAppUpdate(): Promise<AppUpdateCheckResult> {
  const [currentVersion, update] = await Promise.all([getVersion(), check()])
  return { currentVersion, update }
}

export async function installAppUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall()
}

export async function relaunchApp(): Promise<void> {
  await relaunch()
}

export async function closeAppUpdate(update: Update): Promise<void> {
  await update.close()
}
