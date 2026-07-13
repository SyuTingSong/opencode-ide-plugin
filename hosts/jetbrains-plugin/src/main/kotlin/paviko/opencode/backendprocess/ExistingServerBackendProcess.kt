package paviko.opencode.backendprocess

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.nio.charset.StandardCharsets

internal class ExistingServerBackendProcess(baseUrl: String) : BackendProcess {
    override val isExternal = true
    private val bootLog = "opencode server listening on $baseUrl\n".toByteArray(StandardCharsets.UTF_8)

    override val inputStream: InputStream = ByteArrayInputStream(bootLog)

    override fun waitFor(): Int {
        return 0
    }

    override fun destroy() {}

    override fun isAlive(): Boolean {
        return true
    }

    override fun stopCapture() {}
}
