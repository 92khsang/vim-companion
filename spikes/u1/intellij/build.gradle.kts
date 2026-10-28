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
  args(providers.gradleProperty("u1.project").get())
  systemProperty("u1.output", providers.gradleProperty("u1.output").get())
  systemProperty("u1.data", rootDir.resolve("../gallery/data.json").canonicalPath)
  systemProperty("idea.trust.all.projects", "true")
  systemProperty("idea.initially.ask.config", "never")
  systemProperty("ide.show.tips.on.startup.default.value", "false")
  systemProperty("jb.consents.confirmation.enabled", "false")
  systemProperty("jb.privacy.policy.text", "<!--999.999-->")
  systemProperty("ide.browser.jcef.enabled", "false")
  systemProperty("awt.toolkit.name", "XToolkit")
  systemProperty("sun.java2d.uiScale", "1")
}
