package spike.s3

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.PlatformCoreDataKeys
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.editor.ex.util.EditorUtil
import com.intellij.testFramework.LoggedErrorProcessor
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.maddyhome.idea.vim.KeyHandler
import com.maddyhome.idea.vim.VimPlugin
import com.maddyhome.idea.vim.action.VimShortcutKeyAction
import com.maddyhome.idea.vim.api.injector
import com.maddyhome.idea.vim.newapi.vim
import com.maddyhome.idea.vim.state.mode.Mode
import java.awt.event.KeyEvent
import java.io.File
import java.util.Date
import javax.swing.KeyStroke
import kotlin.io.path.Path

/**
 * JUnit4 light test base with the VIA_IDE key delivery of IdeaVim 2.47.3's own tests: a key with a character goes to
 * the fixture's `type`, and a key without one runs `VimShortcutKeyAction` as a keyboard shortcut. The harness never
 * calls IdeaVim's key handler. Between test cases it resets IdeaVim's state the way IdeaVim's own test setup does;
 * that reset is test scaffolding, not part of the observer.
 */
abstract class ViaIdeCase : BasePlatformTestCase() {
  companion object {
    @JvmStatic
    var droppedUltimateErrors = 0
  }

  /** Keys sent by the harness, in Vim notation, in order. */
  val sent = mutableListOf<String>()

  private var errorFilter: com.intellij.openapi.application.AccessToken? = null

  override fun setUp() {
    // An obfuscated post-startup activity of com.intellij.modules.ultimate cannot be created in a light test and logs an
    // error when the light project opens. It is unrelated to the spike, so only that error is dropped; it is counted.
    errorFilter = LoggedErrorProcessor.executeWith(object : LoggedErrorProcessor() {
      override fun processError(category: String, message: String, details: Array<String>, t: Throwable?): Set<Action> =
        if (message.contains("class=Z.Z.Z") && message.contains("com.intellij.modules.ultimate")) {
          droppedUltimateErrors++
          Action.NONE
        } else {
          Action.ALL
        }
    })
    super.setUp()
    if (VimPlugin.isNotEnabled()) VimPlugin.setEnabled(true)
    KeyHandler.getInstance().keyHandlerState.reset(Mode.NORMAL())
    injector.vimState.reset()
    VimPlugin.getKey().resetKeyMappings()
    Probe.install()
    Probe.clear()
    Observer.clear()
    Observer.host = NoHost
    sent.clear()
  }

  override fun tearDown() {
    try {
      super.tearDown()
    } finally {
      errorFilter?.finish()
    }
  }

  fun configure(text: String, caret: Int = 0) {
    myFixture.configureByText("fixture.txt", text)
    myFixture.editor.caretModel.moveToOffset(caret)
    KeyHandler.getInstance().fullReset(myFixture.editor.vim)
  }

  fun sourceRc() {
    val rc = System.getProperty("s3.rc") ?: error("s3.rc not set")
    check(File(rc).isFile) { "missing rc $rc" }
    injector.vimscriptExecutor.executeFile(Path(rc), myFixture.editor.vim, fileIsIdeaVimRcConfig = true)
  }

  fun typeKeys(keys: String) {
    for (ks in injector.parser.parseKeys(keys)) send(ks)
  }

  fun send(key: KeyStroke) {
    sent += Probe.notation(key)
    val editor = myFixture.editor
    if (key.keyChar != KeyEvent.CHAR_UNDEFINED) {
      myFixture.type(key.keyChar)
    } else {
      val event = KeyEvent(editor.component, KeyEvent.KEY_PRESSED, Date().time, key.modifiers, key.keyCode, key.keyChar)
      val context = SimpleDataContext.builder()
        .setParent(EditorUtil.getEditorDataContext(editor))
        .add(PlatformCoreDataKeys.CONTEXT_COMPONENT, editor.component)
        .build()
      val e = AnActionEvent(
        event, context, ActionPlaces.KEYBOARD_SHORTCUT,
        VimShortcutKeyAction.instance.templatePresentation.clone(), ActionManager.getInstance(), 0,
      )
      // When VimShortcutKeyAction is disabled for this key, the key is not delivered and the probe shows it missing.
      if (ActionUtil.lastUpdateAndCheckDumb(VimShortcutKeyAction.instance, e, true)) {
        ActionUtil.performActionDumbAwareWithCallbacks(VimShortcutKeyAction.instance, e)
      }
    }
    PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
  }
}
