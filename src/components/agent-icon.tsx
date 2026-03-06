import type { AgentType } from "@/lib/types"
import { AGENT_COLORS } from "@/lib/types"
import { cn } from "@/lib/utils"

import ClaudeColor from "@lobehub/icons/es/Claude/components/Color"
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color"
import GithubCopilotMono from "@lobehub/icons/es/GithubCopilot/components/Mono"
import QwenColor from "@lobehub/icons/es/Qwen/components/Color"
import KimiColor from "@lobehub/icons/es/Kimi/components/Color"
import MistralColor from "@lobehub/icons/es/Mistral/components/Color"
import OpenClawColor from "@lobehub/icons/es/OpenClaw/components/Color"
import { OpenAI, OpenCode } from "@lobehub/icons"

interface AgentIconProps {
  agentType: AgentType
  className?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIcon = React.ComponentType<any>

const COLOR_ICONS: Partial<Record<AgentType, AnyIcon>> = {
  claude_code: ClaudeColor,
  gemini: GeminiColor,
  qwen_code: QwenColor,
  kimi: KimiColor,
  mistral_vibe: MistralColor,
  open_claw: OpenClawColor,
}

const MONO_ICONS: Partial<Record<AgentType, AnyIcon>> = {
  codex: OpenAI,
  open_code: OpenCode,
  github_copilot: GithubCopilotMono,
}

// Text-color versions for Mono icons and SVG fallbacks
const AGENT_TEXT_COLORS: Partial<Record<AgentType, string>> = {
  open_code: "text-blue-500",
  auggie: "text-purple-500",
  github_copilot: "text-gray-700 dark:text-gray-300",
  junie: "text-pink-500",
  qoder: "text-teal-500",
  factory_droid: "text-yellow-600",
}

function FallbackIcon({
  agentType,
  className,
}: {
  agentType: AgentType
  className?: string
}) {
  const cls = cn("shrink-0", AGENT_TEXT_COLORS[agentType], className)

  switch (agentType) {
    case "auggie":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={cls}>
          <path
            d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
            fill="currentColor"
            fillOpacity="0.15"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case "junie":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={cls}>
          <path
            d="M12 2l8 10-8 10-8-10z"
            fill="currentColor"
            fillOpacity="0.15"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )
    case "qoder":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={cls}>
          <path
            d="M8 3H6a2 2 0 00-2 2v14a2 2 0 002 2h2M16 3h2a2 2 0 012 2v14a2 2 0 01-2 2h-2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )
    case "factory_droid":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={cls}>
          <circle
            cx="12"
            cy="12"
            r="3"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )
    default:
      return (
        <span
          className={cn(
            "rounded-full shrink-0",
            AGENT_COLORS[agentType],
            className
          )}
        />
      )
  }
}

export function AgentIcon({ agentType, className }: AgentIconProps) {
  const ColorIcon = COLOR_ICONS[agentType]
  if (ColorIcon) {
    return (
      <span className={cn("inline-flex shrink-0", className)}>
        <ColorIcon size="100%" />
      </span>
    )
  }

  const MonoIcon = MONO_ICONS[agentType]
  if (MonoIcon) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0",
          AGENT_TEXT_COLORS[agentType],
          className
        )}
      >
        <MonoIcon size="100%" />
      </span>
    )
  }

  return <FallbackIcon agentType={agentType} className={className} />
}
