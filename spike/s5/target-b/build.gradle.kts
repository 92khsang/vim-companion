import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

// Spike S5 target (b): builds against IntelliJ IDEA 2026.1.5 (since-build 261);
// its test and run tasks use IntelliJ IDEA 2026.2.3.
plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "dev.vimcompanion.spike"
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

// JUnit 4 for the one test, outside the IntelliJ Platform classpath that each test task builds.
val s5TestLibs: Configuration by configurations.creating

dependencies {
    s5TestLibs("junit:junit:4.13.2")
    s5TestLibs("org.opentest4j:opentest4j:1.3.0")
    intellijPlatform {
        intellijIdea("2026.1.5")
        testFramework(TestFrameworkType.Platform)
    }
    testImplementation("junit:junit:4.13.2")
    testRuntimeOnly("org.opentest4j:opentest4j:1.3.0")
}

// Compile with the JDK that runs Gradle (Temurin 25.0.4); the plugin targets Java 21.
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release = 21
    options.encoding = "UTF-8"
}

intellijPlatform {
    buildSearchableOptions = false
    instrumentCode = false
    pluginConfiguration {
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = "261"
            untilBuild = provider { null }
        }
    }
}

// System properties for the sandbox IDE: the probe reads the s5.* ones; the others skip first-run dialogs.
val s5Props = listOf("s5.fixture", "s5.keylog", "s5.report", "s5.exitAfterReport")
val quietIde = listOf(
    "-Didea.trust.all.projects=true",
    "-Djb.consents.confirmation.enabled=false",
    "-Djb.privacy.policy.text=<!--999.999-->",
    "-Dide.show.tips.on.startup.default.value=false",
    "-Didea.initially.ask.config=never",
    "-Dide.newUsersOnboarding=false",
)

intellijPlatformTesting {
    testIde.register("testOn2026_2_3") {
        type = IntelliJPlatformType.IntellijIdea
        version = "2026.2.3"
        testFramework(TestFrameworkType.Platform)
        task {
            useJUnit()
            val testOutput = sourceSets["test"].output
            testClassesDirs = testOutput.classesDirs
            classpath = classpath + testOutput + s5TestLibs
            dependsOn(tasks.named("testClasses"))
        }
    }
    runIde.register("runIde2026_2_3") {
        type = IntelliJPlatformType.IntellijIdea
        version = "2026.2.3"
        task {
            val props = s5Props.associateWith { providers.gradleProperty(it) }
            val projectDir = providers.gradleProperty("s5.projectDir")
            jvmArgumentProviders += CommandLineArgumentProvider {
                quietIde + props.mapNotNull { (k, v) -> v.orNull?.let { "-D$k=$it" } }
            }
            argumentProviders += CommandLineArgumentProvider { listOfNotNull(projectDir.orNull) }
        }
    }
}
