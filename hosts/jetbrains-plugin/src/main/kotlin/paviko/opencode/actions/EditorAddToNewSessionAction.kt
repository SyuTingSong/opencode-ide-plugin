package paviko.opencode.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.vfs.VfsUtilCore
import paviko.opencode.ui.PathInserter

/**
 * Creates a new chat session and sends the current file (or selected line range) to its input.
 * Mirrors [EditorAddToContextAction] but targets a freshly created session instead of the active one.
 */
class EditorAddToNewSessionAction : AnAction("OpenCode: Add to new session") {
    override fun update(e: AnActionEvent) {
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
        e.presentation.isEnabledAndVisible = file != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val basePath = try {
            if (file.isInLocalFileSystem) VfsUtilCore.virtualToIoFile(file).absolutePath else file.path
        } catch (_: Throwable) { null }
        if (basePath.isNullOrEmpty()) return
        val project = e.project ?: return

        val editor = e.getData(CommonDataKeys.EDITOR)
        val sel = editor?.selectionModel
        if (sel?.hasSelection() == true) {
            val doc = editor.document
            val startLine = doc.getLineNumber(sel.selectionStart) + 1 // 1-based
            val endLine = doc.getLineNumber(sel.selectionEnd - 1) + 1 // 1-based, inclusive
            PathInserter.insertPaths(project, listOf("$basePath:$startLine-$endLine"), newSession = true)
            return
        }

        PathInserter.insertPaths(project, listOf(basePath), newSession = true)
    }
}
