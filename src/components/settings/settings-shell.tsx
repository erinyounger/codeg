"use client"

import { useCallback, type ComponentType, type ReactNode } from "react"
import {
  Bot,
  BookOpenText,
  Keyboard,
  Palette,
  PlugZap,
  Settings,
} from "lucide-react"
import { usePathname } from "next/navigation"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { AppToaster } from "@/components/ui/app-toaster"
import { cn } from "@/lib/utils"
import { AppTitleBar } from "@/components/layout/app-title-bar"

interface SettingsNavItem {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    href: "/settings/appearance",
    label: "Appearance",
    icon: Palette,
  },
  {
    href: "/settings/agents",
    label: "Agents",
    icon: Bot,
  },
  {
    href: "/settings/mcp",
    label: "MCP",
    icon: PlugZap,
  },
  {
    href: "/settings/skills",
    label: "Skills",
    icon: BookOpenText,
  },
  {
    href: "/settings/shortcuts",
    label: "Shortcuts",
    icon: Keyboard,
  },
  {
    href: "/settings/system",
    label: "System",
    icon: Settings,
  },
]

interface SettingsShellProps {
  children: ReactNode
}

function normalizePath(path: string): string {
  const noSuffix = path.replace(/\/index\.html$/, "").replace(/\.html$/, "")
  const noTrailingSlash = noSuffix.replace(/\/+$/, "")
  return noTrailingSlash || "/"
}

function isWindowsRuntime(): boolean {
  if (typeof navigator === "undefined") return false
  const platform = navigator.platform.toLowerCase()
  const userAgent = navigator.userAgent.toLowerCase()
  return platform.includes("win") || userAgent.includes("windows")
}

export function SettingsShell({ children }: SettingsShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const normalizedPathname = normalizePath(pathname)

  const navigateTo = useCallback(
    (href: string) => {
      if (typeof window === "undefined") return

      const target = normalizePath(href)
      const current = normalizePath(window.location.pathname)
      if (current === target) return

      if (isWindowsRuntime()) {
        // WebView2 on Windows: hard navigation is more reliable than client routing.
        window.location.assign(target)
        return
      }

      // macOS/Linux: keep client-side routing for snappier transitions.
      router.push(target)
    },
    [router]
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      <AppTitleBar
        center={
          <div className="text-sm font-bold tracking-tight">Settings</div>
        }
      />

      <div className="flex-1 min-h-0 flex">
        <aside className="w-56 shrink-0 border-r p-3">
          <div className="px-1 pb-2 text-[11px] font-medium text-muted-foreground">
            Preferences
          </div>
          <nav className="space-y-1">
            {SETTINGS_NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active =
                normalizedPathname === item.href ||
                normalizedPathname.startsWith(`${item.href}/`)
              return (
                <Button
                  key={item.href}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  className={cn("w-full justify-start")}
                  type="button"
                  onClick={() => navigateTo(item.href)}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </span>
                </Button>
              )
            })}
          </nav>
        </aside>

        <section className="flex-1 min-w-0 min-h-0 p-4">{children}</section>
      </div>
      <AppToaster position="bottom-right" closeButton duration={4000} />
    </div>
  )
}
