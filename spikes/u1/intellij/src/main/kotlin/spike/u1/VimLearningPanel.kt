package spike.u1

import com.google.gson.JsonArray
import com.google.gson.JsonParser
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.Font
import java.awt.GridLayout
import java.io.File
import javax.swing.BorderFactory
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.ButtonGroup
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JTextArea
import javax.swing.JToggleButton
import javax.swing.UIManager

/** Fixed examples for U1 review; context updates never change the selected reference topic. */
internal class VimLearningPanel(initialState: String = "vim-reference") : JPanel() {
  private val data = JsonParser.parseString(File(System.getProperty("u1.data")).readText()).asJsonObject["vim"].asJsonObject
  private val foreground = UIManager.getColor("Label.foreground")
  private val muted = UIManager.getColor("Label.infoForeground") ?: foreground
  private val line = UIManager.getColor("Component.borderColor") ?: muted
  private val fontBase = UIManager.getFont("Label.font")
  private val context = column()
  private val reference = column()
  private val buttons = mutableMapOf<String, JToggleButton>()
  var selectedCategory: String = ""
    private set
  var scenario: String = initialState
    private set

  init {
    layout = BoxLayout(this, BoxLayout.Y_AXIS)
    border = BorderFactory.createEmptyBorder(18, 18, 18, 18)
    add(label("Learn Vim", 17f, true)); add(gap(14))
    context.border = BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(line, 1, true), BorderFactory.createEmptyBorder(12, 12, 12, 12))
    add(context); add(gap(22)); add(label("BROWSE REFERENCE", 10f)); add(gap(12))
    val group = ButtonGroup()
    val categories = JPanel(GridLayout(0, 2, 6, 6)).apply {
      isOpaque = false
      alignmentX = Component.LEFT_ALIGNMENT
    }
    for (item in data["categories"].asJsonArray) {
      val category = item.asJsonObject
      val id = category["id"].asString
      val button = JToggleButton(category["title"].asString).apply {
        font = fontBase.deriveFont(11f)
        border = BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(line, 1, true), BorderFactory.createEmptyBorder(6, 4, 6, 4))
        addActionListener { selectCategory(id) }
      }
      buttons[id] = button
      group.add(button)
      if (id == "repeat") {
        categories.maximumSize = Dimension(Int.MAX_VALUE, categories.preferredSize.height)
        add(categories); add(gap(6))
        button.alignmentX = Component.LEFT_ALIGNMENT
        button.maximumSize = Dimension(Int.MAX_VALUE, button.preferredSize.height)
        add(button)
      } else categories.add(button)
    }
    add(gap(14)); add(reference); add(gap(16)); add(text("Read here · type in the editor"))
    add(Box.createVerticalGlue())
    selectCategory(data["scenarios"].asJsonObject[initialState].asJsonObject["category"].asString)
    updateContext(initialState)
  }

  fun selectCategory(id: String) {
    val category = data["categories"].asJsonArray.first { it.asJsonObject["id"].asString == id }.asJsonObject
    selectedCategory = id
    for ((key, button) in buttons) {
      button.isSelected = key == id
      val color = if (key == id) UIManager.getColor("Link.activeForeground") ?: foreground else line
      button.foreground = if (key == id) color else foreground
      button.border = BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(color, 1, true), BorderFactory.createEmptyBorder(6, 4, 6, 4))
    }
    reference.removeAll()
    reference.add(text(category["note"].asString)); reference.add(gap(10))
    reference.add(rows(category["rows"].asJsonArray, 180))
    reference.maximumSize = Dimension(Int.MAX_VALUE, reference.preferredSize.height)
    revalidate(); repaint()
  }

  fun updateContext(state: String) {
    val value = data["scenarios"].asJsonObject[state].asJsonObject
    scenario = state
    context.removeAll()
    context.add(label("EXAMPLE INPUT · PREVIEW", 10f)); context.add(gap(12))
    if (value["input"].asString.isNotEmpty()) {
      context.add(key(value["input"].asString)); context.add(gap(10))
    }
    context.add(text(value["title"].asString, 250, 14f, true)); context.add(gap(8))
    context.add(text(value["detail"].asString, 250))
    if (!value["rows"].asJsonArray.isEmpty) {
      context.add(gap(10)); context.add(rows(value["rows"].asJsonArray, 180))
    }
    context.add(gap(10)); context.add(text(value["footer"].asString, 250))
    context.maximumSize = Dimension(Int.MAX_VALUE, context.preferredSize.height)
    revalidate(); repaint()
  }

  private fun label(value: String, size: Float = 12f, bold: Boolean = false) = JLabel(value).apply {
    font = fontBase.deriveFont(if (bold) Font.BOLD else Font.PLAIN, size)
    foreground = if (bold) this@VimLearningPanel.foreground else muted
    alignmentX = Component.LEFT_ALIGNMENT
  }

  private fun text(value: String, width: Int = 280, size: Float = 12f, bold: Boolean = false) = JTextArea(value).apply {
    isEditable = false; isFocusable = false; isOpaque = false
    lineWrap = true; wrapStyleWord = true
    font = fontBase.deriveFont(if (bold) Font.BOLD else Font.PLAIN, size)
    foreground = if (bold) this@VimLearningPanel.foreground else muted
    alignmentX = Component.LEFT_ALIGNMENT
    setSize(width, Short.MAX_VALUE.toInt())
    maximumSize = Dimension(Int.MAX_VALUE, preferredSize.height)
  }

  private fun key(value: String) = label(value).apply {
    font = Font(Font.MONOSPACED, Font.PLAIN, 12)
    foreground = this@VimLearningPanel.foreground
    border = BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(line, 1, true), BorderFactory.createEmptyBorder(4, 7, 4, 7))
    maximumSize = preferredSize
  }

  private fun rows(items: JsonArray, textWidth: Int): JPanel {
    val list = column()
    for (item in items) {
      val row = item.asJsonArray
      list.add(JPanel(BorderLayout(8, 0)).apply {
        isOpaque = false
        alignmentX = Component.LEFT_ALIGNMENT
        border = BorderFactory.createEmptyBorder(7, 0, 7, 0)
        add(JPanel(BorderLayout()).apply { isOpaque = false; add(key(row[0].asString), BorderLayout.NORTH) }, BorderLayout.WEST)
        add(text(row[1].asString, textWidth), BorderLayout.CENTER)
        maximumSize = Dimension(Int.MAX_VALUE, preferredSize.height)
      })
    }
    return list
  }

  private fun gap(height: Int) = Box.createVerticalStrut(height)
  private fun column() = JPanel().apply {
    layout = BoxLayout(this, BoxLayout.Y_AXIS)
    isOpaque = false
    alignmentX = Component.LEFT_ALIGNMENT
  }
}
