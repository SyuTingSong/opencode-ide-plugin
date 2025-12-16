plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.2.1"
    kotlin("jvm") version "1.9.23"
}

group = "paviko.opencode"
version = "25.12.16"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

java {
    // Align with IntelliJ Platform 2024.3+ requirement
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    jvmToolchain(21)
}

sourceSets {
    test {
        kotlin {
            srcDir("src/test/kotlin")
        }
    }
    
    // Create a separate source set for unit tests that don't need IntelliJ
    create("unitTest") {
        kotlin {
            srcDir("src/unitTest/kotlin")
        }
        resources {
            srcDir("src/unitTest/resources")
        }
        compileClasspath += sourceSets.main.get().output
        runtimeClasspath += output + compileClasspath
    }
}

dependencies {
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.1")

    // IntelliJ Platform dependencies
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
        bundledPlugin("com.intellij.java")
        bundledPlugin("org.jetbrains.plugins.terminal")

        pluginVerifier()
        zipSigner()
    }

    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
    testImplementation("org.mockito:mockito-core:5.5.0")
    testImplementation("org.mockito:mockito-inline:5.2.0")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.1.0")
    testImplementation(kotlin("test"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    
    // Unit test dependencies (no IntelliJ, no JUnit)
    "unitTestImplementation"("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.1")
    "unitTestImplementation"(kotlin("stdlib"))
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("243")
        }
        // Provide metadata without setting an upper build bound (no untilBuild)
        description = providers.provider {
            val f = file("description.html")
            if (!f.isFile) {
                return@provider "Runs local OpenCode backend and displays the chat UI."
            }

            val text = f.readText().trim()
            if (text.isEmpty()) {
                "Runs local OpenCode backend and displays the chat UI."
            } else {
                text
            }
        }
        changeNotes = providers.provider {
            val f = file("changelog.html")
            if (!f.isFile) {
                return@provider "See CHANGELOG.md for details."
            }

            val text = f.readText().trim()
            if (text.isEmpty()) {
                "See CHANGELOG.md for details."
            } else {
                text
            }
        }
    }
}

tasks {
    // Ensure no upper build bound is set in plugin.xml so the plugin stays compatible with newer IDEs
    patchPluginXml {
        // keep sinceBuild from pluginConfiguration, but expand upper bound to newer IDE builds
        untilBuild.set("261.*")
    }

    prepareSandbox {
        from(rootProject.rootDir.resolve("LICENSE")) {
            into("${intellijPlatform.projectName.get()}")
        }
    }

    
    // Configure test task for IntelliJ integration tests
    test {
        useJUnitPlatform()
        
        systemProperty("java.awt.headless", "true")
        systemProperty("idea.test.cyclic.buffer.size", "1048576")
        systemProperty("idea.home.path", "")
        
        jvmArgs(
            "-Djava.awt.headless=true",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            "--add-opens=java.base/java.util=ALL-UNNAMED"
        )
    }
    
    // Create unit test task that runs without IntelliJ dependencies
    register<JavaExec>("unitTest") {
        dependsOn("compileUnitTestKotlin")
        
        mainClass.set("paviko.opencode.ui.StandaloneMessageTestKt")
        classpath = sourceSets["unitTest"].runtimeClasspath
        
        systemProperty("java.awt.headless", "true")
        
        jvmArgs(
            "-Djava.awt.headless=true",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            "--add-opens=java.base/java.util=ALL-UNNAMED"
        )
    }
    
    // Make build depend on unit tests
    build {
        dependsOn("unitTest")
    }
}
