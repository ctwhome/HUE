package studio.ctw.hue;

import static org.junit.Assert.*;

import org.junit.Test;

public class ShortcutPolicyTest {
    @Test public void stableIdsAreHashedBoundedAndKindScoped() {
        String project = ShortcutPolicy.stableId("project", "private-project-id");
        assertEquals(project, ShortcutPolicy.stableId("project", "private-project-id"));
        assertNotEquals(project, ShortcutPolicy.stableId("session", "private-project-id"));
        assertTrue(project.startsWith("hue-project-"));
        assertFalse(project.contains("private-project-id"));
        assertTrue(project.length() <= 64);
    }

    @Test public void labelsAreExactAndGeneric() {
        assertEquals("HUE Project", ShortcutPolicy.label("project"));
        assertEquals("HUE Session", ShortcutPolicy.label("session"));
    }

    @Test public void inputsAreBounded() {
        assertThrows(IllegalArgumentException.class, () -> ShortcutPolicy.stableId("workflow", "id"));
        assertThrows(IllegalArgumentException.class, () -> ShortcutPolicy.stableId("project", ""));
        assertThrows(IllegalArgumentException.class, () -> ShortcutPolicy.stableId("project", "x".repeat(129)));
    }
}
