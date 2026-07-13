import { useCallback, useState } from "react"
import type { Config } from "@opencode-ai/sdk/client"

export function useUnsavedChanges(
  formData: Partial<Config>,
  originalFormData: Partial<Config>,
  apiKeys: Record<string, string>,
  extraChanged?: boolean,
) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  const hasUnsavedChanges = useCallback(() => {
    const formChanged = JSON.stringify(formData) !== JSON.stringify(originalFormData)
    const apiKeysEntered = Object.values(apiKeys).some((key) => key.trim() !== "")
    return formChanged || apiKeysEntered || !!extraChanged
  }, [formData, originalFormData, apiKeys, extraChanged])

  return {
    hasUnsavedChanges,
    showCloseConfirm,
    setShowCloseConfirm,
  }
}
