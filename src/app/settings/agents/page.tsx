import { Suspense } from "react"
import { AcpAgentSettings } from "@/components/settings/acp-agent-settings"

export default function SettingsAgentsPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          加载 Agent 设置中...
        </div>
      }
    >
      <AcpAgentSettings />
    </Suspense>
  )
}
