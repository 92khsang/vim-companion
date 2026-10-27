package spike.s3.ui

import com.intellij.driver.client.Driver
import com.intellij.driver.sdk.ui.components.common.JEditorUiComponent
import com.intellij.driver.sdk.ui.components.common.codeEditor
import com.intellij.driver.sdk.ui.components.common.ideFrame
import com.intellij.driver.sdk.ui.shouldHaveFocus
import com.intellij.driver.sdk.ui.ui
import com.intellij.driver.sdk.waitForIndicators
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.net.StandardProtocolFamily
import java.net.UnixDomainSocketAddress
import java.nio.channels.Channels
import java.nio.channels.SocketChannel
import java.time.Instant
import com.intellij.driver.sdk.openFile
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/** One key or input-method step of a trial. */
sealed class Step(val label: String, val expectedKeys: Int) {
  class Type(val c: Char) : Step(if (c == ' ') "<Space>" else c.toString(), 1)
  class Code(label: String, val keyCode: Int, val modifiers: Int = 0) : Step(label, 1)

  /** Input-method events: `c:` composed text, `C:` committed text, separated by `|`. */
  class Ime(val steps: String, commits: Int) : Step("ime[$steps]", commits)

  /** Waits until the host shows, as the Driver must before it sends `Esc` in the `d Esc j` row. */
  object WaitHost : Step("wait-host", 0)

  companion object {
    val ESC = Code("<Esc>", KeyEvent.VK_ESCAPE)

    @Suppress("DEPRECATION")
    val CTRL_BRACKET = Code("<C-[>", KeyEvent.VK_OPEN_BRACKET, InputEvent.CTRL_MASK)

    @Suppress("DEPRECATION")
    val SHIFT_SPACE = Code("<S-Space>", KeyEvent.VK_SPACE, InputEvent.SHIFT_MASK)

    fun keys(s: String): List<Step> = s.map { Type(it) }
  }
}

class StepResult(
  val label: String,
  val delivered: Boolean,
  val deliveredCount: Int,
  val focusOk: Boolean?,
  val hostShowing: Boolean,
  val waitedMs: Long,
) {
  fun json() = J.obj(
    "step" to label, "delivered" to delivered, "deliveredCount" to deliveredCount, "focusOk" to focusOk,
    "hostShowing" to hostShowing, "waitedMs" to waitedMs,
  )
}

/**
 * Where keys come from: the Driver's robot (AWT, XTEST under Xvfb), the GNOME harness injector (Mutter) or the macOS
 * injector (CGEvents from an ssh session).
 */
interface Keys {
  fun press(step: Step)
  fun close() {}
}

class RobotKeys(private val editor: () -> JEditorUiComponent) : Keys {
  override fun press(step: Step) {
    val robot = editor().robot
    when (step) {
      is Step.Type -> robot.type(step.c)
      is Step.Code -> if (step.modifiers == 0) robot.pressAndReleaseKey(step.keyCode) else robot.pressAndReleaseKey(step.keyCode, step.modifiers)
      else -> error("not a key: ${step.label}")
    }
  }
}

/**
 * Keys through an injector that speaks the protocol of the GNOME harness's `inject.py serve` (`key <keysym>[+...]`,
 * answered with `ok` or `error <text>`). In the GNOME harness the injector is a child process, and the keysyms are
 * what Mutter sends from a virtual keyboard. In the `mac` mode [cmd] is `unix:<path>`, the socket of `s3keys serve`,
 * which posts the same names as CGEvents; it runs in an ssh session on the Mac, outside this JVM's launchd job,
 * because macOS grants the Accessibility permission to the programs of ssh sessions (spike S5), and it refuses every
 * key unless the sandbox IDE named with `pid` owns the frontmost app and the topmost window.
 */
class InjectorKeys(cmd: List<String>) : Keys {
  private val process: Process?
  private val channel: SocketChannel?
  private val input: BufferedWriter
  private val output: BufferedReader

  init {
    val socket = cmd.singleOrNull()?.takeIf { it.startsWith("unix:") }?.removePrefix("unix:")
    if (socket != null) {
      process = null
      channel = SocketChannel.open(StandardProtocolFamily.UNIX).also { it.connect(UnixDomainSocketAddress.of(socket)) }
      input = Channels.newOutputStream(channel).bufferedWriter()
      output = Channels.newInputStream(channel).bufferedReader()
    } else {
      process = ProcessBuilder(cmd).redirectError(ProcessBuilder.Redirect.INHERIT).start()
      channel = null
      input = process.outputStream.bufferedWriter()
      output = process.inputStream.bufferedReader()
    }
    val first = output.readLine()
    check(first == "ready") { "injector did not start: $first" }
  }

  /** Sends one command and returns what follows `ok` (empty for a bare `ok`); an `error` answer throws. */
  fun query(line: String): String {
    input.write(line)
    input.newLine()
    input.flush()
    val answer = output.readLine() ?: error("injector closed on $line")
    check(answer == "ok" || answer.startsWith("ok ")) { "injector: $answer for $line" }
    return answer.removePrefix("ok").trim()
  }

  fun command(line: String) {
    query(line)
  }

  override fun press(step: Step) {
    val chord = when (step) {
      is Step.Type -> when (step.c) {
        ' ' -> "space"
        '/' -> "slash"
        '.' -> "period"
        '[' -> "bracketleft"
        ']' -> "bracketright"
        '"' -> "Shift_L+apostrophe"
        ':' -> "Shift_L+semicolon"
        else -> if (step.c.isLetterOrDigit() && step.c.code < 128) step.c.toString() else error("no keysym for ${step.c}")
      }
      Step.ESC -> "Escape"
      Step.CTRL_BRACKET -> "Control_L+bracketleft"
      Step.SHIFT_SPACE -> "Shift_L+space"
      else -> error("not a key: ${step.label}")
    }
    command("key $chord")
  }

  override fun close() {
    runCatching { input.write("quit\n"); input.flush() }
    process?.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)
    process?.destroy()
    runCatching { channel?.close() }
  }
}

/** A running IDE with the spike plugin (or, with `s3.pluginOff`, without it), driven through the Driver. */
class Session(val driver: Driver, val name: String) {
  private val harness: HarnessRemote? = if (Env.pluginOff) null else driver.service(HarnessRemote::class)
  val h: HarnessRemote get() = harness ?: error("the spike plugin is off in this run")
  lateinit var editor: JEditorUiComponent
  val keys: Keys = if (Env.inject.isNotEmpty()) InjectorKeys(Env.inject) else RobotKeys { editor }
  private val outFile = File(Env.out.toFile(), "$name.jsonl")

  /**
   * Opens [file] as the only editor. The IDE can open a start page of its own (such as a trial page) a few seconds
   * after the project opens; it is closed so that the fixture file's editor is the one that gets the keys.
   */
  fun open(file: String) {
    driver.waitForIndicators(5.minutes)
    Thread.sleep(8000)
    val closed: String
    if (harness != null) {
      closed = harness.closeAllEditors()
      harness.openFile(file)
    } else {
      closed = RemoteState.closeAll(driver)
      driver.openFile(file, waitForCodeAnalysis = false)
    }
    Thread.sleep(1000)
    editor = driver.ui.ideFrame().codeEditor()
    log(J.obj(
      "event" to "open", "file" to file, "closed" to closed, "mode" to Env.mode, "pluginOff" to Env.pluginOff,
      "install" to harness?.install(), "toolkit" to harness?.toolkit(), "ideavim" to (harness?.ideaVimVersion() ?: Env.ideavim),
    ))
  }

  /**
   * Under Xvfb: gives the IDE frame X input focus with `xdotool windowfocus --sync`. In the GNOME harness the shell
   * focuses the new window itself; the harness only asks the IDE to focus the editor inside it if needed. On macOS the
   * injector brings the IDE to the front (`activate`, Accessibility with an NSRunningApplication fallback) and reports
   * the frontmost app and the owner of the topmost normal window; `frontIsIde` says whether both are the sandbox IDE.
   */
  fun focusWindow(): String {
    val r = StringBuilder()
    if (Env.mode == "mac") {
      val pid = harness?.pid() ?: RemoteState.pid(driver)
      val inj = keys as InjectorKeys
      inj.command("pid $pid")
      var state = ""
      var frontIsIde = false
      for (attempt in 1..5) {
        state = inj.query("activate $pid")
        val fields = state.split(' ').mapNotNull { f -> f.split('=', limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }.toMap()
        frontIsIde = fields["frontPid"] == pid.toString() && fields["topWindowPid"] == pid.toString()
        if (frontIsIde) break
        Thread.sleep(1000)
      }
      r.append("activate=").append(state).append(" frontIsIde=").append(frontIsIde)
      if (harness != null && !harness.editorHasFocus()) r.append(" focusEditor=").append(harness.focusEditor())
      Thread.sleep(500)
    } else if (Env.mode == "gnome") {
      r.append("shell=").append(shellState())
      if (harness != null && !harness.editorHasFocus()) r.append(" focusEditor=").append(harness.focusEditor())
      Thread.sleep(500)
    } else {
      val pid = harness?.pid() ?: RemoteState.pid(driver)
      val ids = exec("xdotool", "search", "--onlyvisible", "--pid", pid.toString()).trim().lines().filter { it.isNotBlank() }
      r.append("windows=").append(ids)
      for (id in ids) {
        val name = exec("xdotool", "getwindowname", id).trim()
        if (name.contains("project") || ids.size == 1) {
          r.append(" focus=").append(id).append(" '").append(name).append("' ")
          r.append(exec("xdotool", "windowfocus", "--sync", id).trim())
        }
      }
      editor.click()
      Thread.sleep(500)
    }
    r.append(" editorHasFocus=").append(harness?.editorHasFocus() ?: runCatching { editor.shouldHaveFocus(timeout = 2.seconds); true }.getOrDefault(false))
    if (harness != null) r.append(" windows=").append(harness.windows())
    log(J.obj("event" to "focus", "detail" to r.toString()))
    return r.toString()
  }

  /** IBus global engine changes seen by the harness's ibus-monitor.py, as `<monotonic-ns> <engine>` lines. */
  val ibusEvents: MutableList<String> = java.util.Collections.synchronizedList(ArrayList())
  private val ibusMonitor: Process? = if (Env.ibusMonitor.isEmpty()) null else
    ProcessBuilder(Env.ibusMonitor).redirectError(ProcessBuilder.Redirect.DISCARD).start().also { p ->
      Thread {
        p.inputStream.bufferedReader().forEachLine { ibusEvents += it }
      }.apply { isDaemon = true; start() }
    }

  fun ibus(vararg args: String): String = if (Env.ibusCmd.isEmpty()) "" else exec(*(Env.ibusCmd + args).toTypedArray()).trim()

  /**
   * Puts the input method into ibus-hangul's Hangul mode, as a user would: the engine back to `hangul` if something
   * switched it, then `Shift+Space` (ibus-hangul's switch key, which it consumes) until the shell shows 한.
   * Returns the shell state afterwards.
   */
  fun ensureHangulMode(): String {
    if (ibus("engine") != "hangul") ibus("engine", "hangul")
    var state = shellState()
    var tries = 0
    while (!state.contains("\"symbol\":\"한\"") && tries++ < 3) {
      keys.press(Step.SHIFT_SPACE)
      Thread.sleep(150)
      state = shellState()
    }
    return state
  }

  /** The GNOME harness's view: input source, ibus-hangul InputMode label, focused window. Empty under Xvfb. */
  fun shellState(): String = if (Env.shellState.isEmpty()) "" else exec(*Env.shellState.toTypedArray()).trim()

  fun exec(vararg cmd: String): String {
    val p = ProcessBuilder(*cmd).redirectErrorStream(true).start()
    val out = p.inputStream.bufferedReader().readText()
    p.waitFor()
    return out
  }

  /**
   * Sends one step and waits until the probe has logged the expected number of delivered keys, or until [timeoutMs].
   * With [checkFocus], `shouldHaveFocus()` on the editor must pass after the key. Without the spike plugin there is no
   * probe; the step then waits [timeoutMs] for the IDE to settle.
   */
  fun send(step: Step, expectedTotal: Int, checkFocus: Boolean, timeoutMs: Long = 3000): StepResult {
    val t0 = System.nanoTime()
    when (step) {
      is Step.Ime -> if (harness != null) harness.postIme(step.steps) else RemoteState.postIme(driver, step.steps)
      Step.WaitHost -> {
        val ok = waitUntil(timeoutMs) { h.hostShowing() }
        return StepResult(step.label, ok, h.deliveredCount(), null, ok, (System.nanoTime() - t0) / 1_000_000)
      }
      else -> keys.press(step)
    }
    if (harness == null) {
      Thread.sleep(timeoutMs)
      return StepResult(step.label, true, -1, null, false, (System.nanoTime() - t0) / 1_000_000)
    }
    var count = 0
    val delivered = waitUntil(timeoutMs) { count = harness.deliveredCount(); count >= expectedTotal }
    val focusOk = if (checkFocus) runCatching { editor.shouldHaveFocus(timeout = 2.seconds); true }.getOrDefault(false) else null
    return StepResult(step.label, delivered && count == expectedTotal, count, focusOk, harness.hostShowing(), (System.nanoTime() - t0) / 1_000_000)
  }

  fun waitUntil(timeoutMs: Long, cond: () -> Boolean): Boolean {
    val end = System.nanoTime() + timeoutMs * 1_000_000
    while (true) {
      if (cond()) return true
      if (System.nanoTime() > end) return false
      Thread.sleep(5)
    }
  }

  /** Returns IdeaVim to Normal mode with real `Esc` keys and resets the text and caret. */
  fun reset(text: String, caret: Int) {
    if (harness == null) {
      repeat(2) { keys.press(Step.ESC); Thread.sleep(100) }
      RemoteState.reset(driver, text, caret)
      return
    }
    var tries = 0
    while (harness.mode() != "NORMAL" || harness.snapshot().let { it.contains("\"pendingKeys\":\"\"").not() || it.contains("\"mappingKeys\":\"\"").not() }) {
      keys.press(Step.ESC)
      Thread.sleep(50)
      if (++tries > 10) break
    }
    harness.resetEditor(text, caret)
  }

  /**
   * Closes a dialog or popup that an action opened, with `Esc`, until the editor owns focus again. Under Xvfb there is
   * no window manager to give the IDE frame the X input focus back when such a window closes (`SPC /` opens Find in
   * Path): Java's focus owner then stays null and later keys reach nothing. The harness then does what a window
   * manager does and focuses the frame again ([focusWindow]), and logs a `refocus` event before the `focus` event.
   */
  fun closePopups() {
    var tries = 0
    val focused = { harness?.editorHasFocus() ?: runCatching { editor.shouldHaveFocus(timeout = 300.milliseconds); true }.getOrDefault(false) }
    while (!focused() && tries++ < 5) {
      keys.press(Step.ESC)
      Thread.sleep(200)
    }
    if (Env.mode == "xvfb" && !focused()) {
      log(J.obj("event" to "refocus", "reason" to "the editor has no focus after closing popups"))
      focusWindow()
    }
  }

  /** Whether the editor owns the keyboard focus: the probe's answer, or the Driver's check without the spike plugin. */
  fun editorFocused(): Boolean =
    harness?.editorHasFocus() ?: runCatching { editor.shouldHaveFocus(timeout = 2.seconds); true }.getOrDefault(false)

  fun log(line: String) {
    outFile.appendText(line + "\n")
  }

  fun now(): String = Instant.now().toString()

  fun close() {
    keys.close()
    ibusMonitor?.destroy()
  }
}

/** JSON writer for the test side. */
object J {
  fun str(s: String?): String = if (s == null) "null" else buildString {
    append('"')
    for (c in s) when {
      c == '"' -> append("\\\"")
      c == '\\' -> append("\\\\")
      c == '\n' -> append("\\n")
      c < ' ' -> append(String.format("\\u%04x", c.code))
      else -> append(c)
    }
    append('"')
  }

  class Raw(val text: String)

  fun value(v: Any?): String = when (v) {
    null -> "null"
    is Raw -> v.text
    is String -> str(v)
    is Boolean, is Int, is Long -> v.toString()
    is Iterable<*> -> v.joinToString(",", "[", "]") { value(it) }
    else -> str(v.toString())
  }

  fun obj(vararg pairs: Pair<String, Any?>): String = pairs.joinToString(",", "{", "}") { (k, v) -> str(k) + ":" + value(v) }
}
