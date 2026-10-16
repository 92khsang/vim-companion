package spike.s3

import java.io.File

/**
 * Harness proof for the VIA_IDE row: every key the harness sends must enter IdeaVim's key handler exactly once, through
 * `TypedAction` or `VimShortcutKeyAction`, in the order sent, and no key may enter through a direct call.
 */
class DeliveryProofTest : ViaIdeCase() {
  private val sequences = listOf(
    " ", " w", " b", "3", "3d", "d3", "d", "c", "y", "di", "f", "t", "r", "\"a", "v", "v ",
    "d<Esc>", " w<Esc>", "qaxq", "@a", "x.", ":", "/", "fa", "3dd", " x", "<C-[>", "ix<Esc>",
  )

  fun testEveryKeyEntersThroughAnIdeEntryPoint() {
    val out = File(System.getProperty("s3.out") ?: "build/s3-out").apply { mkdirs() }
    val repeat = (System.getProperty("s3.repeat") ?: "1").toInt()
    val lines = mutableListOf<String>()
    var failures = 0
    for (run in 1..repeat) {
      for (seq in sequences) {
        configure("alpha beta gamma\nsecond line here\nthird line\nfourth line\n")
        sourceRc()
        Probe.clear()
        Observer.clear()
        sent.clear()
        typeKeys(seq)
        val r = Delivery.check(sent, Probe.entries.toList())
        if (!r.ok) failures++
        lines += Json.obj(
          "run" to run, "sequence" to seq, "ok" to r.ok, "detail" to r.detail, "sent" to sent.toList(),
          "probe" to Json.Raw(Json.arr(Probe.entries.toList().map { Json.Raw(it.json()) })),
        )
        typeKeys("<Esc><Esc>")
      }
    }
    File(out, "delivery-proof-${ideaVim()}.jsonl").writeText(lines.joinToString("\n", postfix = "\n"))
    assertEquals("sequences with a delivery failure; see ${out}", 0, failures)
  }

  private fun ideaVim() = Harness().ideaVimVersion()
}

object Delivery {
  data class Result(val ok: Boolean, val detail: String)

  /**
   * Compares the keys a harness sent with the probe's entries. A key counts as delivered when exactly one entry with
   * `nested == 0` carries it, through the entry point that matches its IDE path. Entries with `nested > 0` are keys
   * that IdeaVim replays inside a delivered key and are reported separately.
   */
  fun check(sent: List<String>, entries: List<Probe.Entry>): Result {
    val first = entries.filter { it.nested == 0 }
    val direct = entries.count { it.via == "direct" }
    val wrongVia = first.filterNot {
      (it.via == "TypedAction" && it.ideKind == "typed") || (it.via == "VimShortcutKeyAction" && it.ideKind == "shortcut")
    }
    val keys = first.map { it.ideKey }
    val ok = direct == 0 && wrongVia.isEmpty() && keys == sent
    val detail = if (ok) "ok" else "sent=$sent got=$keys direct=$direct wrongVia=${wrongVia.map { it.via + ":" + it.ideKey }}"
    return Result(ok, detail)
  }
}
