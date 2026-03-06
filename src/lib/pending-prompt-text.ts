const pendingPromptTextByContextKey = new Map<string, string>()

export function setPendingPromptText(contextKey: string, text: string): void {
  const normalized = text.trim()
  if (!normalized) {
    pendingPromptTextByContextKey.delete(contextKey)
    return
  }
  pendingPromptTextByContextKey.set(contextKey, normalized)
}

export function getPendingPromptText(contextKey: string): string | null {
  return pendingPromptTextByContextKey.get(contextKey) ?? null
}

export function clearPendingPromptText(contextKey: string): void {
  pendingPromptTextByContextKey.delete(contextKey)
}
