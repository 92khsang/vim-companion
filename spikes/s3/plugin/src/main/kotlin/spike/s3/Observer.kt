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
) {
  fun json() = Json.obj(
    "mode" to mode, "pendingKeys" to pendingKeys, "mappingKeys" to mappingKeys, "count" to count,
    "register" to register, "registerPending" to registerPending, "awaiting" to awaiting,
    "executingMap" to executingMap, "recording" to recording, "executingMacro" to executingMacro,
    "dotRepeat" to dotRepeat,
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
  private var seq = 0L
  private var lastEditor: Editor? = null
  private var lastPolled: Snapshot? = null
  private var poller: Timer? = null

  fun clear() {
    records.clear()
    dotReplayEvents.clear()
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

  fun afterKey(editor: Editor?, trigger: String) {
    if (editor == null || editor.isDisposed) return
    lastEditor = editor
    val s = read(editor)
    lastPolled = s
    record(editor, trigger, s)
  }

  fun beforeOtherAction(action: AnAction, event: AnActionEvent) {
    if (injector.vimState.isDotRepeatInProgress) {
      dotReplayEvents += "action:" + (event.actionManager.getId(action) ?: action.javaClass.name) +
        " hostShowing=" + host.showing
      if (host.showing) host.hide()
    }
  }

  fun onDocumentChanged() {
    if (injector.vimState.isDotRepeatInProgress) {
      dotReplayEvents += "document hostShowing=" + host.showing
      if (host.showing) host.hide()
    }
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
