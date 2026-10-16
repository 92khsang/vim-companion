package spike.s3

/** Minimal JSON writer, so that the spike plugin needs no library beyond the platform. */
internal object Json {
  fun str(s: String?): String {
    if (s == null) return "null"
    val b = StringBuilder(s.length + 2)
    b.append('"')
    for (c in s) {
      when {
        c == '"' -> b.append("\\\"")
        c == '\\' -> b.append("\\\\")
        c == '\n' -> b.append("\\n")
        c == '\r' -> b.append("\\r")
        c == '\t' -> b.append("\\t")
        c < ' ' || c.code in 0x7F..0x9F || c.isSurrogate() -> b.append(String.format("\\u%04x", c.code))
        else -> b.append(c)
      }
    }
    b.append('"')
    return b.toString()
  }

  fun obj(vararg pairs: Pair<String, Any?>): String =
    pairs.joinToString(",", "{", "}") { (k, v) -> str(k) + ":" + value(v) }

  fun arr(items: Iterable<Any?>): String = items.joinToString(",", "[", "]") { value(it) }

  /** A value that is already JSON text. */
  class Raw(val text: String)

  fun value(v: Any?): String = when (v) {
    null -> "null"
    is Raw -> v.text
    is String -> str(v)
    is Char -> str(v.toString())
    is Boolean, is Int, is Long -> v.toString()
    is Double -> if (v.isFinite()) v.toString() else "null"
    is Iterable<*> -> arr(v)
    is Map<*, *> -> v.entries.joinToString(",", "{", "}") { str(it.key.toString()) + ":" + value(it.value) }
    else -> str(v.toString())
  }
}
