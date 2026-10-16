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

  /** Hangul input without an input method: letters arrive as committed jamo, other keys as keys. */
  fun hangulIme(s: Session) {
    for (host in Env.hosts) {
      s.h.setHost(host, true)
      for (n in 1..Env.trials) hangulTrial(s, host, n)
    }
  }

  fun hangulTrial(s: Session, host: String, n: Int) {
    val seqs = listOf(
      "SPC g" to listOf(Step.Type(' '), Step.Ime("c:ㅎ|C:ㅎ", 1)),
      "SPC SPC" to listOf(Step.Type(' '), Step.Type(' ')),
      "SPC /" to listOf(Step.Type(' '), Step.Type('/')),
      "SPC Shift+Space" to listOf(Step.Type(' '), Step.SHIFT_SPACE),
      "SPC Esc" to listOf(Step.Type(' '), Step.ESC),
      "SPC Ctrl+[" to listOf(Step.Type(' '), Step.CTRL_BRACKET),
    )
    for ((name, steps) in seqs) {
      s.reset(TEXT, 9)
      trial(s, "hangul:$name", host, n, steps, checkFocus = false)
      s.closePopups()
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
    for (c in cases) {
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

  val sequences = listOf(
    Seq("SPC g", listOf(Step.Type(' ') to SETTLE, Step.Type('g') to TIMEOUT, Step.ESC to SETTLE)),
    Seq("SPC SPC", listOf(Step.Type(' ') to SETTLE, Step.Type(' ') to TIMEOUT)),
    Seq("SPC /", listOf(Step.Type(' ') to SETTLE, Step.Type('/') to TIMEOUT)),
    Seq("SPC Shift+Space", listOf(Step.Type(' ') to SETTLE, Step.SHIFT_SPACE to TIMEOUT)),
    Seq("SPC Esc", listOf(Step.Type(' ') to SETTLE, Step.ESC to SETTLE)),
    Seq("SPC Ctrl+[", listOf(Step.Type(' ') to SETTLE, Step.CTRL_BRACKET to SETTLE)),
  )

  fun run(s: Session) {
    val hosts = if (Env.pluginOff) listOf("off") else Env.hosts
    for (host in hosts) {
      if (!Env.pluginOff) s.h.setHost(host, true)
      for (n in 1..Env.trials) {
        for (seq in sequences) {
          try {
            one(s, host, n, seq)
          } catch (e: Throwable) {
            s.log(J.obj("case" to "hangul-ibus:${seq.name}", "host" to host, "trial" to n, "error" to e.toString()))
          }
          s.closePopups()
        }
      }
    }
  }

  private fun one(s: Session, host: String, n: Int, seq: Seq) {
    s.reset(Rows.TEXT, 9)
    val before = s.ensureHangulMode()
    val ibusFrom = s.ibusEvents.size
    if (!Env.pluginOff) s.h.beginTrial()
    val steps = ArrayList<String>()
    for ((step, wait) in seq.steps) {
      s.keys.press(step)
      Thread.sleep(wait)
      steps += J.obj(
        "step" to step.label, "shell" to J.Raw(s.shellState().ifEmpty { "null" }),
        "delivered" to (if (Env.pluginOff) null else s.h.deliveredKeys()),
        "hostShowing" to (if (Env.pluginOff) null else s.h.hostShowing()),
      )
    }
    val state = if (Env.pluginOff) RemoteState.state(s.driver) else s.h.report()
    s.log(J.obj(
      "case" to "hangul-ibus:${seq.name}", "host" to host, "trial" to n, "ideavim" to Env.ideavim, "toolkit" to Env.toolkit,
      "variant" to System.getProperty("s3.rcExtra").orEmpty(), "pluginOff" to Env.pluginOff, "time" to s.now(),
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
