package spike.s3

import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.JBColor
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.JLayeredPane
import javax.swing.JPanel
import javax.swing.SwingUtilities

/**
 * A place to show the hint. Every host is called on the EDT only. No host may take focus or call `requestFocus`.
 */
interface HintHost {
  val name: String
  val showing: Boolean
  fun show(editor: Editor, text: String)
  fun update(text: String)
  fun hide()

  /** Counts of show, update and hide calls since the last [resetCounts]. */
  val counts: IntArray
  fun resetCounts() = counts.fill(0)
}

object NoHost : HintHost {
  override val name = "none"
  override val showing = false
  override val counts = IntArray(3)
  override fun show(editor: Editor, text: String) {}
  override fun update(text: String) {}
  override fun hide() {}
}

/** Times (System.nanoTime) at which a host's panel painted, to show when a hint was actually on screen. */
object HostPaints {
  val times: MutableList<Long> = java.util.Collections.synchronizedList(ArrayList())
}

private class PaintLoggingPanel : JPanel(BorderLayout()) {
  override fun paintComponent(g: java.awt.Graphics) {
    HostPaints.times += System.nanoTime()
    super.paintComponent(g)
  }
}

private fun hintPanel(label: JBLabel): JPanel = PaintLoggingPanel().apply {
  isFocusable = false
  label.isFocusable = false
  isOpaque = true
  background = JBColor.PanelBackground
  border = JBUI.Borders.compound(JBUI.Borders.customLine(JBColor.border(), 1), JBUI.Borders.empty(4, 8))
  add(label, BorderLayout.CENTER)
}

/** Bottom-centre point of the editor's visible area, in content-component coordinates. */
private fun anchor(editor: Editor): RelativePoint {
  val vis = editor.scrollingModel.visibleArea
  return RelativePoint(editor.contentComponent, Point(vis.x + vis.width / 2, vis.y + vis.height - JBUI.scale(8)))
}

/**
 * An unfocused Balloon without a callout. A Balloon cannot be shown again after it hides, so each show creates a new
 * one; an update changes the label and revalidates the shown Balloon.
 */
class BalloonHost : HintHost {
  override val name = "balloon"
  override val counts = IntArray(3)
  private var balloon: Balloon? = null
  private val label = JBLabel()

  override val showing: Boolean
    get() = balloon?.let { !it.isDisposed } ?: false

  override fun show(editor: Editor, text: String) {
    counts[0]++
    label.text = text
    val b = JBPopupFactory.getInstance().createBalloonBuilder(hintPanel(label))
      .setShowCallout(false)
      .setRequestFocus(false)
      .setHideOnKeyOutside(false)
      .setHideOnClickOutside(false)
      .setHideOnAction(false)
      .setHideOnFrameResize(false)
      .setHideOnLinkClick(false)
      .setHideOnCloseClick(false)
      .setCloseButtonEnabled(false)
      .setBlockClicksThroughBalloon(false)
      .setDialogMode(false)
      .setFadeoutTime(0)
      .setAnimationCycle(0)
      .createBalloon()
    balloon = b
    b.show(anchor(editor), Balloon.Position.above)
  }

  override fun update(text: String) {
    counts[1]++
    label.text = text
    balloon?.revalidate()
  }

  override fun hide() {
    counts[2]++
    balloon?.hide()
    balloon = null
  }
}

/**
 * A component in the frame's `JLayeredPane.POPUP_LAYER`, placed over the bottom of the editor viewport. It is added
 * once per root pane and updated in place.
 */
class PopupLayerHost : HintHost {
  override val name = "layer"
  override val counts = IntArray(3)
  private val label = JBLabel()
  private val panel: JComponent = hintPanel(label)
  private var editor: Editor? = null

  override val showing: Boolean
    get() = panel.parent != null && panel.isVisible

  override fun show(editor: Editor, text: String) {
    counts[0]++
    this.editor = editor
    val root = SwingUtilities.getRootPane(editor.component) ?: return
    val layered = root.layeredPane
    if (panel.parent !== layered) {
      panel.parent?.remove(panel)
      layered.add(panel, JLayeredPane.POPUP_LAYER)
    }
    label.text = text
    place(editor, layered)
    panel.isVisible = true
  }

  override fun update(text: String) {
    counts[1]++
    label.text = text
    val e = editor
    val layered = panel.parent as? JLayeredPane
    if (e != null && layered != null && !e.isDisposed) place(e, layered)
  }

  override fun hide() {
    counts[2]++
    if (panel.isVisible) {
      val b = panel.bounds
      panel.isVisible = false
      panel.parent?.repaint(b.x, b.y, b.width, b.height)
    }
  }

  private fun place(editor: Editor, layered: JLayeredPane) {
    val viewport = (editor as? EditorEx)?.scrollPane?.viewport ?: editor.contentComponent
    val r: Rectangle = SwingUtilities.convertRectangle(viewport.parent, viewport.bounds, layered)
    val pref = panel.preferredSize
    val gap = JBUI.scale(8)
    val w = minOf(pref.width, r.width - 2 * gap).coerceAtLeast(1)
    panel.setBounds(r.x + gap, r.y + r.height - pref.height - gap, w, pref.height)
    panel.revalidate()
    panel.repaint()
  }
}

/**
 * Control for the `Esc` row: a `JBPopupFactory` popup that does not take focus. It is not a candidate host.
 */
class ControlPopupHost : HintHost {
  override val name = "control"
  override val counts = IntArray(3)
  private var popup: JBPopup? = null
  private val label = JBLabel()

  override val showing: Boolean
    get() = popup?.isVisible ?: false

  override fun show(editor: Editor, text: String) {
    counts[0]++
    label.text = text
    val p = JBPopupFactory.getInstance().createComponentPopupBuilder(hintPanel(label), null)
      .setFocusable(false)
      .setRequestFocus(false)
      .setCancelOnClickOutside(false)
      .setCancelOnWindowDeactivation(false)
      .setCancelKeyEnabled(true)
      .setMovable(false)
      .setResizable(false)
      .createPopup()
    popup = p
    p.show(anchor(editor))
  }

  override fun update(text: String) {
    counts[1]++
    label.text = text
  }

  override fun hide() {
    counts[2]++
    popup?.cancel()
    popup = null
  }
}

object Hosts {
  fun byName(name: String): HintHost = when (name) {
    "balloon" -> BalloonHost()
    "layer" -> PopupLayerHost()
    "control" -> ControlPopupHost()
    else -> NoHost
  }
}
