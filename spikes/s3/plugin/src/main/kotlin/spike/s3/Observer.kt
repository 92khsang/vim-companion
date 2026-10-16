package spike.s3

import com.intellij.ide.IdeEventQueue
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.ui.popup.StackingPopupDispatcher
import com.maddyhome.idea.vim.KeyHandler
import com.maddyhome.idea.vim.api.injector
import com.maddyhome.idea.vim.newapi.vim
import com.maddyhome.idea.vim.state.mode.Mode
import com.maddyhome.idea.vim.state.mode.SelectionType
import java.awt.KeyboardFocusManager
import java.util.Collections
import javax.swing.KeyStroke
import javax.swing.Timer

/**
 * IdeaVim state as the observer reads it. Every field is read through IdeaVim's own state objects; nothing is
 * inferred from the keys.
 */
data class Snapshot(
  val mode: String,
  /** Keys of the command being built, as IdeaVim shows them for 'showcmd'. */
  val pendingKeys: String,
  /** Keys held by the mapping processor while it waits for the rest of a mapping. */
  val mappingKeys: String,
  val count: Int,
  val register: Char?,
  val registerPending: Boolean,
  /** The argument type the command waits for, or null. */
  val awaiting: String?,
  val executingMap: Boolean,
  val recording: Char?,
  val executingMacro: Boolean,
  val dotRepeat: Boolean,
  /** The state in the shared grammar-fixture format of spike S2, plus the observer fields of spike S3. */
  val fixture: FixtureState,
) {
  fun json() = Json.obj(
    "mode" to mode, "pendingKeys" to pendingKeys, "mappingKeys" to mappingKeys, "count" to count,
    "register" to register, "registerPending" to registerPending, "awaiting" to awaiting,
    "executingMap" to executingMap, "recording" to recording, "executingMacro" to executingMacro,
    "dotRepeat" to dotRepeat, "fixture" to Json.Raw(fixture.json()),
  )

  /** T1 stays silent while a macro, `.`, a mapping or a prompt runs. */
  val silent: Boolean
    get() = executingMacro || dotRepeat || executingMap || recording != null || mode.startsWith("CMD_LINE")

  /** Something is pending that a hint would describe. */
  val pending: Boolean
    get() = mappingKeys.isNotEmpty() || pendingKeys.isNotEmpty() || mode == "OP_PENDING" || registerPending

  fun hintText(): String = buildString {
    append(mode)
    if (mappingKeys.isNotEmpty()) append("  map ").append(mappingKeys)
    if (pendingKeys.isNotEmpty()) append("  cmd ").append(pendingKeys)
    if (count > 0) append("  count ").append(count)
    if (register != null) append("  reg ").append(register)
    if (awaiting != null) append("  wait ").append(awaiting)
  }
}

/**
 * One engine state in the grammar-fixture format (`spec/schema/fixture-grammar.schema.json` on the S2 branch):
 * mode, pending keys, operator, count and register; plus [prompt] and [recording] for the states in which T1 stays
 * silent. Mode `cmdline` is outside the S2 format; it is the observer extension for the `:` and `/` prompts.
 */
data class FixtureState(
  val mode: String,
  val pending: List<String>,
  val operator: String?,
  val count: Int?,
  val register: String?,
  val prompt: String?,
  val recording: String?,
) {
  fun json() = Json.obj(
    "mode" to mode, "pending" to pending, "operator" to operator, "count" to count, "register" to register,
    "prompt" to prompt, "recording" to recording,
  )

  companion object {
    /** A key in the fixture's notation: a printable ASCII character, or `<Esc>`, `<Space>`, `<C-x>` and the like. */
    fun key(ks: KeyStroke): String {
      val ctrl = ks.modifiers and (java.awt.event.InputEvent.CTRL_DOWN_MASK or java.awt.event.InputEvent.CTRL_MASK) != 0
      val c = ks.keyChar
      if (c != java.awt.event.KeyEvent.CHAR_UNDEFINED) {
        return when {
          c == ' ' -> "<Space>"
          c == '\u001b' -> "<Esc>"
          c == '\n' || c == '\r' -> "<CR>"
          c == '\t' -> "<Tab>"
          c == '\b' -> "<BS>"
          c.code in 1..26 -> "<C-" + ('a' + (c.code - 1)) + ">"
          c.code == 27 -> "<C-[>"
          c.code == 29 -> "<C-]>"
          else -> c.toString()
        }
      }
      return when (ks.keyCode) {
        java.awt.event.KeyEvent.VK_ESCAPE -> "<Esc>"
        java.awt.event.KeyEvent.VK_ENTER -> "<CR>"
        java.awt.event.KeyEvent.VK_TAB -> "<Tab>"
        java.awt.event.KeyEvent.VK_BACK_SPACE -> "<BS>"
        java.awt.event.KeyEvent.VK_SPACE -> "<Space>"
        java.awt.event.KeyEvent.VK_OPEN_BRACKET -> if (ctrl) "<C-[>" else "["
        java.awt.event.KeyEvent.VK_CLOSE_BRACKET -> if (ctrl) "<C-]>" else "]"
        in java.awt.event.KeyEvent.VK_A..java.awt.event.KeyEvent.VK_Z ->
          if (ctrl) "<C-" + ('a' + (ks.keyCode - java.awt.event.KeyEvent.VK_A)) + ">" else ('a' + (ks.keyCode - java.awt.event.KeyEvent.VK_A)).toString()
        else -> injector.parser.toKeyNotation(ks)
      }
    }

    /**
     * The operator's keys in an operator-pending command, from the typed keys: register selections (`"x`) and the
     * count come first, then the operator, which is two keys when it starts with `g` or `z` (`g~`, `gu`, `zf`, ...).
     */
    fun operator(keys: List<String>): String? {
      var i = 0
      while (i < keys.size) {
        val k = keys[i]
        when {
          k == "\"" && i + 1 < keys.size -> i += 2
          k.length == 1 && k[0] in '1'..'9' -> {
            i++
            while (i < keys.size && keys[i].length == 1 && keys[i][0].isDigit()) i++
          }
          else -> break
        }
      }
      if (i >= keys.size) return null
      return if ((keys[i] == "g" || keys[i] == "z") && i + 1 < keys.size) keys[i] + keys[i + 1] else keys[i]
    }
  }
}

object Observer {
  data class Record(
    val seq: Long,
    val tNanos: Long,
    val trigger: String,
    val snapshot: Snapshot,
    val focusOwnerIsEditor: Boolean,
    val focusOwner: String,
    val popupStack: Int,
    val popupActive: Boolean?,
    val hostShowing: Boolean,
    val hostAction: String,
  ) {
    fun json() = Json.obj(
      "seq" to seq, "t" to tNanos, "trigger" to trigger, "snapshot" to Json.Raw(snapshot.json()),
      "focusOwnerIsEditor" to focusOwnerIsEditor, "focusOwner" to focusOwner, "popupStack" to popupStack,
      "popupActive" to popupActive, "hostShowing" to hostShowing, "hostAction" to hostAction,
    )
  }

  @Volatile
  var host: HintHost = NoHost

  /** When false, the observer still records but never shows the host. Used for the runs with the plugin "off". */
  @Volatile
  var enabled = true

  val records: MutableList<Record> = Collections.synchronizedList(ArrayList())

  /** Snapshots taken while `.` was replaying, from action and document events. */
  val dotReplayEvents: MutableList<String> = Collections.synchronizedList(ArrayList())

  /**
   * Action and document events that happened while T1 must stay silent: a `.` replay, a macro replay or a mapping in
   * progress. Each entry names the states, the event and whether the host showed at that moment.
   */
  val silentEvents: MutableList<String> = Collections.synchronizedList(ArrayList())
  private var seq = 0L
  private var lastEditor: Editor? = null
  private var lastPolled: Snapshot? = null
  private var poller: Timer? = null

  fun clear() {
    records.clear()
    dotReplayEvents.clear()
    silentEvents.clear()
    lastPolled = null
  }

  /** T1 polls every 100 ms to catch a mapping timeout that replays keys without a new key event. */
  fun startPolling() {
    if (poller != null) return
    poller = Timer(100) {
      val editor = lastEditor ?: return@Timer
      if (editor.isDisposed) return@Timer
      val s = read(editor)
      if (s != lastPolled) {
        lastPolled = s
        record(editor, "poll", s)
      }
    }.apply { isRepeats = true; start() }
  }

  fun stopPolling() {
    poller?.stop()
    poller = null
  }

  /**
   * Called after each key that IdeaVim got through an IDE entry point. A key typed into IdeaVim's command line (`:`
   * or `/`) has no editor in its data context; the observer then reads the editor of the previous key.
   */
  fun afterKey(eventEditor: Editor?, trigger: String) {
    val editor = eventEditor?.takeUnless { it.isDisposed } ?: lastEditor?.takeUnless { it.isDisposed } ?: return
    lastEditor = editor
    val s = read(editor)
    lastPolled = s
    record(editor, trigger, s)
  }

  fun beforeOtherAction(action: AnAction, event: AnActionEvent) {
    val what = "action:" + (event.actionManager.getId(action) ?: action.javaClass.name)
    if (dotRunning()) {
      dotReplayEvents += "$what hostShowing=" + host.showing
    }
    silent(what)
  }

  fun onDocumentChanged() {
    if (dotRunning()) {
      dotReplayEvents += "document hostShowing=" + host.showing
    }
    silent("document")
  }

  private fun dotRunning(): Boolean = injector.vimState.isDotRepeatInProgress ||
    Thread.currentThread().stackTrace.any { it.className == "com.maddyhome.idea.vim.action.change.RepeatChangeAction" }

  /** Records a silent state seen during an event and hides the host, which must show nothing while it lasts. */
  private fun silent(what: String) {
    // IdeaVim 2.47.3 sets isDotRepeatInProgress while `.` runs; the 2.48 EAP replays the keys of the last change
    // through the key handler instead and sets it only for extension handlers, so `.` is also recognised by
    // IdeaVim's repeat action on the stack. The entry names which signal saw it: dot(flag), dot(stack) or both.
    val flag = injector.vimState.isDotRepeatInProgress
    val stack = Thread.currentThread().stackTrace.any { it.className == "com.maddyhome.idea.vim.action.change.RepeatChangeAction" }
    val states = buildList {
      if (flag || stack) add("dot")
      if (injector.macro.isExecutingMacro) add("macro")
      if (KeyHandler.getInstance().keyHandlerState.mappingState.isExecutingMap()) add("mapping")
    }
    if (states.isEmpty()) return
    val dotSignal = if (flag || stack) " dot(" + listOfNotNull("flag".takeIf { flag }, "stack".takeIf { stack }).joinToString(",") + ")" else ""
    silentEvents += states.joinToString("+") + " " + what + dotSignal + " t=" + System.nanoTime() + " hostShowing=" + host.showing
    if (host.showing) host.hide()
  }

  private fun record(editor: Editor, trigger: String, s: Snapshot) {
    val action = drive(editor, s)
    val owner = KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner
    records += Record(
      seq++, System.nanoTime(), trigger, s,
      owner === editor.contentComponent, Probe.describe(owner),
      popupStackSize(), popupActive(), host.showing, action,
    )
  }

  private fun drive(editor: Editor, s: Snapshot): String {
    val h = host
    if (!enabled || h === NoHost) return "none"
    return when {
      s.silent || !s.pending -> if (h.showing) { h.hide(); "hide" } else "none"
      h.showing -> { h.update(s.hintText()); "update" }
      else -> { h.show(editor, s.hintText()); "show" }
    }
  }

  fun read(editor: Editor): Snapshot {
    val ks = KeyHandler.getInstance().keyHandlerState
    val cb = ks.commandBuilder
    val ms = ks.mappingState
    val reg = injector.registerGroup
    return Snapshot(
      mode = modeName(editor.vim.mode),
      pendingKeys = notation(cb.keys.toList()),
      mappingKeys = notation(ms.keys.toList()),
      count = cb.calculateCount0Snapshot(),
      register = cb.registerSnapshot,
      registerPending = cb.isRegisterPending,
      awaiting = if (cb.isAwaitingArgument) cb.expectedArgumentType?.name else null,
      executingMap = ms.isExecutingMap(),
      recording = if (reg.isRecording) reg.recordRegister else null,
      executingMacro = injector.macro.isExecutingMacro,
      dotRepeat = injector.vimState.isDotRepeatInProgress,
      fixture = fixtureState(editor.vim.mode, cb.keys.toList() + ms.keys.toList(), cb.calculateCount0Snapshot(), cb.registerSnapshot, reg),
    )
  }

  private fun fixtureState(
    m: Mode, pendingKeys: List<javax.swing.KeyStroke>, count0: Int, register: Char?,
    reg: com.maddyhome.idea.vim.register.VimRegisterGroup,
  ): FixtureState {
    val keys = pendingKeys.map { FixtureState.key(it) }
    val mode = when (m) {
      is Mode.NORMAL, is Mode.OP_PENDING -> "normal"
      is Mode.INSERT -> "insert"
      is Mode.REPLACE -> "replace"
      is Mode.VISUAL -> when (m.selectionType) {
        SelectionType.CHARACTER_WISE -> "visual"
        SelectionType.LINE_WISE -> "visual-line"
        SelectionType.BLOCK_WISE -> "visual-block"
      }
      is Mode.SELECT -> "select"
      is Mode.CMD_LINE -> "cmdline"
      else -> m.javaClass.simpleName
    }
    return FixtureState(
      mode = mode,
      pending = keys,
      operator = if (m is Mode.OP_PENDING) FixtureState.operator(keys) else null,
      count = if (count0 > 0) count0 else null,
      register = register?.toString(),
      prompt = if (m is Mode.CMD_LINE) injector.commandLine.getActiveCommandLine()?.getLabel() else null,
      recording = if (reg.isRecording) reg.recordRegister?.toString() else null,
    )
  }

  /** IdeaVim writes an empty key list as `<Nop>`; the snapshot uses an empty string. */
  private fun notation(keys: List<javax.swing.KeyStroke>): String = if (keys.isEmpty()) "" else injector.parser.toKeyNotation(keys)

  fun modeName(m: Mode): String = when (m) {
    is Mode.NORMAL -> "NORMAL"
    is Mode.OP_PENDING -> "OP_PENDING"
    is Mode.VISUAL -> "VISUAL_" + sel(m.selectionType)
    is Mode.SELECT -> "SELECT_" + sel(m.selectionType)
    is Mode.INSERT -> "INSERT"
    is Mode.REPLACE -> "REPLACE"
    is Mode.CMD_LINE -> "CMD_LINE"
    else -> m.javaClass.simpleName
  }

  private fun sel(t: SelectionType) = when (t) {
    SelectionType.CHARACTER_WISE -> "CHAR"
    SelectionType.LINE_WISE -> "LINE"
    SelectionType.BLOCK_WISE -> "BLOCK"
  }

  /** Popups in IntelliJ's global popup stack, the stack that gets `Esc` before the editor. */
  fun popupStackSize(): Int = try {
    StackingPopupDispatcher.getInstance().popupStream.count().toInt()
  } catch (t: Throwable) {
    -1
  }

  /** `IdePopupManager.isPopupActive()`, which IdeEventQueue asks before it dispatches a key. Package-private. */
  fun popupActive(): Boolean? = try {
    val pm = IdeEventQueue.getInstance().popupManager
    val m = pm.javaClass.getDeclaredMethod("isPopupActive")
    m.isAccessible = true
    m.invoke(pm) as Boolean
  } catch (t: Throwable) {
    null
  }
}
