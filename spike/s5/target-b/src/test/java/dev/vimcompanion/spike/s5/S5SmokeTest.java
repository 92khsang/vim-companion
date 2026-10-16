package dev.vimcompanion.spike.s5;

import com.intellij.ide.plugins.IdeaPluginDescriptor;
import com.intellij.ide.plugins.PluginManagerCore;
import com.intellij.openapi.application.ApplicationInfo;
import com.intellij.openapi.extensions.PluginId;
import com.intellij.testFramework.fixtures.BasePlatformTestCase;

/** The one test of target (b): the plugin is loaded in the IDE that the test task runs. */
public class S5SmokeTest extends BasePlatformTestCase {
    public void testPluginIsLoadedInTheTestIde() {
        IdeaPluginDescriptor plugin = PluginManagerCore.getPlugin(PluginId.getId(S5AppListener.PLUGIN_ID));
        assertNotNull("plugin descriptor", plugin);
        System.out.println("S5 test IDE build: " + ApplicationInfo.getInstance().getBuild().asString());
        myFixture.configureByText("fixture.txt", "S5 fixture line 1");
        assertEquals("S5 fixture line 1", myFixture.getEditor().getDocument().getText());
    }
}
