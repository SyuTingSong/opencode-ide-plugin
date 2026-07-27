package paviko.opencode.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.vfs.VfsUtilCore
import paviko.opencode.ui.PathInserter

/**
 * Sends the current file to the context.
 * If the editor has an active text selection, sends "path:startLine-endLine" instead of the bare file path.
 */
class EditorAddToContextAction : AnAction("OpenCode: Add to context") {
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
            PathInserter.insertPaths(project, listOf("$basePath:$startLine-$endLine"))
            return
        }

        PathInserter.insertPaths(project, listOf(basePath))
    }
}
