package spike.s3.ui

import com.intellij.driver.client.Driver
import com.intellij.driver.sdk.openFile
import com.intellij.driver.sdk.ui.components.common.JEditorUiComponent
import com.intellij.driver.sdk.ui.components.common.codeEditor
import com.intellij.driver.sdk.ui.components.common.ideFrame
import com.intellij.driver.sdk.ui.shouldHaveFocus
import com.intellij.driver.sdk.ui.ui
import com.intellij.driver.sdk.waitForIndicators
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.io.File
import java.time.Instant
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

/** A running IDE with the spike plugin, driven through the Driver. */
class Session(val driver: Driver, val name: String) {
  val h: HarnessRemote = driver.service(HarnessRemote::class)
  lateinit var editor: JEditorUiComponent
  private val outFile = File(Env.out.toFile(), "$name.jsonl")

  fun open(file: String) {
    driver.waitForIndicators(5.minutes)
    driver.openFile(file, waitForCodeAnalysis = false)
    editor = driver.ui.ideFrame().codeEditor()
    log(J.obj("event" to "open", "file" to file, "install" to h.install(), "toolkit" to h.toolkit(), "ideavim" to h.ideaVimVersion()))
  }

  /** Gives the IDE frame X input focus with `xdotool windowfocus --sync`, then checks that the editor owns focus. */
  fun focusWindow(): String {
    val pid = h.pid()
    val ids = exec("xdotool", "search", "--onlyvisible", "--pid", pid.toString()).trim().lines().filter { it.isNotBlank() }
    val r = StringBuilder("windows=$ids")
    for (id in ids) {
      val name = exec("xdotool", "getwindowname", id).trim()
      if (name.contains("project") || ids.size == 1) {
        r.append(" focus=").append(id).append(" '").append(name).append("' ")
        r.append(exec("xdotool", "windowfocus", "--sync", id).trim())
      }
    }
    editor.click()
    Thread.sleep(500)
    r.append(" editorHasFocus=").append(h.editorHasFocus())
    log(J.obj("event" to "focus", "detail" to r.toString()))
    return r.toString()
  }

  fun exec(vararg cmd: String): String {
    val p = ProcessBuilder(*cmd).redirectErrorStream(true).start()
    val out = p.inputStream.bufferedReader().readText()
    p.waitFor()
    return out
  }

  /**
   * Sends one step and waits until the probe has logged the expected number of delivered keys, or until [timeoutMs].
   * With [checkFocus], `shouldHaveFocus()` on the editor must pass after the key.
   */
  fun send(step: Step, expectedTotal: Int, checkFocus: Boolean, timeoutMs: Long = 3000): StepResult {
    val t0 = System.nanoTime()
    when (step) {
      is Step.Type -> editor.robot.type(step.c)
      is Step.Code -> if (step.modifiers == 0) editor.robot.pressAndReleaseKey(step.keyCode) else editor.robot.pressAndReleaseKey(step.keyCode, step.modifiers)
      is Step.Ime -> h.postIme(step.steps)
      Step.WaitHost -> {
        val ok = waitUntil(timeoutMs) { h.hostShowing() }
        return StepResult(step.label, ok, h.deliveredCount(), null, ok, (System.nanoTime() - t0) / 1_000_000)
      }
    }
    var count = 0
    val delivered = waitUntil(timeoutMs) { count = h.deliveredCount(); count >= expectedTotal }
    val focusOk = if (checkFocus) runCatching { editor.shouldHaveFocus(timeout = 2.seconds); true }.getOrDefault(false) else null
    return StepResult(step.label, delivered && count == expectedTotal, count, focusOk, h.hostShowing(), (System.nanoTime() - t0) / 1_000_000)
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
    var tries = 0
    while (h.mode() != "NORMAL" || h.snapshot().let { it.contains("\"pendingKeys\":\"\"").not() || it.contains("\"mappingKeys\":\"\"").not() }) {
      editor.robot.pressAndReleaseKey(KeyEvent.VK_ESCAPE)
      Thread.sleep(50)
      if (++tries > 10) break
    }
    h.resetEditor(text, caret)
  }

  /** Closes a dialog or popup that an action opened, with `Esc`, until the editor owns focus again. */
  fun closePopups() {
    var tries = 0
    while (!h.editorHasFocus() && tries++ < 5) {
      editor.robot.pressAndReleaseKey(KeyEvent.VK_ESCAPE)
      Thread.sleep(200)
    }
  }

  fun log(line: String) {
    outFile.appendText(line + "\n")
  }

  fun now(): String = Instant.now().toString()
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
