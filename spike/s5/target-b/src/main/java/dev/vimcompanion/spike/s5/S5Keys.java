package dev.vimcompanion.spike.s5;

import java.awt.event.InputEvent;
import java.awt.event.KeyEvent;

/** Names a key press the way the committed key sequence names it, such as {@code Cmd+Shift+k}. */
final class S5Keys {
    private S5Keys() {}

    /** Returns null for a press of a modifier key alone: a chord counts as one key. */
    static String describe(KeyEvent e) {
        int code = e.getKeyCode();
        switch (code) {
            case KeyEvent.VK_SHIFT, KeyEvent.VK_CONTROL, KeyEvent.VK_META, KeyEvent.VK_ALT,
                 KeyEvent.VK_ALT_GRAPH, KeyEvent.VK_CAPS_LOCK, KeyEvent.VK_WINDOWS -> {
                return null;
            }
            default -> {
            }
        }
        StringBuilder sb = new StringBuilder();
        int m = e.getModifiersEx();
        if ((m & InputEvent.CTRL_DOWN_MASK) != 0) sb.append("Ctrl+");
        if ((m & InputEvent.META_DOWN_MASK) != 0) sb.append("Cmd+");
        if ((m & InputEvent.ALT_DOWN_MASK) != 0) sb.append("Alt+");
        if ((m & InputEvent.SHIFT_DOWN_MASK) != 0) sb.append("Shift+");
        if (code >= KeyEvent.VK_A && code <= KeyEvent.VK_Z) {
            sb.append((char) ('a' + (code - KeyEvent.VK_A)));
        } else if (code >= KeyEvent.VK_0 && code <= KeyEvent.VK_9) {
            sb.append((char) ('0' + (code - KeyEvent.VK_0)));
        } else if (code == KeyEvent.VK_SPACE) {
            sb.append("Space");
        } else if (code == KeyEvent.VK_ESCAPE) {
            sb.append("Escape");
        } else {
            sb.append("VK").append(code);
        }
        return sb.toString();
    }
}
