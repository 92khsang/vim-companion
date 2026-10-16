package spike.s3

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.testFramework.PlatformTestUtil
import com.maddyhome.idea.vim.api.injector
import java.io.File
import javax.swing.KeyStroke

/**
 * Observer fixture, VIA_IDE: every case of S2's grammar fixture and of S3's observer fixture, run `s3.repeat` times.
 * After each key the observer's latest record must equal the expected state; after a case's `afterTimeout`, the
 * observer's record after the mapping timeout must equal it. Every key must reach IdeaVim through an IDE entry point.
 */
class ObserverFixtureTest : ViaIdeCase() {
  private class Outcome(val ok: Boolean, val line: String)

  override fun setUp() {
    super.setUp()
    Observer.startPolling()
  }

  override fun tearDown() {
    Observer.stopPolling()
    super.tearDown()
  }

  fun testFixture() {
    val dir = File(System.getProperty("s3.fixtures") ?: error("s3.fixtures not set"))
    val out = File(System.getProperty("s3.out") ?: "build/s3-out").apply { mkdirs() }
    val repeat = (System.getProperty("s3.repeat") ?: "1").toInt()
    val files = dir.walk().filter { it.isFile && it.name.endsWith(".json") && !it.name.contains("schema") }
      .sortedBy { it.relativeTo(dir).path }.toList()
    check(files.isNotEmpty()) { "no fixture files in $dir" }
    val version = Harness().ideaVimVersion()
    val lines = ArrayList<String>()
    var cases = 0
    var failed = 0
    for (run in 1..repeat) {
      for (f in files) {
        val doc = JsonParser.parseString(f.readText()).asJsonObject
        val start = doc.getAsJsonObject("start")
        for (case in doc.getAsJsonArray("cases").map { it.asJsonObject }) {
          val o = runCase(run, f.relativeTo(dir).path, start, case)
          cases++
          if (!o.ok) failed++
          lines += o.line
        }
      }
    }
    File(out, "observer-fixture-$version.jsonl").writeText(lines.joinToString("\n", postfix = "\n"))
    File(out, "observer-fixture-$version.summary.json").writeText(
      Json.obj("ideavim" to version, "runs" to repeat, "files" to files.size, "caseRuns" to cases, "failed" to failed, "ultimateErrorsDropped" to droppedUltimateErrors) + "\n"
    )
    assertEquals("failed case runs; see $out", 0, failed)
  }

  private fun runCase(run: Int, file: String, start: JsonObject, case: JsonObject): Outcome {
    val lines = start.getAsJsonArray("lines").map { it.asString }
    val cursor = start.getAsJsonObject("cursor")
    val text = lines.joinToString("\n", postfix = "\n")
    val offset = lines.take(cursor["line"].asInt).sumOf { it.length + 1 } + cursor["column"].asInt
    configure(text, offset)
    sourceRc()
    Probe.clear()
    Observer.clear()
    sent.clear()
    val problems = ArrayList<String>()
    val got = ArrayList<String>()
    for ((i, stepEl) in case.getAsJsonArray("steps").withIndex()) {
      val step = stepEl.asJsonObject
      val key = step["key"].asString
      val recordsBefore = Observer.records.size
      val silentBefore = Observer.silentEvents.size
      send(parseKey(key))
      val rec = Observer.records.drop(recordsBefore).lastOrNull { !it.trigger.startsWith("poll") }
      if (rec == null) {
        problems += "step ${i + 1} $key: no observer record"
        got += "null"
        continue
      }
      got += rec.snapshot.fixture.json()
      compare("step ${i + 1} $key", rec.snapshot.fixture, expectation(step), step.getAsJsonObject("observer"),
        Observer.silentEvents.drop(silentBefore), problems)
    }
    case.getAsJsonObject("afterTimeout")?.let { after ->
      val recordsBefore = Observer.records.size
      val end = System.nanoTime() + 1_600_000_000L
      while (System.nanoTime() < end) {
        PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
        Thread.sleep(20)
      }
      val rec = Observer.records.drop(recordsBefore).lastOrNull() ?: Observer.records.lastOrNull()
      if (rec == null) problems += "afterTimeout: no observer record" else {
        got += rec.snapshot.fixture.json()
        compare("afterTimeout", rec.snapshot.fixture, expectation(after), null, emptyList(), problems)
      }
    }
    val delivery = Delivery.check(sent, Probe.entries.toList())
    if (!delivery.ok) problems += "delivery: " + delivery.detail
    val line = Json.obj(
      "run" to run, "file" to file, "case" to case["id"].asString, "ok" to problems.isEmpty(), "problems" to problems,
      "sent" to sent.toList(), "got" to Json.Raw(got.joinToString(",", "[", "]")),
      "probe" to Json.Raw(Json.arr(Probe.entries.toList().map { Json.Raw(it.json()) })),
      "silentEvents" to Observer.silentEvents.toList(),
    )
    typeKeys("<Esc><Esc>")
    if (injector.registerGroup.isRecording) typeKeys("q")
    return Outcome(problems.isEmpty(), line)
  }

  /** The expected state for IdeaVim: an `engines.ideavim` deviation when the fixture gives one, else `expect`. */
  private fun expectation(step: JsonObject): JsonObject =
    step.getAsJsonObject("engines")?.getAsJsonObject("ideavim")?.getAsJsonObject("expect") ?: step.getAsJsonObject("expect")

  private fun compare(
    where: String, s: FixtureState, want: JsonObject, observer: JsonObject?, silent: List<String>, problems: MutableList<String>,
  ) {
    fun str(e: JsonElement?): String? = if (e == null || e.isJsonNull) null else e.asString
    if (s.mode != want["mode"].asString) problems += "$where: mode ${s.mode}, want ${want["mode"].asString}"
    val pending = want.getAsJsonArray("pending").map { it.asString }
    if (s.pending != pending) problems += "$where: pending ${s.pending}, want $pending"
    if (s.operator != str(want["operator"])) problems += "$where: operator ${s.operator}, want ${str(want["operator"])}"
    val count = want["count"]?.takeUnless { it.isJsonNull }?.asInt
    if (s.count != count) problems += "$where: count ${s.count}, want $count"
    if (s.register != str(want["register"])) problems += "$where: register ${s.register}, want ${str(want["register"])}"
    if (observer != null) {
      if (observer.has("prompt") && s.prompt != str(observer["prompt"])) problems += "$where: prompt ${s.prompt}, want ${str(observer["prompt"])}"
      if (observer.has("recording") && s.recording != str(observer["recording"])) problems += "$where: recording ${s.recording}, want ${str(observer["recording"])}"
      observer.getAsJsonArray("during")?.map { it.asString }?.forEach { state ->
        val seen = silent.filter { ev -> ev.substringBefore(' ').split('+').contains(state) }
        if (seen.isEmpty()) problems += "$where: observer saw no '$state' state while the key ran"
        if (seen.any { it.endsWith("hostShowing=true") }) problems += "$where: host showed during '$state'"
      }
    }
  }

  private fun parseKey(key: String): KeyStroke =
    if (key == "<") KeyStroke.getKeyStroke('<') else injector.parser.parseKeys(key).single()
}
