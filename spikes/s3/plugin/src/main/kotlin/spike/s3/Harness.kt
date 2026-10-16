package spike.s3

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.components.Service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.startup.ProjectActivity
import com.maddyhome.idea.vim.VimPlugin
import com.maddyhome.idea.vim.newapi.vim
import java.awt.Component
import java.awt.KeyboardFocusManager
import java.awt.Toolkit
import java.awt.event.InputMethodEvent
import java.awt.font.TextHitInfo
import java.text.AttributedString
import java.util.concurrent.atomic.AtomicReference

/**
 * Control surface of the spike plugin for the end-to-end harnesses (Driver, GNOME, macOS). Every method runs its work
 * on the EDT and returns plain strings, booleans or ints, so that a remote caller needs no plugin classes.
 */
@Service(Service.Level.APP)
class Harness : Disposable {
  @Volatile
  private var docListenerInstalled = false

  fun install(): String = edt {
    Probe.install()
    Observer.startPolling()
    if (!docListenerInstalled) {
      EditorFactory.getInstance().eventMulticaster.addDocumentListener(object : DocumentListener {
        override fun documentChanged(event: DocumentEvent) = Observer.onDocumentChanged()
      }, this)
      docListenerInstalled = true
    }
    "installed probe=${Probe.installed} toolkit=${Toolkit.getDefaultToolkit().javaClass.name} ideavim=${ideaVimVersion()}"
  }

  /** Selects the host ("balloon", "layer", "control" or "none") and whether the observer may show it. */
  fun setHost(name: String, enabled: Boolean): String = edt {
    Observer.host.let { if (it.showing) it.hide() }
    Observer.host = Hosts.byName(name)
    Observer.enabled = enabled
    Observer.host.name + " enabled=" + enabled
  }

  fun beginTrial(): String = edt {
    Probe.clear()
    Observer.clear()
    Observer.host.resetCounts()
    "ok"
  }

  fun hostShowing(): Boolean = edt { Observer.host.showing }

  /** Keys delivered to IdeaVim through an IDE entry point since [beginTrial]; replays inside a key are not counted. */
  fun deliveredCount(): Int = Probe.entries.count { it.nested == 0 && it.ideKind != null }

  /** Keys delivered since [beginTrial], in Vim notation, joined by a tab. */
  fun deliveredKeys(): String = Probe.entries.filter { it.nested == 0 && it.ideKind != null }.joinToString("\t") { it.ideKey ?: "?" }

  fun pid(): Long = ProcessHandle.current().pid()

  /** Error highlights in the selected editor's document, as the daemon has published them. */
  fun errorCount(): Int = edt {
    val e = editor() ?: return@edt -1
    val p = e.project ?: return@edt -1
    var n = 0
    com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx.processHighlights(
      e.document, p, com.intellij.lang.annotation.HighlightSeverity.ERROR, 0, e.document.textLength,
    ) { n++; true }
    n
  }

  /** Opens [relativePath] of the first open project in the editor, with focus. */
  fun openFile(relativePath: String): String = edt {
    val p = ProjectManager.getInstance().openProjects.firstOrNull() ?: return@edt "no project"
    val base = p.basePath ?: return@edt "no base path"
    val vf = com.intellij.openapi.vfs.LocalFileSystem.getInstance().refreshAndFindFileByPath("$base/$relativePath") ?: return@edt "no file"
    FileEditorManager.getInstance(p).openFile(vf, true)
    "opened " + vf.name
  }

  fun toolkit(): String = Toolkit.getDefaultToolkit().javaClass.name

  fun ideaVimVersion(): String = try {
    com.intellij.ide.plugins.PluginManagerCore.getPlugin(com.intellij.openapi.extensions.PluginId.getId("IdeaVIM"))?.version ?: "?"
  } catch (t: Throwable) {
    "?"
  }

  fun ideaVimEnabled(): Boolean = VimPlugin.isEnabled()

  fun focusOwner(): String = edt { Probe.describe(KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner) }

  fun editorHasFocus(): Boolean = edt {
    val e = editor() ?: return@edt false
    KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner === e.contentComponent
  }

  fun editorText(): String = edt { editor()?.document?.text ?: "" }

  fun caretOffset(): Int = edt { editor()?.caretModel?.offset ?: -1 }

  fun caretLine(): Int = edt { editor()?.caretModel?.logicalPosition?.line ?: -1 }

  fun mode(): String = edt { editor()?.let { Observer.modeName(it.vim.mode) } ?: "?" }

  fun snapshot(): String = edt { editor()?.let { Observer.read(it).json() } ?: "null" }

  /** Replaces the text and moves the caret. The caller must have returned IdeaVim to Normal mode first. */
  fun resetEditor(text: String, caret: Int): String = edt {
    val e = editor() ?: return@edt "no editor"
    WriteCommandAction.runWriteCommandAction(e.project) { e.document.setText(text) }
    e.caretModel.removeSecondaryCarets()
    e.caretModel.moveToOffset(caret.coerceIn(0, e.document.textLength))
    e.selectionModel.removeSelection()
    "ok"
  }

  /**
   * Posts input-method events to the focus owner as an input method does: one event per [steps] entry, where an entry
   * starting with `c:` is composed text and one starting with `C:` is committed text.
   */
  fun postIme(steps: String): String = edt {
    val owner: Component = KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner ?: return@edt "no focus owner"
    val q = Toolkit.getDefaultToolkit().systemEventQueue
    for (step in steps.split('|')) {
      if (step.length < 2) continue
      val text = step.substring(2)
      val committed = if (step.startsWith("C:")) text.length else 0
      val it = if (text.isEmpty()) null else AttributedString(text).iterator
      q.postEvent(
        InputMethodEvent(
          owner, InputMethodEvent.INPUT_METHOD_TEXT_CHANGED, it, committed,
          TextHitInfo.leading(if (committed > 0) 0 else text.length), null,
        )
      )
    }
    "posted to " + Probe.describe(owner)
  }

  /** Everything the probes recorded since [beginTrial], as one JSON object. */
  fun report(): String = edt {
    val e = editor()
    Json.obj(
      "probe" to Json.Raw(Json.arr(Probe.entries.toList().map { Json.Raw(it.json()) })),
      "observer" to Json.Raw(Json.arr(Observer.records.toList().map { Json.Raw(it.json()) })),
      "focusChanges" to Probe.focusChanges.toList(),
      "dotReplay" to Observer.dotReplayEvents.toList(),
      "host" to Observer.host.name,
      "hostCounts" to Observer.host.counts.toList(),
      "hostShowing" to Observer.host.showing,
      "text" to (e?.document?.text),
      "caret" to (e?.caretModel?.offset ?: -1),
      "line" to (e?.caretModel?.logicalPosition?.line ?: -1),
      "now" to Json.Raw(e?.let { Observer.read(it).json() } ?: "null"),
      "focusOwnerIsEditor" to (e != null && KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner === e.contentComponent),
      "popupStack" to Observer.popupStackSize(),
      "popupActive" to Observer.popupActive(),
    )
  }

  override fun dispose() {
    Observer.stopPolling()
  }

  private fun editor(): Editor? {
    for (p: Project in ProjectManager.getInstance().openProjects) {
      FileEditorManager.getInstance(p).selectedTextEditor?.let { return it }
    }
    return null
  }

  private fun <T> edt(block: () -> T): T {
    val app = ApplicationManager.getApplication()
    if (app.isDispatchThread) return block()
    val ref = AtomicReference<Result<T>>()
    app.invokeAndWait { ref.set(runCatching(block)) }
    return ref.get().getOrThrow()
  }

  companion object {
    @JvmStatic
    fun getInstance(): Harness = ApplicationManager.getApplication().getService(Harness::class.java)
  }
}

class HarnessStartup : ProjectActivity {
  override suspend fun execute(project: Project) {
    Harness.getInstance().install()
  }
}
