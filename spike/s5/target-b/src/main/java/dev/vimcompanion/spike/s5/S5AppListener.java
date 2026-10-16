package dev.vimcompanion.spike.s5;

import com.intellij.ide.AppLifecycleListener;
import com.intellij.ide.IdeEventQueue;
import com.intellij.ide.plugins.IdeaPluginDescriptor;
import com.intellij.ide.plugins.PluginManagerCore;
import com.intellij.openapi.application.ApplicationInfo;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.extensions.PluginId;
import java.awt.AWTEvent;
import java.awt.event.KeyEvent;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Reports the plugin version that the IDE loaded and, when s5.keylog is set, logs every key press
 * that reaches the IDE event queue and consumes it, so no IDE action runs during the probe.
 */
public final class S5AppListener implements AppLifecycleListener {
    static final String PLUGIN_ID = "dev.vimcompanion.spike.s5";
    private static final AtomicInteger COUNT = new AtomicInteger();

    @Override
    public void appStarted() {
        IdeaPluginDescriptor plugin = PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID));
        ApplicationInfo info = ApplicationInfo.getInstance();
        S5Log.report("started\tpluginVersion=" + (plugin == null ? "none" : plugin.getVersion())
                + "\tide=" + info.getFullVersion() + "\tbuild=" + info.getBuild().asString()
                + "\tpid=" + ProcessHandle.current().pid()
                + "\tjava=" + System.getProperty("java.runtime.version"));
        if (System.getProperty("s5.keylog") != null) {
            installProbe();
        }
        if (Boolean.getBoolean("s5.exitAfterReport")) {
            ApplicationManager.getApplication().invokeLater(
                    () -> ApplicationManager.getApplication().exit(true, true, false));
        }
    }

    private static void installProbe() {
        IdeEventQueue.getInstance().addDispatcher(S5AppListener::dispatch, ApplicationManager.getApplication());
        S5Log.report("probe-installed");
    }

    private static boolean dispatch(AWTEvent event) {
        if (!(event instanceof KeyEvent key)) {
            return false;
        }
        if (key.getID() == KeyEvent.KEY_PRESSED) {
            String name = S5Keys.describe(key);
            if (name != null) {
                int n = COUNT.incrementAndGet();
                S5Log.append("s5.keylog", n + "\t" + System.currentTimeMillis() + "\t" + name
                        + "\tcode=" + key.getKeyCode() + " mods=" + key.getModifiersEx());
            }
        }
        return true;
    }
}
