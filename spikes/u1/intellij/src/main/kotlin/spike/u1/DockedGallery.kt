package spike.u1

import com.google.gson.GsonBuilder
import com.intellij.ide.ui.LafManager
import com.intellij.ide.ui.UISettings
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.ex.FileEditorManagerEx
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.projectRoots.JavaSdk
import com.intellij.openapi.projectRoots.ProjectJdkTable
import com.intellij.openapi.projectRoots.Sdk
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.ToolWindowType
import com.intellij.openapi.wm.WindowManager
import com.intellij.openapi.wm.ex.ToolWindowEx
import com.intellij.ui.content.ContentFactory
import java.awt.Component
import java.awt.Frame
import java.awt.Rectangle
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import javax.swing.JComponent
import javax.swing.JScrollPane
import javax.swing.JSplitPane
import javax.swing.SwingUtilities
import javax.swing.Timer

class KeysToolWindowFactory : ToolWindowFactory, DumbAware {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val factory = ContentFactory.getInstance()
    toolWindow.contentManager.addContent(factory.createContent(panel("idle"), "Leader", false))
    toolWindow.contentManager.addContent(factory.createContent(vimPanel(), "Vim", false))
    toolWindow.setType(ToolWindowType.DOCKED, null)
    toolWindow.isAutoHide = false
  }
}

private fun vimPanel() = JScrollPane(VimLearningPanel()).apply {
  border = null
  horizontalScrollBarPolicy = JScrollPane.HORIZONTAL_SCROLLBAR_NEVER
}

private fun panel(state: String) = JScrollPane(GalleryPanel().content(state)).apply {
  border = null
  horizontalScrollBarPolicy = JScrollPane.HORIZONTAL_SCROLLBAR_NEVER
}

class GalleryStartup : ProjectActivity {
  override suspend fun execute(project: Project) {
    if (System.getProperty("u1.output") != null) {
      ApplicationManager.getApplication().invokeLater { startGallery(project) }
    }
  }
}

class GalleryAction : AnAction() {
  override fun actionPerformed(event: AnActionEvent) {
    event.project?.let { startGallery(it) }
  }
}

private fun startGallery(project: Project) {
  check(System.getProperty("u1.output") != null) { "UI Gallery requires a capture sandbox" }
  val laf = LafManager.getInstance()
  laf.setCurrentLookAndFeel(laf.installedThemes.first { it.name == "Islands Dark" }, false)
  laf.updateUI()
  UISettings.getInstance().compactMode = false
  UISettings.getInstance().fireUISettingsChanged()
  val app = ApplicationManager.getApplication()
  app.executeOnPooledThread {
    val sdk = JavaSdk.getInstance().createJdk("U1 Gallery JDK", System.getProperty("java.home"), false)
    app.invokeLater({ DockedGallery(project).start(sdk) }, ModalityState.nonModal())
  }
}

private class DockedGallery(private val project: Project) {
  private val output = File(System.getProperty("u1.output")).apply { mkdirs() }
  private val frame = WindowManager.getInstance().getFrame(project)!!
  private val root get() = frame.rootPane
  private val tool = ToolWindowManager.getInstance(project).getToolWindow("Vim Keys")!!
  private val manager = FileEditorManagerEx.getInstanceEx(project)
  private val components = mutableListOf<Map<String, Any>>()
  private val layouts = mutableListOf<Map<String, Any>>()
  private lateinit var first: Editor
  private var referenceSelectionPreserved = false

  private fun later(action: () -> Unit) {
    Timer(650) {
      ApplicationManager.getApplication().invokeLater({ action() }, ModalityState.nonModal())
    }.apply { isRepeats = false; start() }
  }

  fun start(sdk: Sdk) {
    ApplicationManager.getApplication().runWriteAction {
      ProjectJdkTable.getInstance().addJdk(sdk, project)
      ProjectRootManager.getInstance(project).projectSdk = sdk
    }
    frame.extendedState = Frame.NORMAL
    frame.setBounds(0, 0, 1440, 1000)
    val windows = ToolWindowManager.getInstance(project)
    for (id in windows.toolWindowIds) if (id != "Vim Keys") windows.getToolWindow(id)?.hide(null)
    val file = LocalFileSystem.getInstance().refreshAndFindFileByPath(project.basePath + "/OrderService.java")!!
    first = manager.openTextEditor(OpenFileDescriptor(project, file), true)!!
    manager.runWhenLoaded(first) {
      tool.show {
        later {
          val ex = tool as ToolWindowEx
          ex.stretchWidth(320 - ex.decorator.width)
          later { captureComponent(0) }
        }
      }
    }
  }

  private fun state(value: String) {
    val isVim = value.startsWith("vim-")
    val content = tool.contentManager.getContent(if (value == "grammar" || isVim) 1 else 0)!!
    if (isVim) {
      val current = (content.component as? JScrollPane)?.viewport?.view as? VimLearningPanel
      if (current == null) content.component = vimPanel()
      ((content.component as JScrollPane).viewport.view as VimLearningPanel).updateContext(value)
    } else content.component = panel(value)
    // Updating a visible tab does not activate or reveal the tool window.
    tool.contentManager.setSelectedContent(content, false)
  }

  private fun captureComponent(index: Int) {
    val states = listOf("idle", "prefix", "badges", "grammar", "vim-reference", "vim-d", "vim-di", "vim-f", "vim-register", "vim-unavailable")
    if (index == states.size) {
      val learning = (tool.contentManager.getContent(1)!!.component as JScrollPane).viewport.view as VimLearningPanel
      learning.selectCategory("objects")
      state("vim-d")
      state("vim-unavailable")
      check(learning.selectedCategory == "objects") { "A context update reset reference browsing" }
      referenceSelectionPreserved = true
      state("prefix")
      later { captureLayout("single", false); split() }
      return
    }
    val value = states[index]
    state(value)
    if (value.startsWith("vim-")) {
      val learning = (tool.contentManager.getContent(1)!!.component as JScrollPane).viewport.view as VimLearningPanel
      learning.selectCategory(when (value) {
        "vim-d" -> "editing"
        "vim-di" -> "objects"
        "vim-register" -> "counts"
        "vim-unavailable" -> "repeat"
        else -> "movement"
      })
    }
    later {
      if (value.startsWith("vim-")) {
        val scroll = tool.contentManager.getContent(1)!!.component as JScrollPane
        check(scroll.viewport.view.preferredSize.height <= scroll.viewport.height) { "Vim content exceeds the capture viewport: $value" }
      }
      components.add(capture((tool as ToolWindowEx).decorator, "intellij-$value.png"))
      captureComponent(index + 1)
    }
  }

  private fun split() {
    val file = LocalFileSystem.getInstance().refreshAndFindFileByPath(project.basePath + "/Order.java")!!
    manager.currentWindow!!.split(JSplitPane.HORIZONTAL_SPLIT, true, file, false)
    state("badges")
    later {
      captureLayout("split", true)
      frame.setSize(1100, 800)
      later {
        val ex = tool as ToolWindowEx
        ex.stretchWidth(320 - ex.decorator.width)
        later {
          captureLayout("small-split", true)
          tool.hide {
            state("prefix")
            later {
              check(!tool.isVisible) { "Updating the hidden view reopened it" }
              captureLayout("small-hidden", true)
              finish()
            }
          }
        }
      }
    }
  }

  private fun bounds(component: Component): Rectangle = SwingUtilities.convertRectangle(component.parent, component.bounds, root)
  private fun rect(value: Rectangle) = mapOf("x" to value.x, "y" to value.y, "width" to value.width, "height" to value.height)

  private fun captureLayout(name: String, split: Boolean) {
    val toolBounds = bounds((tool as ToolWindowEx).decorator)
    val editors = manager.allEditors.filterIsInstance<TextEditor>().map { it.editor }.filter { it.contentComponent.isShowing }
    check(editors.size == if (split) 2 else 1) { "Unexpected editor count: ${editors.size}" }
    val editorBounds = editors.map { editor ->
      SwingUtilities.convertRectangle(editor.contentComponent, editor.scrollingModel.visibleArea, root)
    }
    check(editorBounds.all { it.width > 0 && it.height > 0 && (!tool.isVisible || !it.intersects(toolBounds)) }) { "The docked view overlaps an editor" }
    layouts.add(capture(root, "intellij-context-$name.png") + mapOf(
      "toolWindow" to rect(toolBounds),
      "editors" to editorBounds.map { rect(it) },
      "overlapCount" to editorBounds.count { tool.isVisible && it.intersects(toolBounds) },
      "toolWindowVisible" to tool.isVisible,
      "toolWindowType" to tool.type.toString(),
      "autoHide" to tool.isAutoHide,
    ))
  }

  private fun capture(component: JComponent, file: String): Map<String, Any> {
    check(component.width > 0 && component.height > 0)
    val image = BufferedImage(component.width, component.height, BufferedImage.TYPE_INT_ARGB)
    val graphics = image.createGraphics()
    component.printAll(graphics)
    graphics.dispose()
    ImageIO.write(image, "png", File(output, file))
    return mapOf("file" to file, "width" to component.width, "height" to component.height, "deviceScaleFactor" to component.graphicsConfiguration.defaultTransform.scaleX)
  }

  private fun finish() {
    val common = mapOf(
      "ide" to ApplicationInfo.getInstance().fullVersion,
      "build" to ApplicationInfo.getInstance().build.asString(),
      "theme" to LafManager.getInstance().currentUIThemeLookAndFeel.name,
      "themeResource" to "themes/islands/ManyIslandsDark.theme.json",
      "editorScheme" to EditorColorsManager.getInstance().globalScheme.name,
      "compactMode" to UISettings.getInstance().compactMode,
      "referenceSelectionPreserved" to referenceSelectionPreserved,
      "captureMethod" to "Swing printAll of real docked tool window and IDE root pane",
    )
    val json = GsonBuilder().setPrettyPrinting().create()
    File(output, "intellij-capture.json").writeText(json.toJson(common + ("captures" to components)) + "\n")
    File(output, "intellij-context.json").writeText(json.toJson(common + ("captures" to layouts)) + "\n")
    ApplicationManager.getApplication().exit(true, true, false)
  }
}
