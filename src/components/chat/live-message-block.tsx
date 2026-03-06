"use client"

import { memo, useMemo } from "react"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import { adaptLiveMessageFromAcp } from "@/lib/adapters/ai-elements-adapter"
import { Message, MessageContent } from "@/components/ai-elements/message"

interface LiveMessageBlockProps {
  message: LiveMessage
}

export const LiveMessageBlock = memo(function LiveMessageBlock({
  message,
}: LiveMessageBlockProps) {
  const hasContent = message.content.length > 0
  const adapted = useMemo(() => adaptLiveMessageFromAcp(message), [message])

  return (
    <Message from="assistant">
      <MessageContent>
        {hasContent ? (
          <ContentPartsRenderer parts={adapted.content} role="assistant" />
        ) : (
          <div
            className="flex items-center gap-1.5 text-muted-foreground py-1"
            aria-label="Assistant is thinking"
          >
            <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
            <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
            <span className="h-2 w-2 rounded-full bg-primary animate-bounce" />
          </div>
        )}
      </MessageContent>
    </Message>
  )
})
