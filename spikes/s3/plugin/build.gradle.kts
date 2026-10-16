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
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.opentest4j:opentest4j:1.3.0")
}

intellijPlatform {
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
