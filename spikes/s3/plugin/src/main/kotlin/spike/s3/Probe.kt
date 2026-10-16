package spike.s3

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.AnActionResult
import com.intellij.openapi.actionSystem.ActionWithDelegate
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.ex.AnActionListener
import com.intellij.openapi.editor.Editor
import com.maddyhome.idea.vim.KeyHandler
import com.maddyhome.idea.vim.api.injector
import java.awt.KeyboardFocusManager
import java.awt.event.KeyEvent
import java.beans.PropertyChangeListener
import java.util.Collections
import javax.swing.KeyStroke

/**
 * Delivery probe. It records, for every key that enters IdeaVim's key handler with source TYPED, which IDE entry point
 * delivered it. It never consumes, changes or injects a key.
 *
 * - The IDE entry point comes from [AnActionListener]: `beforeEditorTyping` (the editor's `TypedAction` path, also used
 *   for committed input-method text) and `beforeActionPerformed` for IdeaVim's `VimShortcutKeyAction`.
 * - Arrival in IdeaVim comes from `KeyHandler.addCommandListener`, which IdeaVim calls at the start of every
 *   `handleKey` call with source TYPED. The stack at that moment names the caller of `handleKey`.
 */
object Probe {
  const val SHORTCUT_ACTION = "com.maddyhome.idea.vim.action.VimShortcutKeyAction"

  class Pending(val kind: String, val key: String) {
    var hits = 0
  }

  data class Entry(
    val seq: Long,
    val tNanos: Long,
    /** "typed" or "shortcut" from the IDE-level listener, or null when no IDE entry was in progress. */
    val ideKind: String?,
    val ideKey: String?,
    /** The caller of `KeyHandler.handleKey`, from the stack. */
    val via: String,
    /** 0 for the first `handleKey` call of an IDE entry; higher for keys that IdeaVim replays inside it. */
    val nested: Int,
  ) {
    fun json() = Json.obj(
      "seq" to seq, "t" to tNanos, "ideKind" to ideKind, "ideKey" to ideKey, "via" to via, "nested" to nested,
    )
  }

  private val pending = ArrayDeque<Pending>()
  val entries: MutableList<Entry> = Collections.synchronizedList(ArrayList())
  private var seq = 0L

  @Volatile
  var installed = false
    private set

  /** Focus owner changes, as seen by the keyboard focus manager, each prefixed with `t=<System.nanoTime()>`. */
  val focusChanges: MutableList<String> = Collections.synchronizedList(ArrayList())
  private val focusListener = PropertyChangeListener { e ->
    focusChanges += "t=${System.nanoTime()} ${e.propertyName}: ${describe(e.oldValue)} -> ${describe(e.newValue)}"
  }

  @Synchronized
  fun install() {
    if (installed) return
    KeyHandler.getInstance().addCommandListener { onHandleKey() }
    val kfm = KeyboardFocusManager.getCurrentKeyboardFocusManager()
    kfm.addPropertyChangeListener("focusOwner", focusListener)
    kfm.addPropertyChangeListener("permanentFocusOwner", focusListener)
    kfm.addPropertyChangeListener("focusedWindow", focusListener)
    kfm.addPropertyChangeListener("activeWindow", focusListener)
    installed = true
  }

  fun clear() {
    entries.clear()
    focusChanges.clear()
  }

  internal fun ideBegin(kind: String, key: String) {
    pending.addLast(Pending(kind, key))
  }

  internal fun ideEnd() {
    pending.removeLastOrNull()
  }

  private fun onHandleKey() {
    val top = pending.lastOrNull()
    val via = classify(Thread.currentThread().stackTrace)
    val nested = if (top == null) -1 else top.hits++
    entries += Entry(seq++, System.nanoTime(), top?.kind, top?.key, via, nested)
  }

  /** The first known caller of `KeyHandler.handleKey`, scanning from the innermost frame outwards. */
  fun classify(stack: Array<StackTraceElement>): String {
    for (f in stack) {
      val c = f.className
      val m = f.methodName
      when {
        c.startsWith("com.maddyhome.idea.vim.command.MappingProcessor") &&
          (m.contains("replayUnhandledKeys") || m.contains("onUnfinishedMappingSequenceTimeout")) -> return "MappingReplay"
        c == "com.maddyhome.idea.vim.action.change.RepeatChangeAction" -> return "DotReplay"
        c == "com.maddyhome.idea.vim.VimTypedActionHandler" && m == "execute" -> return "TypedAction"
        c == SHORTCUT_ACTION && m == "actionPerformed" -> return "VimShortcutKeyAction"
        c.startsWith("com.maddyhome.idea.vim.ui.ex.ExTextField") -> return "ExTextField"
        c.startsWith("com.maddyhome.idea.vim.action.OutsideEditorKeyDispatcher") -> return "OutsideEditor"
        c.startsWith("com.maddyhome.idea.vim.macro") || c.startsWith("com.maddyhome.idea.vim.group.MacroGroup") -> return "Macro"
      }
    }
    return "direct"
  }

  fun describe(o: Any?): String = when (o) {
    null -> "null"
    else -> o.javaClass.name + "@" + Integer.toHexString(System.identityHashCode(o))
  }

  fun notation(ks: KeyStroke): String = try {
    injector.parser.toKeyNotation(ks)
  } catch (t: Throwable) {
    ks.toString()
  }

  fun notation(c: Char): String = notation(KeyStroke.getKeyStroke(c))
}

/** IDE-level half of the probe, and the observer's trigger after each key. */
class ProbeActionListener : AnActionListener {
  /** The action manager hands listeners a wrapper; the probe looks through it to the action itself. */
  private fun isShortcutAction(action: AnAction): Boolean {
    var a: Any? = action
    var depth = 0
    while (a is ActionWithDelegate<*> && depth++ < 8) a = a.delegate
    return a?.javaClass?.name == Probe.SHORTCUT_ACTION
  }

  override fun beforeEditorTyping(c: Char, dataContext: DataContext) {
    Probe.ideBegin("typed", Probe.notation(c))
  }

  override fun afterEditorTyping(c: Char, dataContext: DataContext) {
    Probe.ideEnd()
    Observer.afterKey(CommonDataKeys.EDITOR.getData(dataContext), "typed:" + Probe.notation(c))
  }

  override fun beforeActionPerformed(action: AnAction, event: AnActionEvent) {
    if (isShortcutAction(action)) {
      val ke = event.inputEvent as? KeyEvent
      Probe.ideBegin("shortcut", if (ke != null) Probe.notation(KeyStroke.getKeyStrokeForEvent(ke)) else "?")
    } else {
      Observer.beforeOtherAction(action, event)
    }
  }

  override fun afterActionPerformed(action: AnAction, event: AnActionEvent, result: AnActionResult) {
    if (isShortcutAction(action)) {
      Probe.ideEnd()
      val ke = event.inputEvent as? KeyEvent
      val editor: Editor? = event.getData(CommonDataKeys.EDITOR)
      Observer.afterKey(editor, "shortcut:" + (if (ke != null) Probe.notation(KeyStroke.getKeyStrokeForEvent(ke)) else "?"))
    }
  }
}
