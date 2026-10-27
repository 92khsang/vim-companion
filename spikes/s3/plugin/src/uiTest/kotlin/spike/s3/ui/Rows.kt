package spike.s3.ui

/**
 * The measured rows of issue #12 that run under Xvfb with the Driver. Each trial appends one JSON line with every step
 * result and the harness report; the pass/fail counts are computed afterwards from these lines.
 */
object Rows {
  const val TEXT = "line one\nline two\nline three\nline four\nline five\nline six\n"

  private fun trial(s: Session, case: String, host: String, n: Int, steps: List<Step>, checkFocus: Boolean, timeoutMs: Long = 3000): String =
    try {
      trialOrThrow(s, case, host, n, steps, checkFocus, timeoutMs)
    } catch (e: Throwable) {
      val line = J.obj("case" to case, "host" to host, "trial" to n, "ideavim" to Env.ideavim, "error" to e.toString())
      s.log(line)
      line
    }

  private fun trialOrThrow(s: Session, case: String, host: String, n: Int, steps: List<Step>, checkFocus: Boolean, timeoutMs: Long): String {
    s.h.beginTrial()
    var expected = 0
    val results = ArrayList<StepResult>()
    for (step in steps) {
      expected += step.expectedKeys
      results += s.send(step, expected, checkFocus, timeoutMs)
    }
    // Let the observer's 100 ms poll and any queued events settle before the report.
    Thread.sleep(150)
    val report = s.h.report()
    val line = J.obj(
      "case" to case, "host" to host, "trial" to n, "ideavim" to Env.ideavim, "toolkit" to Env.toolkit, "time" to s.now(),
      "sent" to steps.map { it.label }, "steps" to J.Raw(results.joinToString(",", "[", "]") { it.json() }),
      "report" to J.Raw(report),
    )
    s.log(line)
    return line
  }

  /** Start of every run: the probe must log 100% of the injected keys of `SPC w Esc` and `d i Esc`. */
  fun deliveryCheck(s: Session): Boolean {
    s.h.setHost("none", false)
    var ok = true
    for ((name, keys) in listOf("SPC w Esc" to Step.keys(" w") + Step.ESC, "d i Esc" to Step.keys("di") + Step.ESC)) {
      s.reset(TEXT, 0)
      val line = trial(s, "delivery-check:$name", "none", 0, keys, checkFocus = true)
      val keysLogged = s.h.deliveredKeys().split('\t')
      val want = keys.map { if (it is Step.Type && it.c == ' ') " " else it.label }
      val pass = keysLogged == want && !line.contains("\"delivered\":false")
      s.log(J.obj(
        "event" to "delivery-check", "sequence" to name, "logged" to keysLogged, "want" to want, "pass" to pass,
        "shell" to s.shellState(), "windows" to J.Raw(s.h.windows()), "focusOwner" to s.h.focusOwner(),
      ))
      ok = ok && pass
    }
    return ok
  }

  /** Focus row: `SPC w Esc` and `d i Esc` show, update and hide the host. */
  fun focus(s: Session) {
    for (host in Env.hosts) {
      s.h.setHost(host, true)
      for (n in 1..Env.trials) {
        for ((name, keys) in listOf("SPC w Esc" to Step.keys(" w") + Step.ESC, "d i Esc" to Step.keys("di") + Step.ESC)) {
          s.reset(TEXT, 0)
          trial(s, "focus:$name", host, n, keys, checkFocus = true)
        }
      }
    }
  }

  /** `Esc` row: `d`, wait until the host shows, `Esc`, `j`. Nothing may be deleted and the caret moves down 1 line. */
  fun esc(s: Session, hosts: List<String> = Env.hosts, trials: Int = Env.trials) {
    for (host in hosts) {
      s.h.setHost(host, true)
      for (n in 1..trials) {
        s.reset(TEXT, 0)
        trial(s, "esc:d Esc j", host, n, listOf(Step.Type('d'), Step.WaitHost, Step.ESC, Step.Type('j')), checkFocus = true, timeoutMs = 2000)
      }
    }
  }

  /** Control for the `Esc` row: a JBPopupFactory popup that does not take focus. The issue asks for 100 trials. */
  fun control(s: Session) = esc(s, listOf("control"), Env.trials)

  /** Committed Hangul: `ㅎ`, `한` and `한글` committed by input-method events in Normal mode. */
  fun commit(s: Session) {
    s.h.setHost(Env.hosts.firstOrNull() ?: "layer", true)
    val texts = listOf(
      "ㅎ" to "c:ㅎ|C:ㅎ",
      "한" to "c:ㅎ|c:하|c:한|C:한",
      "한글" to "c:ㅎ|c:하|c:한|c:한ㄱ|c:한그|c:한글|C:한글",
    )
    for (n in 1..Env.trials) {
      for ((text, steps) in texts) {
        s.reset(TEXT, 0)
        trial(s, "commit:$text", Env.hosts.firstOrNull() ?: "layer", n, listOf(Step.Ime(steps, text.length)), checkFocus = true)
      }
    }
  }
}

/**
 * `.` after a mapping to `<Action>`: `x`, the mapping, then `.`. Two references per trial give the results of `x`
 * alone and of the action alone in place of `.`.
 */
object DotRow {
  class Case(val name: String, val file: String, val text: String, val caret: Int, val action: List<Step>)

  val cases = listOf(
    Case("SPC c f", "Reformat.java", "class Reformat {\nint   a=1;\n  void f( ){int b =2 ;}\n}\n", 17, Step.keys(" cf")),
    // `x` deletes a character inside a comment, so that it adds no error and `]d` always goes to the same error.
    Case("]d", "Errors.java", "// note x\nclass Errors {\n  void f() {\n    int a = ;\n    int b = ;\n  }\n}\n", 8, Step.keys("]d")),
  )

  fun run(s: Session) {
    s.h.setHost(Env.hosts.firstOrNull() ?: "layer", true)
    // s3.dotCases picks and orders the cases by name, separated by commas (diagnostic runs); default: both, in order.
    val names = System.getProperty("s3.dotCases")?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
    val chosen = if (names == null) cases else names.map { n -> cases.single { it.name == n } }
    for (c in chosen) {
      s.log(J.obj("event" to "open", "detail" to s.h.openFile(c.file)))
      Thread.sleep(1000)
      for (n in 1..Env.trials) {
        for (variant in listOf("dot", "ref-x", "ref-action")) {
          try {
            one(s, c, n, variant)
          } catch (e: Throwable) {
            s.log(J.obj("case" to "dot:${c.name}", "variant" to variant, "trial" to n, "error" to e.toString()))
          }
        }
      }
    }
  }

  private fun one(s: Session, c: Case, n: Int, variant: String) {
    s.reset(c.text, c.caret)
    if (c.file == "Errors.java") s.waitUntil(15000) { s.h.errorCount() >= 2 }
    s.h.beginTrial()
    var expected = 0
    val steps = ArrayList<StepResult>()
    expected += 1
    steps += s.send(Step.Type('x'), expected, checkFocus = false)
    if (c.file == "Errors.java") waitErrorsStable(s)
    for (step in c.action) {
      expected += step.expectedKeys
      steps += s.send(step, expected, checkFocus = false)
    }
    waitStable(s)
    val before = s.h.report()
    s.h.beginTrial()
    val last = when (variant) {
      "dot" -> listOf(Step.Type('.'))
      "ref-x" -> listOf(Step.Type('x'))
      else -> c.action
    }
    expected = 0
    for (step in last) {
      expected += step.expectedKeys
      steps += s.send(step, expected, checkFocus = false)
    }
    waitStable(s)
    val after = s.h.report()
    s.log(J.obj(
      "case" to "dot:${c.name}", "variant" to variant, "trial" to n, "ideavim" to Env.ideavim, "time" to s.now(),
      "errorsBefore" to s.h.errorCount(), "steps" to J.Raw(steps.joinToString(",", "[", "]") { it.json() }),
      "beforeLast" to J.Raw(before), "after" to J.Raw(after),
    ))
  }

  /** Waits until the daemon has published the same error count for 1 s, at most 15 s. */
  private fun waitErrorsStable(s: Session) {
    var last = -2
    var since = System.nanoTime()
    val end = System.nanoTime() + 15_000_000_000L
    while (System.nanoTime() < end) {
      val n = s.h.errorCount()
      if (n != last) {
        last = n
        since = System.nanoTime()
      } else if (n >= 2 && System.nanoTime() - since > 1_000_000_000L) {
        return
      }
      Thread.sleep(100)
    }
  }

  /** Waits until the text and caret have not changed for 600 ms, at most 10 s. */
  private fun waitStable(s: Session) {
    var last = ""
    var stableSince = System.nanoTime()
    val end = System.nanoTime() + 10_000_000_000L
    while (System.nanoTime() < end) {
      val now = s.h.editorText() + "@" + s.h.caretOffset()
      if (now != last) {
        last = now
        stableSince = System.nanoTime()
      } else if (System.nanoTime() - stableSince > 600_000_000L) {
        return
      }
      Thread.sleep(50)
    }
  }
}

/**
 * Hangul rows with real IBus and ibus-hangul in the GNOME harness. Every sequence starts in Normal mode and in
 * ibus-hangul's Hangul mode. Steps do not wait for an expected key count, because whether and when a key reaches
 * IdeaVim is what these rows measure; each step waits a fixed time and records what arrived.
 */
object HangulIbus {
  class Seq(val name: String, val steps: List<Pair<Step, Long>>)

  private const val SETTLE = 400L
  private const val TIMEOUT = 1500L // longer than IdeaVim's default 'timeoutlen' of 1000 ms
  private const val ACTION = 800L // the IDE action of a leader mapping opens its popup or dialog

  /**
   * `s3.hangulTiming` selects the timing of the real-IBus `SPC g` sequence. `default` (the sequences above): the letter
   * comes 400 ms after `SPC` and `Esc` 1500 ms later, so the committed jamo reaches IdeaVim about 2000 ms after `SPC`,
   * when IdeaVim's 1000 ms mapping timeout has already dropped `SPC` and the host has hidden. `fast`: the letter comes
   * 200 ms after `SPC` and `Esc` 300 ms after the letter, so the jamo reaches IdeaVim at about 600 ms (the recording
   * between steps adds about 50 ms per step), while `SPC` is still pending; this is the case condition (2) of the
   * Hangul row describes. The `fast` variant runs the `SPC g` sequence only, because the other sequences commit
   * nothing. Each step's wait is unchanged in `default`.
   */
  val timing: String = System.getProperty("s3.hangulTiming")?.takeIf { it.isNotBlank() } ?: "default"
  private const val FAST_LETTER = 200L
  private const val FAST_ESC = 300L
  private const val FAST_SETTLE = 1000L // long enough to also record a mapping timeout, should the jamo come late

  /** The run's variant label: the extra rc lines (keep-english) and, when it is not the default, the timing. */
  private val variant: String =
    listOf(System.getProperty("s3.rcExtra").orEmpty(), if (timing == "default") "" else timing).filter { it.isNotEmpty() }.joinToString("+")

  /**
   * Xvfb without an input method: the Driver posts the input-method events that commit the jamo; every other key is
   * a real key, including `Shift+Space`, which reaches the IDE because no input method consumes it.
   */
  val sequencesNoIme = listOf(
    Seq("SPC g", listOf(Step.Type(' ') to SETTLE, Step.Ime("c:ㅎ|C:ㅎ", 1) to TIMEOUT)),
    Seq("SPC SPC", listOf(Step.Type(' ') to SETTLE, Step.Type(' ') to ACTION)),
    Seq("SPC /", listOf(Step.Type(' ') to SETTLE, Step.Type('/') to ACTION)),
    Seq("SPC Shift+Space", listOf(Step.Type(' ') to SETTLE, Step.SHIFT_SPACE to TIMEOUT)),
    Seq("SPC Esc", listOf(Step.Type(' ') to SETTLE, Step.ESC to SETTLE)),
    Seq("SPC Ctrl+[", listOf(Step.Type(' ') to SETTLE, Step.CTRL_BRACKET to SETTLE)),
  )

  /** Real IBus: `g` in Hangul mode starts composing ㅎ; `Esc`, ibus-hangul's off key, commits it and reaches IdeaVim. */
  val sequences = listOf(
    Seq("SPC g", listOf(Step.Type(' ') to SETTLE, Step.Type('g') to TIMEOUT, Step.ESC to SETTLE)),
    Seq("SPC SPC", listOf(Step.Type(' ') to SETTLE, Step.Type(' ') to ACTION)),
    Seq("SPC /", listOf(Step.Type(' ') to SETTLE, Step.Type('/') to ACTION)),
    Seq("SPC Shift+Space", listOf(Step.Type(' ') to SETTLE, Step.SHIFT_SPACE to TIMEOUT)),
    Seq("SPC Esc", listOf(Step.Type(' ') to SETTLE, Step.ESC to SETTLE)),
    Seq("SPC Ctrl+[", listOf(Step.Type(' ') to SETTLE, Step.CTRL_BRACKET to SETTLE)),
  )

  val sequencesFast = listOf(
    Seq("SPC g", listOf(Step.Type(' ') to FAST_LETTER, Step.Type('g') to FAST_ESC, Step.ESC to FAST_SETTLE)),
  )

  fun run(s: Session) = when {
    Env.mode != "gnome" && timing != "default" -> error("s3.hangulTiming=$timing needs the gnome mode (real IBus)")
    Env.mode != "gnome" -> runAll(s, sequencesNoIme, "hangul-ime")
    timing == "default" -> runAll(s, sequences, "hangul-ibus")
    timing == "fast" -> runAll(s, sequencesFast, "hangul-ibus")
    else -> error("unknown s3.hangulTiming $timing (default or fast)")
  }

  private fun runAll(s: Session, seqs: List<Seq>, row: String) {
    val hosts = if (Env.pluginOff) listOf("off") else Env.hosts
    for (host in hosts) {
      if (!Env.pluginOff) s.h.setHost(host, true)
      for (n in 1..Env.trials) {
        for (seq in seqs) {
          try {
            one(s, row, host, n, seq)
          } catch (e: Throwable) {
            s.log(J.obj("case" to "$row:${seq.name}", "host" to host, "trial" to n, "error" to e.toString()))
          }
          s.closePopups()
        }
      }
    }
  }

  private fun one(s: Session, row: String, host: String, n: Int, seq: Seq) {
    s.reset(Rows.TEXT, 9)
    val before = if (Env.mode == "gnome") s.ensureHangulMode() else ""
    // A trial that starts without the editor's focus measures nothing: its keys reach no component.
    if (!s.editorFocused()) error("the editor has no focus at the start of the trial")
    val ibusFrom = s.ibusEvents.size
    if (!Env.pluginOff) s.h.beginTrial()
    val steps = ArrayList<String>()
    for ((step, wait) in seq.steps) {
      when (step) {
        is Step.Ime -> if (Env.pluginOff) RemoteState.postIme(s.driver, step.steps) else
          s.h.postIme(step.steps).let { if (!it.startsWith("posted")) error("input-method events not posted: $it") }
        else -> s.keys.press(step)
      }
      Thread.sleep(wait)
      steps += J.obj(
        "step" to step.label, "shell" to J.Raw(s.shellState().ifEmpty { "null" }),
        "delivered" to (if (Env.pluginOff) null else s.h.deliveredKeys()),
        "hostShowing" to (if (Env.pluginOff) null else s.h.hostShowing()),
        "focusOwner" to (if (Env.pluginOff) null else s.h.focusOwner()),
      )
    }
    val state = if (Env.pluginOff) RemoteState.state(s.driver) else s.h.report()
    s.log(J.obj(
      "case" to "$row:${seq.name}", "host" to host, "trial" to n, "ideavim" to Env.ideavim, "toolkit" to Env.toolkit,
      "variant" to variant, "pluginOff" to Env.pluginOff, "time" to s.now(),
      "shellBefore" to J.Raw(before.ifEmpty { "null" }), "steps" to J.Raw(steps.joinToString(",", "[", "]")),
      "ibusEvents" to s.ibusEvents.toList().drop(ibusFrom), "state" to J.Raw(state),
    ))
  }

  /** Committed Hangul through real ibus-hangul: `ㅎ`, `한` and `한글` typed in Hangul mode in Normal mode. */
  fun commits(s: Session) {
    if (!Env.pluginOff) s.h.setHost(Env.hosts.firstOrNull() ?: "layer", true)
    val texts = listOf("ㅎ" to "g", "한" to "gks", "한글" to "gksrmf")
    for (n in 1..Env.trials) {
      for ((text, keys) in texts) {
        try {
          s.reset(Rows.TEXT, 0)
          val before = s.ensureHangulMode()
          s.h.beginTrial()
          for (c in keys) {
            s.keys.press(Step.Type(c))
            Thread.sleep(30)
          }
          // Shift+Space leaves Hangul mode, which makes ibus-hangul commit what it is still composing.
          s.keys.press(Step.SHIFT_SPACE)
          s.waitUntil(1500) { s.h.deliveredCount() >= text.length }
          Thread.sleep(150)
          s.log(J.obj(
            "case" to "commit-ibus:$text", "host" to (Env.hosts.firstOrNull() ?: "layer"), "trial" to n,
            "ideavim" to Env.ideavim, "toolkit" to Env.toolkit, "time" to s.now(), "shellBefore" to J.Raw(before.ifEmpty { "null" }),
            "steps" to J.Raw("[]"), "report" to J.Raw(s.h.report()),
          ))
        } catch (e: Throwable) {
          s.log(J.obj("case" to "commit-ibus:$text", "trial" to n, "error" to e.toString()))
        }
      }
    }
  }
}

/**
 * Part 2 of the GNOME harness proof: Hangul typed in Hangul mode is composed by ibus-hangul and committed to the
 * editor. In Insert mode, `gksrmf` in Dubeolsik must insert 한글.
 */
object ImeProof {
  fun run(s: Session) {
    for (n in 1..Env.trials) {
      try {
        s.reset(Rows.TEXT, 0)
        s.keys.press(Step.Type('i'))
        Thread.sleep(200)
        val before = s.ensureHangulMode()
        for (c in "gksrmf") {
          s.keys.press(Step.Type(c))
          Thread.sleep(30)
        }
        // Escape is ibus-hangul's off key: it commits the syllable being composed and still reaches IdeaVim.
        s.keys.press(Step.ESC)
        Thread.sleep(400)
        val text = s.h.editorText()
        s.log(J.obj(
          "case" to "ime-proof", "trial" to n, "ideavim" to Env.ideavim, "toolkit" to Env.toolkit, "time" to s.now(),
          "shellBefore" to J.Raw(before.ifEmpty { "null" }), "shellAfter" to J.Raw(s.shellState().ifEmpty { "null" }),
          "inserted" to text.removeSuffix(Rows.TEXT), "ok" to (text == "한글" + Rows.TEXT), "mode" to s.h.mode(),
        ))
      } catch (e: Throwable) {
        s.log(J.obj("case" to "ime-proof", "trial" to n, "error" to e.toString()))
      }
    }
  }
}

/**
 * The observer fixture through the Driver under Xvfb: keys go through AWT key dispatch. Each case logs the
 * observer's record after every key (and after the mapping timeout); scripts/fixture_check.py compares them with the
 * fixture.
 */
object FixtureRow {
  fun run(s: Session) {
    val dir = java.io.File(System.getProperty("s3.fixtures") ?: error("s3.fixtures"))
    val files = dir.walk().filter { it.isFile && it.name.endsWith(".json") && !it.name.contains("schema") && it.name != "ideavim-deviations.json" }
      .sortedBy { it.relativeTo(dir).path }.toList()
    s.h.setHost(Env.hosts.firstOrNull() ?: "layer", true)
    for (n in 1..Env.trials) {
      for (f in files) {
        val doc = com.google.gson.JsonParser.parseString(f.readText()).asJsonObject
        val start = doc.getAsJsonObject("start")
        val lines = start.getAsJsonArray("lines").map { it.asString }
        val cursor = start.getAsJsonObject("cursor")
        val text = lines.joinToString("\n", postfix = "\n")
        val offset = lines.take(cursor["line"].asInt).sumOf { it.length + 1 } + cursor["column"].asInt
        for (case in doc.getAsJsonArray("cases").map { it.asJsonObject }) {
          try {
            one(s, n, f.relativeTo(dir).path, case, text, offset)
          } catch (e: Throwable) {
            s.log(J.obj("case" to "fixture:${case["id"].asString}", "file" to f.relativeTo(dir).path, "trial" to n, "error" to e.toString()))
          }
          s.closePopups()
          if (s.h.snapshot().contains("\"recording\":\"")) s.keys.press(Step.Type('q'))
        }
      }
    }
  }

  private fun one(s: Session, n: Int, file: String, case: com.google.gson.JsonObject, text: String, offset: Int) {
    s.reset(text, offset)
    s.h.beginTrial()
    val records = ArrayList<String>()
    var expected = 0
    for (stepEl in case.getAsJsonArray("steps")) {
      val key = stepEl.asJsonObject["key"].asString
      expected++
      val r = s.send(step(key), expected, checkFocus = false)
      Thread.sleep(60)
      records += J.obj("key" to key, "delivered" to r.delivered, "report" to J.Raw(s.h.report()))
    }
    val after = if (case.has("afterTimeout")) {
      Thread.sleep(1600)
      s.h.report()
    } else "null"
    s.log(J.obj(
      "case" to "fixture:${case["id"].asString}", "file" to file, "trial" to n, "ideavim" to Env.ideavim, "toolkit" to Env.toolkit,
      "time" to s.now(), "steps" to J.Raw(records.joinToString(",", "[", "]")), "afterTimeout" to J.Raw(after),
    ))
  }

  @Suppress("DEPRECATION")
  fun step(key: String): Step = when {
    key == "<Space>" -> Step.Type(' ')
    key == "<Esc>" -> Step.ESC
    key == "<CR>" -> Step.Code(key, java.awt.event.KeyEvent.VK_ENTER)
    key == "<Tab>" -> Step.Code(key, java.awt.event.KeyEvent.VK_TAB)
    key == "<BS>" -> Step.Code(key, java.awt.event.KeyEvent.VK_BACK_SPACE)
    key == "<C-[>" -> Step.CTRL_BRACKET
    key == "<C-]>" -> Step.Code(key, java.awt.event.KeyEvent.VK_CLOSE_BRACKET, java.awt.event.InputEvent.CTRL_MASK)
    key.startsWith("<C-") && key.length == 5 ->
      Step.Code(key, java.awt.event.KeyEvent.VK_A + (key[3] - 'a'), java.awt.event.InputEvent.CTRL_MASK)
    key.length == 1 -> Step.Type(key[0])
    else -> error("unsupported key $key")
  }
}

/**
 * For the runs with IdeaVimExtension's keep-english-in-normal on: confirms that the extension switches the IBus engine
 * when Insert mode ends. Each try enters Insert mode in Hangul mode and leaves it with `Esc`, and records the IBus
 * global engine changes in the next second.
 */
object KeepEnglishCheck {
  fun run(s: Session, tries: Int = 5) {
    for (n in 1..tries) {
      s.reset(Rows.TEXT, 0)
      s.keys.press(Step.Type('i'))
      Thread.sleep(300)
      val inInsert = s.ensureHangulMode()
      val from = s.ibusEvents.size
      s.keys.press(Step.ESC)
      Thread.sleep(1000)
      s.log(J.obj(
        "event" to "keep-english-check", "try" to n, "shellInInsert" to J.Raw(inInsert.ifEmpty { "null" }),
        "ibusEventsAfterEsc" to s.ibusEvents.toList().drop(from), "shellAfter" to J.Raw(s.shellState().ifEmpty { "null" }),
        "engineAfter" to s.ibus("engine"), "mode" to (if (Env.pluginOff) null else s.h.mode()),
      ))
    }
  }
}
