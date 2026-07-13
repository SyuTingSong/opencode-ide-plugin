---
name: build-jetbrains-plugin
description: Use when the user asks to build the JetBrains IDE plugin
---

# Build JetBrains Plugin

Build the JetBrains IDE plugin (GUI-only) that embeds the webgui React app inside a JCEF browser panel.

## When to Use

- After modifying `packages/opencode/webgui` frontend code and needing to test in PhpStorm/IntelliJ
- After modifying `hosts/jetbrains-plugin` Kotlin/Java code
- When local Gradle fails with `IllegalArgumentException` parsing Java version (e.g., Java 25)
- When Gradle daemon lock conflicts prevent builds (`Timeout waiting to lock checksums cache`)
- When the IDE plugin needs to be reinstalled from disk for testing

## When NOT to Use

- For VSCode plugin changes (use `hosts/vscode-plugin` scripts instead)
- For webgui-only development (use `bun run dev` in `packages/opencode/webgui` for live reload)
- When only backend/opencode CLI changes are needed (plugin does not bundle the CLI in GUI-only mode)

## Quick Reference

```bash
# 1. Build webgui
cd packages/opencode/webgui && bun run build

# 2. Build plugin (Docker — required for Java 21 / Gradle 8.5)
cd hosts/jetbrains-plugin
rm -rf .gradle build

docker run --rm \
  -v "$(pwd)/../..:/workspace" \
  -w /workspace/hosts/jetbrains-plugin \
  -e guiOnly=true \
  gradle:8.5-jdk21 \
  bash -c "rm -rf .gradle build && ./gradlew buildPlugin -PguiOnly=true -PwebguiDist=/workspace/packages/opencode/webgui-dist --no-daemon"

# 3. Locate the artifact
ls -lh build/distributions/opencode-plugin-gui-only-*.zip
```

## Install for Local Testing

1. **Settings** → **Plugins** → **⚙️** → **Install Plugin from Disk...**
2. Select `build/distributions/opencode-plugin-gui-only-*.zip`
3. Restart IDE

## Common Mistakes

### Gradle Lock Conflicts

**Symptom:** `Timeout waiting to lock checksums cache` or `fileHashes lock`
**Fix:** `rm -rf .gradle build` and rebuild. If using Docker, also `rm -rf /tmp/gradle-cache`.

### Java Version Mismatch

**Symptom:** `java.lang.IllegalArgumentException: 25.0.2` (or similar version string)
**Cause:** Local JetBrains Runtime (Java 25) is incompatible with Gradle 8.5
**Fix:** Always use Docker `gradle:8.5-jdk21` image. Never use system Java 25.

### Missing WebGUI Dist

**Symptom:** `copyWebguiDist NO-SOURCE` or build succeeds but plugin has no UI
**Cause:** Forgot to run `bun run build` in `packages/opencode/webgui` first
**Fix:** Build webgui first, verify `packages/opencode/webgui-dist/index.html` exists.

### IDE Plugin Not Updating After Reinstall

**Symptom:** Reinstalled `.zip` but old plugin behavior persists
**Fix:** Fully uninstall the old plugin first, restart IDE, then install the new `.zip`.