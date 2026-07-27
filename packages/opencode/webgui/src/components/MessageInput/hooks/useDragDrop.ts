import { useEffect } from "react"
import { $createTextNode, type LexicalEditor } from "lexical"
import { $createMentionNode } from "../../mention/MentionNode"
import { extractPathsFromDrop } from "../../../lib/dnd"
import { toProjectRelative } from "../../../utils/path"
import { $ensureParagraphSelection } from "../utils"

interface UseDragDropOptions {
  contentEditableRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  editor: LexicalEditor
  worktree: string | null
  parseWithRange: (val: string) => { display: string; path: string; range?: { start: number; end: number } }
}

export function useDragDrop({
  contentEditableRef,
  containerRef,
  editor,
  worktree,
  parseWithRange,
}: UseDragDropOptions) {
  // Attach drag-and-drop to the contentEditable
  useEffect(() => {
    const el = contentEditableRef.current
    if (!el) return

    let overCount = 0

    const addHighlight = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.add("ring-2", "ring-blue-500", "border-blue-500")
    }
    const removeHighlight = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.remove("ring-2", "ring-blue-500", "border-blue-500")
    }

    const onDragEnter = (ev: DragEvent) => {
      ev.preventDefault()
      overCount = overCount + 1
      addHighlight()
    }

    const onDragOver = (ev: DragEvent) => {
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"
      addHighlight()
    }

    const onDragLeave = (ev: DragEvent) => {
      ev.preventDefault()
      overCount = Math.max(0, overCount - 1)
      if (overCount === 0) removeHighlight()
    }

    const onDrop = (ev: DragEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      overCount = 0
      removeHighlight()
      const paths = extractPathsFromDrop(ev)
      if (paths && paths.length > 0) {
        // Reuse the same insertion logic as insertPaths
        let tries = 0
        const perform = () => {
          if (!worktree && tries++ < 10) {
            setTimeout(perform, 200)
            return
          }
          editor.update(() => {
            const selection = $ensureParagraphSelection()
            const nodes = [] as any[]

            for (const raw of paths) {
              const isDir = raw.endsWith("/")
              if (isDir) {
                let rel = toProjectRelative(raw, worktree)
                if (!rel.endsWith("/")) rel = rel + "/"
                const metadata = { type: "directory" as const, display: rel, path: rel }
                nodes.push($createMentionNode(metadata))
                nodes.push($createTextNode(" "))
                continue
              }

              const parsed = parseWithRange(raw)
              const relBase = toProjectRelative(parsed.path, worktree)
              const display = parsed.range ? `${relBase}:${parsed.range.start}-${parsed.range.end}` : relBase
              const metadata: any = { type: "file" as const, display, path: relBase }
              if (parsed.range) {
                metadata.range = {
                  start: { line: parsed.range.start, character: 0 },
                  end: { line: parsed.range.end, character: 0 },
                }
              }
              nodes.push($createMentionNode(metadata))
              nodes.push($createTextNode(" "))
            }
            if (nodes.length > 0) selection.insertNodes(nodes)
          })
        }
        perform()
      }
    }

    el.addEventListener("dragenter", onDragEnter as any)
    el.addEventListener("dragover", onDragOver as any)
    el.addEventListener("dragleave", onDragLeave as any)
    el.addEventListener("drop", onDrop as any)
    return () => {
      el.removeEventListener("dragenter", onDragEnter as any)
      el.removeEventListener("dragover", onDragOver as any)
      el.removeEventListener("dragleave", onDragLeave as any)
      el.removeEventListener("drop", onDrop as any)
    }
  }, [contentEditableRef.current, editor, worktree, containerRef, parseWithRange])

  // Document-level drag highlight
  useEffect(() => {
    let over = 0
    const add = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.add("ring-2", "ring-blue-500", "border-blue-500")
    }
    const rm = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.remove("ring-2", "ring-blue-500", "border-blue-500")
    }
    const onEnter = (e: DragEvent) => {
      e.preventDefault()
      over = over + 1
      add()
    }
    const onOver = (e: DragEvent) => {
      e.preventDefault()
      add()
    }
    const onLeave = (e: DragEvent) => {
      e.preventDefault()
      over = Math.max(0, over - 1)
      if (over === 0) rm()
    }
    const onEnd = () => {
      over = 0
      rm()
    }

    document.addEventListener("dragenter", onEnter as any)
    document.addEventListener("dragover", onOver as any)
    document.addEventListener("dragleave", onLeave as any)
    document.addEventListener("drop", onEnd as any)
    document.addEventListener("dragend", onEnd as any)

    return () => {
      document.removeEventListener("dragenter", onEnter as any)
      document.removeEventListener("dragover", onOver as any)
      document.removeEventListener("dragleave", onLeave as any)
      document.removeEventListener("drop", onEnd as any)
      document.removeEventListener("dragend", onEnd as any)
    }
  }, [containerRef])
}
