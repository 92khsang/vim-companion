package dev.vimcompanion.spike.s5;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.ProjectActivity;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.wm.WindowManager;
import java.awt.Frame;
import kotlin.Unit;
import kotlin.coroutines.Continuation;
import org.jetbrains.annotations.NotNull;

/** Opens the fixture file named by s5.fixture in the editor and reports the frame. */
public final class S5ProjectActivity implements ProjectActivity {
    @Override
    public Object execute(@NotNull Project project, @NotNull Continuation<? super Unit> continuation) {
        String fixture = System.getProperty("s5.fixture");
        if (fixture == null || fixture.isEmpty()) {
            return Unit.INSTANCE;
        }
        ApplicationManager.getApplication().invokeLater(() -> {
            VirtualFile file = LocalFileSystem.getInstance().refreshAndFindFileByPath(fixture);
            if (file == null) {
                S5Log.report("fixture-missing");
                return;
            }
            FileEditorManager.getInstance(project).openFile(file, true);
            Frame frame = WindowManager.getInstance().getFrame(project);
            if (frame != null) {
                frame.toFront();
            }
            S5Log.report("fixture-opened\ttitle=" + (frame == null ? "none" : frame.getTitle())
                    + "\tbounds=" + (frame == null ? "none" : frame.getBounds()));
        });
        return Unit.INSTANCE;
    }
}
