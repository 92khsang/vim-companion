import org.gradle.process.CommandLineArgumentProvider
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
  id("org.jetbrains.kotlin.jvm") version "2.4.21"
  id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "spike.u1"
version = "0.0.1"

repositories {
  mavenCentral()
  intellijPlatform { defaultRepositories() }
}

dependencies {
  intellijPlatform {
    local(providers.gradleProperty("ideHome"))
    bundledPlugin("com.intellij.java")
    if (providers.gradleProperty("u1.theme").orNull == "One Dark") {
      plugin("com.markskelton.one-dark-theme", "6.2.2")
    }
  }
}

java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }
kotlin {
  compilerOptions {
    jvmTarget = JvmTarget.JVM_25
    apiVersion = KotlinVersion.KOTLIN_2_3
    languageVersion = KotlinVersion.KOTLIN_2_3
  }
}

intellijPlatform {
  sandboxContainer = layout.dir(providers.gradleProperty("u1.sandbox").map { file(it) })
  pluginConfiguration { ideaVersion { sinceBuild = "262" } }
  buildSearchableOptions = false
  instrumentCode = false
}

tasks.runIde {
  // The sandbox uses the legacy VFS write path to avoid progress collection before Registry is ready.
  systemProperty("idea.background.write.action.enabled", "false")
  if (providers.gradleProperty("u1.traceStartup").orNull == "true") {
    systemProperty("idea.log.trace.categories", "#com.intellij.openapi.progress.impl.TaskInfoEntityCollector")
  }
  args(providers.gradleProperty("u1.project").get())
  for (name in listOf("theme", "compact", "condition")) {
    providers.gradleProperty("u1.$name").orNull?.let { systemProperty("u1.$name", it) }
  }
  systemProperty("u1.output", providers.gradleProperty("u1.output").get())
  systemProperty("u1.data", rootDir.resolve("../gallery/data.json").canonicalPath)
  systemProperty("idea.trust.all.projects", "true")
  systemProperty("idea.initially.ask.config", "never")
  systemProperty("ide.show.tips.on.startup.default.value", "false")
  systemProperty("jb.consents.confirmation.enabled", "false")
  systemProperty("jb.privacy.policy.text", "<!--999.999-->")
  systemProperty("ide.browser.jcef.enabled", "false")
  // Product launch arguments can override systemProperties; this provider must come last.
  jvmArgumentProviders.add(CommandLineArgumentProvider { listOf("-Dawt.toolkit.name=XToolkit") })
  systemProperty("sun.java2d.uiScale", "1")
}
