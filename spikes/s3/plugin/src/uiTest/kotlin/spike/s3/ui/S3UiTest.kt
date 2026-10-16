package spike.s3.ui

import com.intellij.driver.sdk.ui.components.common.codeEditor
import com.intellij.driver.sdk.ui.components.common.ideFrame
import com.intellij.driver.sdk.ui.ui
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.time.Duration.Companion.minutes

/** Entry point of the Xvfb runs. `s3.case` picks the row; see the spike README for the commands. */
class S3UiTest {
  @Test
  fun run() {
    val name = "${Env.case}-${Env.versionTag}-${Env.toolkit}"
    val ctx = S3Ide.context("s3-$name")
    S3Ide.run(ctx).useDriverAndCloseIde(closeIdeTimeout = 2.minutes) {
      val s = Session(this, name)
      s.open("fixture.txt")
      s.focusWindow()
      val delivered = Rows.deliveryCheck(s)
      s.log(J.obj("event" to "run-start", "deliveryCheck" to delivered, "case" to Env.case, "hosts" to Env.hosts, "trials" to Env.trials))
      assertTrue(delivered, "delivery check failed")
      when (Env.case) {
        "smoke" -> {
          Rows.focus(s)
          Rows.esc(s)
          Rows.control(s)
          Rows.commit(s)
        }
        "focus" -> Rows.focus(s)
        "esc" -> Rows.esc(s)
        "control" -> Rows.control(s)
        "commit" -> Rows.commit(s)
        "hangul-ime" -> Rows.hangulIme(s)
        "dot" -> DotRow.run(s)
        else -> error("unknown case ${Env.case}")
      }
      s.log(J.obj("event" to "run-end", "time" to s.now()))
    }
  }
}
