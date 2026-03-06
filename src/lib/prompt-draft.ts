import type {
  AdaptedContentPart,
  UserResourceDisplay,
} from "@/lib/adapters/ai-elements-adapter"
import type { PromptDraft, PromptInputBlock } from "@/lib/types"

function isResourceLinkBlock(
  block: PromptInputBlock
): block is Extract<PromptInputBlock, { type: "resource_link" }> {
  return block.type === "resource_link"
}

export function getPromptDraftDisplayText(draft: PromptDraft): string {
  const trimmed = draft.displayText.trim()
  return trimmed || "Attached resources"
}

export function buildUserMessageTextPartsFromDraft(
  draft: PromptDraft
): AdaptedContentPart[] {
  return [{ type: "text", text: getPromptDraftDisplayText(draft) }]
}

export function extractUserResourcesFromDraft(
  draft: PromptDraft
): UserResourceDisplay[] {
  return draft.blocks.filter(isResourceLinkBlock).map((resource) => ({
    name: resource.name,
    uri: resource.uri,
    mime_type: resource.mime_type ?? null,
  }))
}
