import { useEffect, useRef } from "react"
import { KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH, type LexicalEditor } from "lexical"
import { insertPlainWithMentionsImpl } from "../utils"

interface UseEditorKeyboardOptions {
  editor: LexicalEditor
  contentEditableRef: React.RefObject<HTMLDivElement | null>
  parseWithRange: (val: string) => { display: string; path: string; range?: { start: number; end: number } }
  onSubmit: () => void
}

function isEnterToSendEnabled(): boolean {
  try {
    const value = window.localStorage.getItem("opencode-enter-to-send")
    return value === null ? true : value === "true"
  } catch {
    return true
  }
}

export function useEditorKeyboard({ editor, contentEditableRef, parseWithRange, onSubmit }: UseEditorKeyboardOptions) {
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const isMod = event?.metaKey || event?.ctrlKey
        if (isMod && event?.key === "Enter") {
          event?.preventDefault()
          onSubmitRef.current()
          return true
        }
        if (!isMod && !event?.shiftKey && event?.key === "Enter" && isEnterToSendEnabled()) {
          event?.preventDefault()
          onSubmitRef.current()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])

  // Handle paste with mentions parsing
  useEffect(() => {
    const el = contentEditableRef.current
    if (!el) return

    const onPasteText = (e: Event) => {
      const ev = e as CustomEvent<{ text?: string }>
      const text = ev.detail?.text
      if (!text) return
      e.preventDefault()
      e.stopPropagation()
      insertPlainWithMentionsImpl(editor, parseWithRange, text)
    }

    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return
      const plain = e.clipboardData.getData("text/plain")
      if (!plain) return
      e.preventDefault()
      e.stopPropagation()
      insertPlainWithMentionsImpl(editor, parseWithRange, plain)
    }

    el.addEventListener("opencode:paste-text", onPasteText as any, true)
    el.addEventListener("paste", onPaste as any, true)
    return () => {
      el.removeEventListener("opencode:paste-text", onPasteText as any, true)
      el.removeEventListener("paste", onPaste as any, true)
    }
  }, [contentEditableRef.current, editor, parseWithRange])
}
