import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
  id("org.jetbrains.kotlin.jvm") version "2.4.21"
  id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "spike.s3"
version = "0.0.1"

val ideavim = providers.gradleProperty("ideavim").get()
val platformBuildVersion = providers.gradleProperty("platformBuildVersion").get()
val platformRunVersion = providers.gradleProperty("platformRunVersion").get()

// Separate build directories let the two IdeaVim versions build and test side by side.
providers.gradleProperty("s3.buildDir").orNull?.let { layout.buildDirectory = file(it) }

java {
  toolchain { languageVersion = JavaLanguageVersion.of(25) }
  targetCompatibility = JavaVersion.VERSION_25
  sourceCompatibility = JavaVersion.VERSION_25
}

kotlin {
  compilerOptions {
    jvmTarget = JvmTarget.JVM_25
    apiVersion = KotlinVersion.KOTLIN_2_3
    languageVersion = KotlinVersion.KOTLIN_2_3
  }
}

sourceSets {
  create("uiTest")
}

val uiTestImplementation: Configuration by configurations.getting
val uiTestRuntimeOnly: Configuration by configurations.getting

repositories {
  mavenCentral()
  intellijPlatform { defaultRepositories() }
}

dependencies {
  intellijPlatform {
    intellijIdea(platformBuildVersion)
    plugins(ideavim)
    testFramework(TestFrameworkType.Platform)
  }
  intellijPlatform {
    // Starter and Driver from the build of the IDE under test.
    testFramework(TestFrameworkType.Starter, version = "262.10968.63", configurationName = "uiTestImplementation")
  }
  // The plugin itself takes the IDE's Kotlin runtime (kotlin.stdlib.default.dependency=false); the test JVM needs one
  // that matches kotlin-reflect from Starter's dependencies.
  uiTestImplementation("org.jetbrains.kotlin:kotlin-stdlib:2.4.21")
  uiTestImplementation("org.jetbrains.kotlin:kotlin-reflect:2.4.21")
  uiTestImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
  uiTestImplementation("org.jetbrains.teamcity:serviceMessages:2024.07")
  uiTestRuntimeOnly("org.junit.platform:junit-platform-launcher:1.13.4")
  uiTestImplementation("org.kodein.di:kodein-di-jvm:7.26.1")
  uiTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.10.2")
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.opentest4j:opentest4j:1.3.0")
}

intellijPlatform {
  // Keep the sandboxes under the build directory, so that each IdeaVim version has its own.
  sandboxContainer = layout.buildDirectory.dir("sandbox")
  pluginConfiguration {
    ideaVersion { sinceBuild = "261" }
  }
  buildSearchableOptions = false
  instrumentCode = false
}

intellijPlatformTesting.runIde.register("runIde262") {
  version = platformRunVersion
  plugins { plugins(ideavim) }
}

intellijPlatformTesting.testIde.register("test262") {
  version = platformRunVersion
  plugins { plugins(ideavim) }
  testFramework(TestFrameworkType.Platform)
  task {
    useJUnit()
    // A custom testIde task starts from an empty classpath; add the compiled tests.
    testClassesDirs = sourceSets["test"].output.classesDirs
    classpath = files(sourceSets["test"].output) + classpath
    if (providers.gradleProperty("s3.printClasspath").isPresent) {
      doFirst { logger.lifecycle("s3 classpath: " + classpath.files.joinToString("\n  ", "\n  ") { it.path }) }
    }
    // Isolation: IdeaVim reads this rc instead of ~/.ideavimrc, and XDG lookups stay under the build directory.
    val home = layout.buildDirectory.dir("s3-home").get().asFile
    environment("IDEA_VIM_CUSTOM_VIMRC", home.resolve("empty.ideavimrc").path)
    environment("XDG_CONFIG_HOME", home.resolve("config").path)
    environment("XDG_DATA_HOME", home.resolve("data").path)
    environment("XDG_CACHE_HOME", home.resolve("cache").path)
    doFirst { home.resolve("config").mkdirs(); home.resolve("empty.ideavimrc").writeText("") }
    maxHeapSize = "2g"
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
    // Every run writes its raw data under this directory.
    systemProperty("s3.out", providers.gradleProperty("s3.out").orElse(layout.buildDirectory.dir("s3-out").get().asFile.path).get())
    providers.gradleProperty("s3.debugActions").orNull?.let { systemProperty("s3.debugActions", it) }
    systemProperty("s3.repeat", providers.gradleProperty("s3.repeat").orElse("1").get())
    systemProperty("s3.rc", rootDir.resolve("../../../spec/generated/intellij/vim-companion.ideavimrc").canonicalPath)
  }
}

// End-to-end runs: Starter and Driver (JUnit 5) against the 2026.2.3 IDE, with the spike plugin and IdeaVim from the
// runIde262 sandbox. Keys go through AWT key dispatch (java.awt.Robot under Xvfb).
val uiTest = intellijPlatformTesting.testIdeUi.register("uiTest") {
  task {
    val uiSourceSet = sourceSets["uiTest"]
    testClassesDirs = uiSourceSet.output.classesDirs
    classpath = uiSourceSet.runtimeClasspath
    useJUnitPlatform { excludeEngines("junit-vintage") }
    dependsOn("prepareSandbox_runIde262")
    outputs.upToDateWhen { false }
    val sandboxPlugins = layout.buildDirectory.dir("sandbox").get().asFile
    systemProperty("s3.sandbox", sandboxPlugins.path)
    systemProperty("s3.ide.home", providers.gradleProperty("s3.ideHome").orElse("").get())
    systemProperty("s3.out", providers.gradleProperty("s3.out").orElse(layout.buildDirectory.dir("s3-out").get().asFile.path).get())
    systemProperty("s3.work", providers.gradleProperty("s3.work").orElse(layout.buildDirectory.dir("s3-work").get().asFile.path).get())
    systemProperty("s3.rc", rootDir.resolve("../../../spec/generated/intellij/vim-companion.ideavimrc").canonicalPath)
    for (key in listOf("s3.trials", "s3.hosts", "s3.case", "s3.toolkit", "s3.portBase")) {
      providers.gradleProperty(key).orNull?.let { systemProperty(key, it) }
    }
    systemProperty("s3.ideavim", ideavim)
    testLogging { events("failed", "passed"); showStandardStreams = true; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
  }
}
