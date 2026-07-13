import { ChildProcess, spawn } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import * as vscode from "vscode"
import { ResourceExtractor } from "./ResourceExtractor"
import { ErrorCategory, errorHandler, ErrorSeverity } from "../utils/ErrorHandler"
import { logger } from "../globals"

const DEFAULT_OPENCODE_PORT = 4096

/**
 * Backend process management - mirrors BackendLauncher.kt
 * Handles opencode backend process lifecycle, binary extraction, and connection management
 */

export interface BackendConnection {
  port: number
  uiBase: string
  process?: ChildProcess
}

export class BackendLauncher {
  private currentProcess?: ChildProcess
  private currentConnection?: Omit<BackendConnection, "process">
  private isExternalConnection = false
  private extensionPath?: string

  constructor(extensionPath?: string) {
    this.extensionPath = extensionPath
  }

  /**
   * Launch the opencode backend process
   * @param workspaceRoot Optional workspace root directory
   * @returns Promise resolving to backend connection info
   */
  async launchBackend(workspaceRoot?: string, options?: { forceNew?: boolean }): Promise<BackendConnection> {
    // Reuse existing running backend if available
    if (!options?.forceNew && this.currentConnection && this.isRunning()) {
      if (this.currentProcess) {
        return { ...this.currentConnection, process: this.currentProcess }
      }
      return { ...this.currentConnection }
    }

    if (!options?.forceNew) {
      logger.appendLine(`Probing for existing opencode server on port ${DEFAULT_OPENCODE_PORT}...`)
      const existingServer = await this.probeExistingServer()
      if (existingServer.ok) {
        logger.appendLine(`Found existing opencode server on port ${DEFAULT_OPENCODE_PORT}`)
        this.currentProcess = undefined
        this.currentConnection = { port: existingServer.port, uiBase: existingServer.uiBase }
        this.isExternalConnection = true
        return { ...this.currentConnection }
      }
      logger.appendLine(`No existing opencode server on port ${DEFAULT_OPENCODE_PORT}, starting new process`)
    }

    try {
      // Extract binary for current platform
      const binaryPath = await this.extractBinary()
      logger.appendLine(`Using binary: ${binaryPath}`)

      // Build command arguments
      const args = this.buildCommandArgs(binaryPath)
      const cwd = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()

      if (options?.forceNew) {
        // Start an independent backend without touching the current shared one
        logger.appendLine(`Starting additional backend process: ${args.join(" ")}`)
        const childProcess = this.spawnBackend(args, cwd)

        // Parse connection and set up error handling
        const connection = await this.parseConnectionInfo(childProcess)
        this.setupErrorHandling(childProcess)
        logger.appendLine(`Additional backend started successfully on port ${connection.port}`)

        // Do NOT update currentProcess/currentConnection for additional backend
        return { ...connection, process: childProcess }
      }

      // For shared backend: terminate any existing and start new
      this.terminate()
      logger.appendLine(`Starting backend process: ${args.join(" ")}`)
      const childProcess = this.spawnBackend(args, cwd)

      this.isExternalConnection = false
      this.currentProcess = childProcess

      // Parse connection info from stdout
      const connection = await this.parseConnectionInfo(childProcess)

      // Set up error handling
      this.setupErrorHandling(childProcess)

      logger.appendLine(`Backend started successfully on port ${connection.port}`)

      // Cache current connection (shared)
      this.currentConnection = connection

      return {
        ...connection,
        process: childProcess,
      }
    } catch (error) {
      logger.appendLine(`Failed to launch backend: ${error}`)

      // Try fallback without custom command if it was configured
      const customCommand = this.getCustomCommand()
      if (customCommand.trim()) {
        logger.appendLine("Attempting fallback without custom command...")
        try {
          return await this.launchBackendFallback(workspaceRoot)
        } catch (fallbackError) {
          // Handle both original and fallback errors
          await errorHandler.handleBackendLaunchError(
            fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
            {
              originalError: error instanceof Error ? error.message : String(error),
              customCommand,
              workspaceRoot,
              attemptedFallback: true,
            },
          )
          throw fallbackError
        }
      }

      // Handle the original error
      await errorHandler.handleBackendLaunchError(error instanceof Error ? error : new Error(String(error)), {
        customCommand,
        workspaceRoot,
        attemptedFallback: false,
      })

      throw error
    }
  }

  /**
   * Launch backend without custom command as fallback
   * @param workspaceRoot Optional workspace root directory
   * @returns Promise resolving to backend connection info
   */
  private async launchBackendFallback(workspaceRoot?: string): Promise<BackendConnection> {
    try {
      const binaryPath = await this.extractBinary()
      const args = this.buildCommandArgs(binaryPath, true) // Skip custom command

      logger.appendLine(`Starting fallback backend process: ${args.join(" ")}`)

      const cwd = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()

      const childProcess = this.spawnBackend(args, cwd)

      this.isExternalConnection = false
      this.currentProcess = childProcess

      const connection = await this.parseConnectionInfo(childProcess)
      this.setupErrorHandling(childProcess)

      logger.appendLine(`Fallback backend started successfully on port ${connection.port}`)

      // Cache current connection
      this.currentConnection = connection

      return {
        ...connection,
        process: childProcess,
      }
    } catch (fallbackError) {
      logger.appendLine(`Fallback backend launch also failed: ${fallbackError}`)

      await errorHandler.handleBackendLaunchError(
        fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
        {
          isFallback: true,
          workspaceRoot,
        },
      )

      throw fallbackError
    }
  }

  /**
   * Extract the appropriate binary for the current OS/architecture.
   * Tries bundled binary first, falls back to system PATH opencode.
   * @returns Promise resolving to the path of the extracted binary
   */
  private async extractBinary(): Promise<string> {
    // Check for environment override first
    const override = process.env.OPENCODE_BIN
    if (override && override.trim()) {
      logger.appendLine(`Using binary override: ${override}`)
      return override.trim()
    }

    // Resolve extension path dynamically (works for any extension ID)
    const extPath =
      this.extensionPath ||
      vscode.extensions.getExtension("paviko.opencode-ux-plus")?.extensionPath ||
      vscode.extensions.getExtension("paviko.opencode-ux-plus-gui-only")?.extensionPath

    // Try bundled binary first
    if (extPath) {
      try {
        return await ResourceExtractor.extractBinary(extPath)
      } catch {
        logger.appendLine("Bundled binary not found, falling back to system PATH")
      }
    }

    // Fall back to system opencode binary
    return this.resolveSystemBinary()
  }

  /**
   * Resolve opencode binary from system PATH
   * @returns The binary name to be resolved via PATH
   */
  private resolveSystemBinary(): string {
    if (process.platform === "win32") {
      const candidates = this.getWindowsInstalledBinaryCandidates()
      const match = candidates.find((item) => existsSync(item))
      if (match) {
        logger.appendLine(`Using Windows npm global binary: ${match}`)
        return match
      }
    }

    const name = "opencode"
    logger.appendLine(`Using system binary: ${name}`)
    return name
  }

  private getWindowsInstalledBinaryCandidates(): string[] {
    const list: (string | undefined)[] = [
      process.env.npm_config_prefix ? join(process.env.npm_config_prefix, "opencode.cmd") : undefined,
      process.env.APPDATA ? join(process.env.APPDATA, "npm", "opencode.cmd") : undefined,
      process.env.USERPROFILE ? join(process.env.USERPROFILE, "AppData", "Roaming", "npm", "opencode.cmd") : undefined,
      process.env.SCOOP ? join(process.env.SCOOP, "apps", "opencode", "current", "opencode.exe") : undefined,
      process.env.USERPROFILE
        ? join(process.env.USERPROFILE, "scoop", "apps", "opencode", "current", "opencode.exe")
        : undefined,
      process.env.USERPROFILE ? join(process.env.USERPROFILE, "scoop", "shims", "opencode.exe") : undefined,
      "C:\\ProgramData\\chocolatey\\bin\\opencode.exe",
      "C:\\ProgramData\\chocolatey\\bin\\opencode",
    ]
    return list.filter((item): item is string => Boolean(item && item.trim()))
  }

  /**
   * Build command arguments for the backend process
   * @param binaryPath Path to the binary executable
   * @param skipCustomCommand Whether to skip custom command (for fallback)
   * @returns Array of command arguments
   */
  private buildCommandArgs(binaryPath: string, skipCustomCommand = false): string[] {
    const args = [binaryPath, "serve"]

    if (!skipCustomCommand) {
      const customCommand = this.getCustomCommand()
      if (customCommand.trim()) {
        const extraArgs = this.parseCommandArgs(customCommand.trim())
        if (extraArgs.length > 0) {
          args.push(...extraArgs)
          logger.appendLine(`Using extra serve args: '${extraArgs.join(" ")}'`)
        }
      } else {
        logger.appendLine("Using default serve args")
      }
    }

    return args
  }

  /**
   * Get custom command from settings
   * @returns Custom command string
   */
  private getCustomCommand(): string {
    const config = vscode.workspace.getConfiguration("opencode")
    return config.get<string>("customCommand", "")
  }

  private parseCommandArgs(value: string): string[] {
    const args: string[] = []
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(value)) !== null) {
      if (match[1] !== undefined) {
        args.push(match[1])
      } else if (match[2] !== undefined) {
        args.push(match[2])
      } else if (match[3] !== undefined) {
        args.push(match[3])
      }
    }
    return args
  }

  private spawnBackend(args: string[], cwd: string): ChildProcess {
    const shell = this.shouldUseWindowsShell(args[0])
    if (shell) {
      logger.appendLine(`Using Windows shell launch for command: ${args[0]}`)
    }

    return spawn(args[0], args.slice(1), {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      shell,
      windowsHide: true,
    })
  }

  private async probeExistingServer(): Promise<{ ok: true; port: number; uiBase: string } | { ok: false }> {
    try {
      const response = await fetch(`http://127.0.0.1:${DEFAULT_OPENCODE_PORT}/global/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        return { ok: false }
      }
      return {
        ok: true,
        port: DEFAULT_OPENCODE_PORT,
        uiBase: `http://127.0.0.1:${DEFAULT_OPENCODE_PORT}/app`,
      }
    } catch {
      return { ok: false }
    }
  }

  private shouldUseWindowsShell(command: string): boolean {
    if (process.platform !== "win32") {
      return false
    }

    const value = command.trim().toLowerCase()
    if (!value) {
      return false
    }

    return value === "opencode" || value.endsWith(".cmd") || value.endsWith(".bat")
  }

  /**
   * Parse connection information from backend stdout
   * @param process The spawned backend process
   * @returns Promise resolving to connection info
   */
  private async parseConnectionInfo(process: ChildProcess): Promise<Omit<BackendConnection, "process">> {
    return new Promise((resolve, reject) => {
      let stdoutData = ""
      let stderrData = ""
      let resolved = false

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          reject(new Error(`Timeout waiting for backend connection info. Stderr: ${stderrData}`))
        }
      }, 300000) // 300 second timeout

      process.stdout?.on("data", (data: Buffer) => {
        stdoutData += data.toString()
        const logLine = data.toString().trim()
        logger.appendLine(`Backend stdout: ${logLine}`)

        // Look for serve output
        const lines = stdoutData.split("\n")
        for (const line of lines) {
          const trimmed = line.trim()
          const match = trimmed.match(/opencode server listening on (https?:\/\/\S+)/i)
          if (match) {
            try {
              const serverUrl = new URL(match[1])
              const inferredPort = serverUrl.port ? Number(serverUrl.port) : serverUrl.protocol === "https:" ? 443 : 80
              const baseUrl = serverUrl.href.replace(/\/$/, "")
              const uiBase = `${baseUrl}/app`

              if (!resolved) {
                resolved = true
                clearTimeout(timeout)
                resolve({
                  port: inferredPort,
                  uiBase,
                })
              }
              return
            } catch (parseError) {
              logger.appendLine(`Failed to parse backend URL: ${parseError}`)
            }
          }
        }
      })

      process.stderr?.on("data", (data: Buffer) => {
        stderrData += data.toString()
        logger.appendLine(`Backend stderr: ${data.toString().trim()}`)
      })

      process.on("error", (error) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(`Backend process error: ${error.message}`))
        }
      })

      process.on("exit", (code, signal) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(`Backend process exited with code ${code}, signal ${signal}. Stderr: ${stderrData}`))
        }
      })
    })
  }

  /**
   * Set up error handling for the backend process
   * @param process The backend process
   */
  private setupErrorHandling(process: ChildProcess): void {
    process.on("error", async (error) => {
      logger.appendLine(`Backend process error: ${error.message}`)

      await errorHandler.handleError(
        errorHandler.createErrorContext(
          ErrorCategory.BACKEND_LAUNCH,
          ErrorSeverity.ERROR,
          "BackendLauncher",
          "process_error",
          error,
          {
            pid: process.pid,
            killed: process.killed,
          },
        ),
      )
    })

    process.on("exit", async (code, signal) => {
      logger.appendLine(`Backend process exited with code ${code}, signal ${signal}`)

      if (code !== 0 && code !== null) {
        await errorHandler.handleError(
          errorHandler.createErrorContext(
            ErrorCategory.BACKEND_LAUNCH,
            ErrorSeverity.WARNING,
            "BackendLauncher",
            "process_exit",
            new Error(`Backend process exited unexpectedly with code ${code}`),
            {
              exitCode: code,
              signal,
              pid: process.pid,
            },
          ),
        )
      }

      // Clear current process reference
      if (this.currentProcess === process) {
        this.currentProcess = undefined
        this.currentConnection = undefined
        this.isExternalConnection = false
      }
    })

    // Log stdout/stderr for debugging
    process.stdout?.on("data", (data: Buffer) => {
      const output = data.toString().trim()
      if (output && !output.startsWith("{")) {
        // Don't log JSON connection info again
        logger.appendLine(`Backend: ${output}`)
      }
    })

    process.stderr?.on("data", (data: Buffer) => {
      const output = data.toString().trim()
      logger.appendLine(`Backend error: ${output}`)

      // Handle critical stderr messages
      if (output.toLowerCase().includes("permission denied") || output.toLowerCase().includes("access denied")) {
        errorHandler.handleError(
          errorHandler.createErrorContext(
            ErrorCategory.PERMISSION,
            ErrorSeverity.ERROR,
            "BackendLauncher",
            "permission_error",
            new Error(`Permission error: ${output}`),
            { stderr: output },
          ),
        )
      } else if (output.toLowerCase().includes("port") && output.toLowerCase().includes("use")) {
        errorHandler.handleError(
          errorHandler.createErrorContext(
            ErrorCategory.NETWORK,
            ErrorSeverity.WARNING,
            "BackendLauncher",
            "port_conflict",
            new Error(`Port conflict: ${output}`),
            { stderr: output },
          ),
        )
      }
    })
  }

  /**
   * Terminate the backend process
   */
  terminate(): void {
    if (this.currentProcess) {
      logger.appendLine("Terminating backend process...")

      const processRef = this.currentProcess

      // Try graceful shutdown first
      processRef.kill("SIGTERM")

      // Force kill after timeout
      setTimeout(() => {
        if (!processRef.killed) {
          logger.appendLine("Force killing backend process...")
          processRef.kill("SIGKILL")
        }
      }, 5000)
    }

    this.currentProcess = undefined
    this.currentConnection = undefined
    this.isExternalConnection = false
  }

  /**
   * Check if backend is currently running
   * @returns True if backend process is active
   */
  isRunning(): boolean {
    if (this.isExternalConnection) {
      return this.currentConnection !== undefined
    }
    return this.currentProcess !== undefined && !this.currentProcess.killed
  }
}
