package spike.s3.ui

import com.intellij.driver.client.Remote
import com.intellij.driver.client.impl.DriverImpl
import com.intellij.driver.client.impl.JmxHost
import com.intellij.ide.starter.coroutine.CommonScope.scopeForProcesses
import com.intellij.ide.starter.di.di
import com.intellij.ide.starter.driver.engine.BackgroundRun
import com.intellij.ide.starter.ide.IDETestContext
import com.intellij.ide.starter.ide.IdeDistributionFactory
import com.intellij.ide.starter.ide.IdeInstaller
import com.intellij.ide.starter.ide.InstalledIde
import com.intellij.ide.starter.models.IdeInfo
import com.intellij.ide.starter.models.TestCase
import com.intellij.ide.starter.path.GlobalPaths
import com.intellij.ide.starter.project.LocalProjectInfo
import com.intellij.ide.starter.runner.IDEHandle
import com.intellij.ide.starter.runner.Starter
import com.intellij.ide.starter.runner.events.IdeLaunchEvent
import com.intellij.tools.ide.starter.bus.EventsBus
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.kodein.di.DI
import org.kodein.di.bindSingleton
import org.kodein.di.direct
import org.kodein.di.instance
import java.net.InetAddress
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.Path
import kotlin.io.path.absolutePathString
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.isDirectory
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.writeText
import kotlin.time.Duration
import kotlin.time.Duration.Companion.hours

/** Settings of one end-to-end run, from system properties set by the Gradle `uiTest` task. */
object Env {
  private fun prop(k: String) = System.getProperty(k)?.takeIf { it.isNotBlank() }

  val out: Path = Path(prop("s3.out") ?: error("s3.out")).createDirectories()
  val work: Path = Path(prop("s3.work") ?: error("s3.work")).createDirectories()
  val ideHome: Path = Path(prop("s3.ide.home") ?: error("s3.ide.home: path of the IntelliJ IDEA 2026.2.3 installation"))
  val sandbox: Path = Path(prop("s3.sandbox") ?: error("s3.sandbox"))
  val rc: Path = Path(prop("s3.rc") ?: error("s3.rc"))
  val ideavim: String = prop("s3.ideavim") ?: "?"
  val trials: Int = (prop("s3.trials") ?: "10").toInt()
  val hosts: List<String> = (prop("s3.hosts") ?: "balloon,layer").split(',').map { it.trim() }.filter { it.isNotEmpty() }
  val case: String = prop("s3.case") ?: "smoke"
  val toolkit: String = prop("s3.toolkit") ?: "XToolkit"

  /** First of three ports for JMX, RMI and the IDE's web server. */
  val portBase: Int = (prop("s3.portBase") ?: "9531").toInt()
  val display: String? = System.getenv("DISPLAY")

  /** "xvfb" (Driver robot keys under Xvfb) or "gnome" (keys from the GNOME harness injector). */
  val mode: String = prop("s3.mode") ?: "xvfb"

  /** Command that starts the GNOME harness key injector in serve mode, split on spaces. */
  val inject: List<String> = prop("s3.inject")?.split(' ') ?: emptyList()

  /** Command that prints the GNOME harness state JSON, split on spaces. */
  val shellState: List<String> = prop("s3.shellState")?.split(' ') ?: emptyList()

  /** Command that prints IBus global engine changes (gnome-harness ibus-monitor.py), split on spaces. */
  val ibusMonitor: List<String> = prop("s3.ibusMonitor")?.split(' ') ?: emptyList()

  /** The harness's `ibus` command, split on spaces; arguments are appended. */
  val ibusCmd: List<String> = prop("s3.ibusCmd")?.split(' ') ?: emptyList()

  /** Extra lines appended to the sandbox ideavimrc, separated by `|`, e.g. `set keep-english-in-normal`. */
  val rcExtra: List<String> = prop("s3.rcExtra")?.split('|')?.filter { it.isNotBlank() } ?: emptyList()

  /** Plugin directories or archives to install besides IdeaVim and the spike plugin, separated by spaces. */
  val extraPlugins: List<String> = prop("s3.extraPlugins")?.split(' ')?.filter { it.isNotBlank() } ?: emptyList()

  /** When true, the spike plugin is not installed: the reference runs "with the spike plugin off". */
  val pluginOff: Boolean = prop("s3.pluginOff") == "true"
  val versionTag: String = ideavim.substringAfter(':').substringBefore('@')
}

/** Keeps Starter's working files under the spike's work directory. */
class S3Paths : GlobalPaths(Env.work)

/**
 * Uses the IntelliJ IDEA 2026.2.3 installation that the Gradle build already unpacked. It is copied once into the work
 * directory, because Starter writes a `.vmoptions` file next to the installation.
 */
class CopiedIdeInstaller(private val source: Path) : IdeInstaller {
  override suspend fun install(ideInfo: IdeInfo): Pair<String, InstalledIde> {
    val parent = Env.work.resolve("ide").createDirectories()
    val dest = parent.resolve(source.name)
    if (!dest.resolve("build.txt").exists()) {
      val p = ProcessBuilder("cp", "-a", source.absolutePathString(), parent.absolutePathString()).inheritIO().start()
      check(p.waitFor() == 0) { "copy of the IDE failed" }
    }
    val build = Files.readString(dest.resolve("build.txt")).trim().substringAfter('-')
    return build to di.direct.instance<IdeDistributionFactory>().installIDE(parent, ideInfo.executableFileName)
  }
}

@Remote("spike.s3.Harness", plugin = "spike.s3")
interface HarnessRemote {
  fun install(): String
  fun setHost(name: String, enabled: Boolean): String
  fun beginTrial(): String
  fun hostShowing(): Boolean
  fun deliveredCount(): Int
  fun deliveredKeys(): String
  fun pid(): Long
  fun toolkit(): String
  fun ideaVimVersion(): String
  fun ideaVimEnabled(): Boolean
  fun focusOwner(): String
  fun editorHasFocus(): Boolean
  fun editorText(): String
  fun caretOffset(): Int
  fun caretLine(): Int
  fun mode(): String
  fun snapshot(): String
  fun resetEditor(text: String, caret: Int): String
  fun postIme(steps: String): String
  fun report(): String
  fun errorCount(): Int
  fun openFile(relativePath: String): String
  fun closeAllEditors(): String
  fun focusEditor(): String
  fun vimMode(): String
  fun windows(): String
}

object S3Ide {
  init {
    di = DI {
      extend(di)
      bindSingleton<GlobalPaths>(overrides = true) { S3Paths() }
    }
  }

  private fun pluginDirs(): Pair<Path, Path> {
    val sandboxPlugins = Files.walk(Env.sandbox, 4).use { s ->
      s.filter { it.isDirectory() && it.name == "plugins_runIde262" }.findFirst().orElseThrow { error("no plugins_runIde262 in ${Env.sandbox}") }
    }
    return sandboxPlugins.resolve("IdeaVIM") to sandboxPlugins.resolve("s3-spike")
  }

  /** A directory project with the files that the runs edit. */
  fun project(): Path {
    val dir = Env.work.resolve("project").createDirectories()
    dir.resolve("fixture.txt").writeText("line one\nline two\nline three\nline four\nline five\nline six\n")
    dir.resolve("Reformat.java").writeText("class Reformat {\nint   a=1;\n  void f( ){int b =2 ;}\n}\n")
    dir.resolve("Errors.java").writeText("class Errors {\n  void f() {\n    int a = ;\n    int b = ;\n  }\n}\n")
    return dir
  }

  fun context(name: String): IDETestContext {
    val (ideavimDir, spikeDir) = pluginDirs()
    val info = IdeInfo(
      productCode = "IU", platformPrefix = "idea", executableFileName = "idea", fullName = "IntelliJ IDEA",
      getInstaller = { CopiedIdeInstaller(Env.ideHome) },
    )
    val home = Env.work.resolve("home").createDirectories()
    val rcDir = Env.work.resolve("rc").createDirectories()
    val rc = rcDir.resolve("ideavimrc")
    rc.writeText((listOf("source ${Env.rc.absolutePathString()}") + Env.rcExtra).joinToString("\n", postfix = "\n"))
    val ctx = Starter.newContext(name, TestCase(info, LocalProjectInfo(project())))
    // Credentials stay in memory: the IDE never asks a Secret Service (keyring) for anything.
    ctx.setProviderMemoryOnlyOnLinux()
    // No notification balloons: under a window manager they can open windows of their own that take focus.
    ctx.paths.configDir.resolve("options").createDirectories().resolve("notifications.xml")
      .writeText("<application>\n  <component name=\"NotificationConfiguration\" showBalloons=\"false\" />\n</application>\n")
    ctx.pluginConfigurator.installPluginFromDir(ideavimDir)
    if (!Env.pluginOff) ctx.pluginConfigurator.installPluginFromDir(spikeDir)
    for (extra in Env.extraPlugins) {
      val path = Path(extra)
      if (path.isDirectory()) ctx.pluginConfigurator.installPluginFromDir(path) else ctx.pluginConfigurator.installPluginFromPath(path)
    }
    ctx.applyVMOptionsPatch {
      // Isolation from the user's IDE and settings: own user.home and ideavimrc. Under Xvfb the IDE also gets its own
      // HOME and XDG directories; in the GNOME harness it keeps the harness's, which are already private, because
      // IBus and the ibus command find the harness's IBus through them.
      addSystemProperty("user.home", home)
      if (Env.mode != "gnome") {
        withEnv("HOME", home.absolutePathString())
        withEnv("XDG_CONFIG_HOME", home.resolve(".config").createDirectories().absolutePathString())
        withEnv("XDG_DATA_HOME", home.resolve(".local/share").createDirectories().absolutePathString())
        withEnv("XDG_CACHE_HOME", home.resolve(".cache").createDirectories().absolutePathString())
        Env.display?.let { withEnv("DISPLAY", it) }
      }
      withEnv("IDEA_VIM_CUSTOM_VIMRC", rc.absolutePathString())
      addSystemProperty("awt.toolkit.name", Env.toolkit)
      addSystemProperty("idea.trust.all.projects", true)
      // No embedded browser (JCEF): it would ask a Secret Service for a key and the IDE does not need it here.
      addSystemProperty("ide.browser.jcef.enabled", false)
      addSystemProperty("ide.show.tips.on.startup.default.value", false)
      addSystemProperty("jb.consents.confirmation.enabled", false)
      addSystemProperty("jb.privacy.policy.text", "<!--999.999-->")
      addSystemProperty("idea.initially.ask.config", "never")
      addLine("-Xmx2g", "-Xmx")
    }
    return ctx
  }

  /**
   * Like Starter's local driver runner, but with the JMX, RMI and web-server ports taken from this spike's port range
   * instead of Starter's defaults.
   */
  fun run(ctx: IDETestContext, runTimeout: Duration = 12.hours): BackgroundRun {
    val host = InetAddress.getLoopbackAddress()
    val jmx = Env.portBase
    val rmi = Env.portBase + 1
    val web = Env.portBase + 2
    val props = mapOf(
      "java.rmi.server.hostname" to host.hostAddress,
      "com.sun.management.jmxremote.host" to host.hostAddress,
      "com.sun.management.jmxremote" to "true",
      "com.sun.management.jmxremote.port" to jmx.toString(),
      "com.sun.management.jmxremote.rmi.port" to rmi.toString(),
      "com.sun.management.jmxremote.authenticate" to "false",
      "com.sun.management.jmxremote.ssl" to "false",
      "com.sun.management.jmxremote.serial.filter.pattern" to "'java.**;javax.**;com.intellij.driver.model.**'",
      "expose.ui.hierarchy.url" to "true",
      "platform.experiment.ab.manual.option" to "control.option",
      "rpc.port" to web.toString(),
    )
    val driver = DriverImpl(JmxHost(address = "${host.hostAddress}:$jmx"), isRemDevMode = false)
    val process = CompletableDeferred<IDEHandle>()
    EventsBus.subscribeOnce(process) { event: IdeLaunchEvent -> process.complete(event.ideProcess) }
    val result = scopeForProcesses.async {
      try {
        ctx.runIdeSuspending(runTimeout = runTimeout) {
          addVMOptionsPatch { for ((k, v) in props) addSystemProperty(k, v) }
        }
      } catch (e: Throwable) {
        process.completeExceptionally(e)
        throw e
      }
    }
    return runBlocking { BackgroundRun(result, driver, process.await()) }
  }
}
