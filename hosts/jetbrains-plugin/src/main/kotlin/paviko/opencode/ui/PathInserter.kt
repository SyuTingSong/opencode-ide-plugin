package paviko.opencode.ui

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import javax.swing.SwingUtilities

/**
 * Utility to send file paths (and optional :start-end ranges) to the embedded web UI.
 */
object PathInserter {
    private val logger = Logger.getInstance(PathInserter::class.java)

    fun insertPaths(project: Project, paths: List<String>) {
        try {
            if (paths.isEmpty()) return
            
            IdeBridge.send(project, "insertPaths", mapOf("paths" to paths))
            activateToolWindow(project)
        } catch (e: Exception) {
            logger.error("Unexpected error inserting paths", e)
        }
    }

    fun pastePath(project: Project, path: String) {
        try {
            if (path.isEmpty()) return
            
            IdeBridge.send(project, "pastePath", mapOf("path" to path))
            activateToolWindow(project)
        } catch (e: Exception) {
            logger.error("Unexpected error pasting path", e)
        }
    }

    private fun activateToolWindow(project: Project) {
        SwingUtilities.invokeLater {
            try {
                val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("OpenCode")
                toolWindow?.show(null)
                toolWindow?.activate(null, true)
            } catch (_: Throwable) {}
        }
    }
}
