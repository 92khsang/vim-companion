package spike.s3.ui

import com.intellij.driver.client.Driver
import com.intellij.driver.client.Remote
import com.intellij.driver.model.OnDispatcher
import com.intellij.driver.sdk.Editor
import com.intellij.driver.sdk.FileEditorManager
import com.intellij.driver.sdk.singleProject
import com.intellij.driver.sdk.ui.components.common.codeEditor
import com.intellij.driver.sdk.ui.components.common.ideFrame
import com.intellij.driver.sdk.ui.ui

@Remote("com.maddyhome.idea.vim.newapi.IjVimEditorKt", plugin = "IdeaVIM")
interface IjVimEditorKt {
  fun getVim(editor: Editor): VimEditorRef
}

@Remote("com.maddyhome.idea.vim.api.VimEditor", plugin = "IdeaVIM")
interface VimEditorRef {
  fun getMode(): ModeRef
}

@Remote("com.maddyhome.idea.vim.state.mode.Mode", plugin = "IdeaVIM")
interface ModeRef

@Remote("com.maddyhome.idea.vim.state.mode.ModeExtensionsKt", plugin = "IdeaVIM")
interface ModeExtensionsKt {
  fun toVimNotation(mode: ModeRef): String
}

@Remote("java.lang.ProcessHandle")
interface ProcessHandleStatic {
  fun current(): ProcessHandleRef
}

@Remote("java.lang.ProcessHandle")
interface ProcessHandleRef {
  fun pid(): Long
}

/**
 * Reads and resets the editor through the Driver alone, for the reference runs without the spike plugin. It uses only
 * platform APIs and IdeaVim's own mode notation, so the spike plugin's code plays no part in these runs.
 */
object RemoteState {
  private fun editorUi(driver: Driver) = driver.ui.ideFrame().codeEditor()

  fun reset(driver: Driver, text: String, caret: Int) {
    val ed = editorUi(driver)
    ed.text = text
    driver.withContext(OnDispatcher.EDT) { ed.editor.getCaretModel().moveToOffset(caret) }
  }

  fun vimMode(driver: Driver, editor: Editor): String =
    driver.utility(ModeExtensionsKt::class).toVimNotation(driver.utility(IjVimEditorKt::class).getVim(editor).getMode())

  /** Text, caret offset and line, and IdeaVim's mode in Vim's `mode()` notation, as one JSON object. */
  fun state(driver: Driver): String = driver.withContext(OnDispatcher.EDT) {
    val e = editorUi(driver).editor
    val caret = e.getCaretModel()
    J.obj(
      "text" to e.getDocument().getText(), "caret" to caret.getOffset(), "line" to caret.getLogicalPosition().getLine(),
      "vimMode" to vimMode(driver, e),
    )
  }

  fun closeAll(driver: Driver): String = driver.withContext(OnDispatcher.EDT) {
    val fem = service(FileEditorManager::class, singleProject())
    val files = fem.getAllEditors().map { it.getFile() }
    for (f in files) fem.closeFile(f)
    files.joinToString(",") { it.getName() }
  }

  fun pid(driver: Driver): Long = driver.utility(ProcessHandleStatic::class).current().pid()
}
