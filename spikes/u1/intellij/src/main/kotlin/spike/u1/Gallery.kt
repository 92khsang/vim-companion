package spike.u1

import com.google.gson.JsonParser
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Dimension
import java.awt.Font
import java.awt.FlowLayout
import java.io.File
import javax.swing.BorderFactory
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JSeparator
import javax.swing.SwingConstants
import javax.swing.UIManager

internal class GalleryPanel {
  private val background = UIManager.getColor("Panel.background")
  private val foreground = UIManager.getColor("Label.foreground")
  private val muted = UIManager.getColor("Label.infoForeground") ?: foreground
  private val line = UIManager.getColor("Component.borderColor") ?: muted
  private val data = JsonParser.parseString(File(System.getProperty("u1.data")).readText()).asJsonObject
  private val baseFont = UIManager.getFont("Label.font").deriveFont(13f)

  private fun label(text: String, size: Float = 13f, color: Color = foreground, bold: Boolean = false) = JLabel(text).apply {
    font = baseFont.deriveFont(if (bold) Font.BOLD else Font.PLAIN, size)
    this.foreground = color
    alignmentX = Component.LEFT_ALIGNMENT
    maximumSize = Dimension(Int.MAX_VALUE, preferredSize.height)
  }

  private fun column(vararg children: Component) = JPanel().apply {
    layout = BoxLayout(this, BoxLayout.Y_AXIS)
    isOpaque = false
    alignmentX = Component.LEFT_ALIGNMENT
    children.forEach { add(it) }
  }

  private fun flow(vararg children: Component, gap: Int = 8) = JPanel(FlowLayout(FlowLayout.LEFT, gap, 0)).apply {
    isOpaque = false
    alignmentX = Component.LEFT_ALIGNMENT
    children.forEach { add(it) }
    maximumSize = Dimension(Int.MAX_VALUE, preferredSize.height)
  }

  private fun key(value: String) = label(value, 12f).apply {
    font = Font(Font.MONOSPACED, Font.PLAIN, 12)
    isOpaque = true
    background = UIManager.getColor("EditorPane.background") ?: this@GalleryPanel.background
    horizontalAlignment = SwingConstants.CENTER
    border = BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(line, 1, true), BorderFactory.createEmptyBorder(3, 7, 3, 7))
    minimumSize = Dimension(27, 26)
    preferredSize = Dimension(maxOf(27, preferredSize.width), 26)
  }

  private fun gap(height: Int) = Box.createVerticalStrut(height)
  private fun rule() = JSeparator().apply {
    foreground = line
    maximumSize = Dimension(Int.MAX_VALUE, 1)
    alignmentX = Component.LEFT_ALIGNMENT
  }

  private fun badge(kind: String): JLabel {
    val (symbol, text) = when (kind) {
      "unsupported" -> "⊘" to "Unsupported"
      "differs-from-vim" -> "≠" to "Differs from Vim"
      "fallback" -> "↪" to "Fallback"
      else -> "◇" to "Experimental"
    }
    val color = when (kind) {
      "unsupported" -> UIManager.getColor("Component.errorFocusColor")
      "experimental" -> UIManager.getColor("Link.activeForeground")
      else -> UIManager.getColor("Component.warningFocusColor")
    } ?: muted
    return label("$symbol  $text", 11f, color).apply {
      border = BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(line, 1, true), BorderFactory.createEmptyBorder(2, 5, 2, 5))
      maximumSize = preferredSize
    }
  }

  private fun chip(text: String) = label(text, 11f).apply {
    isOpaque = true
    background = UIManager.getColor("ActionButton.hoverBackground") ?: this@GalleryPanel.background
    border = BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(line, 1, true), BorderFactory.createEmptyBorder(2, 6, 2, 6))
  }

  private fun rows(state: String): JPanel {
    val items = column()
    val allRows = data[state].asJsonObject["rows"].asJsonArray.toList()
    val visible = data[state].asJsonObject["visibleRows"]?.asInt ?: allRows.size
    for (row in allRows.take(visible)) {
      val item = row.asJsonObject
      val content = column(label(item["label"].asString, bold = item["group"].asBoolean))
      if (!item["badge"].isJsonNull) {
        content.add(gap(6))
        content.add(badge(item["badge"].asString))
      }
      val rowPanel = JPanel(BorderLayout(12, 0)).apply {
        isOpaque = false
        alignmentX = Component.LEFT_ALIGNMENT
        border = BorderFactory.createEmptyBorder(10, 0, 10, 0)
        add(JPanel(BorderLayout()).apply { isOpaque = false; add(key(item["key"].asString), BorderLayout.NORTH) }, BorderLayout.WEST)
        add(content, BorderLayout.CENTER)
        if (item["group"].asBoolean) add(label("›", 18f, muted), BorderLayout.EAST)
        maximumSize = Dimension(Int.MAX_VALUE, preferredSize.height)
      }
      items.add(rowPanel)
    }
    if (visible < allRows.size) {
      items.add(gap(8))
      items.add(label("+${allRows.size - visible} more", 12f, UIManager.getColor("Link.activeForeground") ?: muted).apply {
        border = BorderFactory.createEmptyBorder(0, 39, 8, 0)
      })
    }
    return items
  }

  fun content(state: String): JPanel {
    val body = column()
    body.border = BorderFactory.createEmptyBorder(18, 18, 18, 18)
    body.add(label(if (state == "grammar") "VIM GRAMMAR" else "LEADER KEYS", 10f, muted, true))
    body.add(gap(14))
    if (state == "prefix" || state == "badges") {
      body.add(flow(key("SPC"), label("›", 18f, muted), key("w")))
      body.add(gap(14))
    }
    val heading = JPanel(BorderLayout()).apply {
      isOpaque = false
      alignmentX = Component.LEFT_ALIGNMENT
      add(label(when (state) { "idle" -> "Start with Space"; "grammar" -> "Build a Vim command"; else -> "Window" }, 17f, bold = true), BorderLayout.WEST)
      if (state == "prefix") add(flow(chip("Visual"), chip("×3")), BorderLayout.EAST)
      maximumSize = Dimension(Int.MAX_VALUE, preferredSize.height)
    }
    body.add(heading)
    body.add(gap(14))
    when (state) {
      "idle" -> {
        body.add(label("In the editor, press Space, then choose a key.", 11f, muted))
        body.add(gap(18)); body.add(rule()); body.add(rows(state)); body.add(gap(16))
        val doctor = column(label("!  Setup needs attention", 12f), gap(6), label("1 key conflict found. Run Doctor to review.", 11f, muted))
        doctor.border = BorderFactory.createCompoundBorder(BorderFactory.createMatteBorder(0, 2, 0, 0, UIManager.getColor("Component.warningFocusColor") ?: muted), BorderFactory.createEmptyBorder(9, 10, 9, 0))
        body.add(doctor)
      }
      "grammar" -> {
        body.add(label("A small pattern. Many combinations.", 12f, muted)); body.add(gap(20))
        val card = column(label("OPERATOR  +  MOTION", 10f, muted, true), gap(14), flow(key("d"), label("+", 14f, muted), key("w")), gap(14), label("Delete to the next word", 14f, bold = true), gap(20))
        for (part in data["grammar"].asJsonObject["parts"].asJsonArray) {
          card.add(flow(key(part.asJsonArray[0].asString), label(part.asJsonArray[1].asString, 12f))); card.add(gap(10))
        }
        card.add(gap(4)); card.add(rule()); card.add(gap(12))
        card.add(label("A count repeats the motion: d2w deletes", 11f, muted))
        card.add(gap(5)); card.add(label("to the second next word.", 11f, muted))
        card.border = BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(line, 1, true), BorderFactory.createEmptyBorder(16, 16, 16, 16))
        body.add(card); body.add(gap(24)); body.add(label("TRY THE SAME PATTERN", 10f, muted, true)); body.add(gap(12))
        body.add(flow(key("c"), key("w"), label("Change a word", 12f))); body.add(gap(16))
        body.add(label("Reference card · type in the editor", 11f, muted))
      }
      else -> {
        body.add(rule()); body.add(rows(state)); body.add(gap(8)); body.add(rule()); body.add(gap(12))
        body.add(flow(key("Esc"), label("Cancel", 11f, muted)))
      }
    }
    body.add(Box.createVerticalGlue())
    return body
  }

}
