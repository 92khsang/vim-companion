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
      s.log(J.obj("event" to "delivery-check", "sequence" to name, "logged" to keysLogged, "want" to want, "pass" to pass))
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
    Case("]d", "Errors.java", "class Errors {\n  void f() {\n    int a = ;\n    int b = ;\n  }\n}\n", 0, Step.keys("]d")),
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
    for (step in listOf<Step>(Step.Type('x')) + c.action) {
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
