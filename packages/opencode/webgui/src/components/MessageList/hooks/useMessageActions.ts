import { useState, useCallback } from "react"
import { useSession } from "../../../state/SessionContext"
import { useMessages } from "../../../state/MessagesContext"
import { getUserMessagePlainText } from "../utils"

export function useMessageActions(sessionID: string | null | undefined, onUndoToInput?: (value: string) => void) {
  const { currentSession, forkSession, revertToMessage, unrevertSession, redoNext } = useSession()
  const { getMessagesBySession, removeSessionErrors } = useMessages()

  const [forkConfirm, setForkConfirm] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const [revertAction, setRevertAction] = useState<{ type: "undo" | "redo" | "restore"; messageId?: string } | null>(
    null,
  )
  const [isRevertBusy, setIsRevertBusy] = useState(false)

  const handleForkStart = useCallback((messageId: string) => {
    setForkConfirm(messageId)
  }, [])

  const handleForkConfirm = useCallback(async () => {
    if (!forkConfirm || !currentSession) return

    setIsForking(true)
    const forkedSession = await forkSession(currentSession.id, forkConfirm)
    setIsForking(false)

    if (forkedSession) {
      setForkConfirm(null)
    }
  }, [forkConfirm, currentSession, forkSession])

  const executeRevert = useCallback(async (action: { type: "undo" | "redo" | "restore"; messageId?: string }) => {
    if (!currentSession?.id) return
    setIsRevertBusy(true)
    if (action.type === "undo" && action.messageId) {
      const sid = sessionID ?? currentSession.id
      if (sid) {
        const msgs = getMessagesBySession(sid)
        const msg = msgs.find((m) => m.info.id === action.messageId)
        if (msg) {
          if (onUndoToInput) {
            const plain = getUserMessagePlainText(msg)
            if (plain) onUndoToInput(plain)
          }
          removeSessionErrors(sid, msg.info.time.created)
        }
      }
      await revertToMessage(currentSession.id, action.messageId)
    }
    if (action.type === "redo") {
      await redoNext(currentSession.id)
    }
    if (action.type === "restore") {
      await unrevertSession(currentSession.id)
    }
    setIsRevertBusy(false)
    setRevertAction(null)
  }, [
    currentSession,
    sessionID,
    getMessagesBySession,
    removeSessionErrors,
    onUndoToInput,
    revertToMessage,
    redoNext,
    unrevertSession,
  ])

  const handleRevert = useCallback(
    (messageId: string) => {
      if (!currentSession?.id) return
      if (isRevertBusy) return
      const skip = (() => {
        try {
          return window.localStorage.getItem("opencode-skip-undo-confirm") === "true"
        } catch {
          return false
        }
      })()
      const action = { type: "undo" as const, messageId }
      if (skip) {
        void executeRevert(action)
        return
      }
      setRevertAction(action)
    },
    [currentSession, isRevertBusy, executeRevert],
  )

  const handleRevertConfirm = useCallback(async () => {
    if (!revertAction) return
    await executeRevert(revertAction)
  }, [revertAction, executeRevert])

  const handleRevertCancel = useCallback(() => {
    if (isRevertBusy) return
    setRevertAction(null)
  }, [isRevertBusy])

  const handleRedoClick = useCallback(() => {
    if (!currentSession?.id) return
    if (isRevertBusy) return
    const skip = (() => {
      try {
        return window.localStorage.getItem("opencode-skip-undo-confirm") === "true"
      } catch {
        return false
      }
    })()
    const action = { type: "redo" as const }
    if (skip) {
      void executeRevert(action)
      return
    }
    setRevertAction(action)
  }, [currentSession, isRevertBusy, executeRevert])

  const handleRestoreClick = useCallback(() => {
    if (!currentSession?.id) return
    if (isRevertBusy) return
    const skip = (() => {
      try {
        return window.localStorage.getItem("opencode-skip-undo-confirm") === "true"
      } catch {
        return false
      }
    })()
    const action = { type: "restore" as const }
    if (skip) {
      void executeRevert(action)
      return
    }
    setRevertAction(action)
  }, [currentSession, isRevertBusy, executeRevert])

  return {
    forkConfirm,
    isForking,
    revertAction,
    isRevertBusy,
    handleForkStart,
    handleForkConfirm,
    handleRevert,
    handleRevertConfirm,
    handleRevertCancel,
    handleRedoClick,
    handleRestoreClick,
    setForkConfirm,
  }
}
