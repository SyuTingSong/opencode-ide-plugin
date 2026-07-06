import { useState, useEffect } from "react"
import type { Config } from "@opencode-ai/sdk/client"
import { useProject } from "../../state/ProjectContext"

interface GeneralTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
}

function useEnterToSend() {
  const [initial] = useState(() => {
    try {
      const value = window.localStorage.getItem("opencode-enter-to-send")
      return value === null ? true : value === "true"
    } catch {
      return true
    }
  })
  const [enabled, setEnabled] = useState(initial)
  return [enabled, setEnabled, initial] as const
}

function useSkipUndoConfirm() {
  const [initial] = useState(() => {
    try {
      const value = window.localStorage.getItem("opencode-skip-undo-confirm")
      return value === "true"
    } catch {
      return false
    }
  })
  const [enabled, setEnabled] = useState(initial)

  useEffect(() => {
    try {
      window.localStorage.setItem("opencode-skip-undo-confirm", String(enabled))
    } catch {}
  }, [enabled])

  return [enabled, setEnabled, initial] as const
}

export function GeneralTab({ formData, setFormData, onExtraChange }: GeneralTabProps & { onExtraChange?: (hasChanged: boolean) => void }) {
  const { worktree } = useProject()
  const [enterToSend, setEnterToSend, enterToSendInitial] = useEnterToSend()
  const [skipUndoConfirm, setSkipUndoConfirm, skipUndoConfirmInitial] = useSkipUndoConfirm()

  useEffect(() => {
    onExtraChange?.(enterToSend !== enterToSendInitial || skipUndoConfirm !== skipUndoConfirmInitial)
  }, [enterToSend, enterToSendInitial, skipUndoConfirm, skipUndoConfirmInitial, onExtraChange])
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
        <input
          type="text"
          value={formData.username || ""}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          placeholder="Your username"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Custom username to display in conversations</p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.autoupdate === true}
            onChange={(e) => setFormData({ ...formData, autoupdate: e.target.checked })}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Auto-update</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">Automatically update to the latest version</p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.snapshot ?? false}
            onChange={(e) => setFormData({ ...formData, snapshot: e.target.checked })}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Enable snapshots</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">
          Take snapshots of file state during sessions
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Share Mode</label>
        <select
          value={formData.share || "manual"}
          onChange={(e) => setFormData({ ...formData, share: e.target.value as "manual" | "auto" | "disabled" })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="manual">Manual</option>
          <option value="auto">Auto</option>
          <option value="disabled">Disabled</option>
        </select>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Control session sharing behavior</p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={enterToSend}
            onChange={(e) => setEnterToSend(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Press Enter to send messages</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">
          When enabled, press Enter to send. Use Shift+Enter for a new line. When disabled, use Cmd/Ctrl+Enter to send.
        </p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={skipUndoConfirm}
            onChange={(e) => setSkipUndoConfirm(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Skip undo confirmation</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">
          When enabled, undo/redo/restore actions will not show a confirmation modal.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Working directory</label>
        <div className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-900 text-xs font-mono text-gray-900 dark:text-gray-100 truncate">
          {worktree ?? "Unknown"}
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Directory where the OpenCode server was started.
        </p>
      </div>
    </div>
  )
}
