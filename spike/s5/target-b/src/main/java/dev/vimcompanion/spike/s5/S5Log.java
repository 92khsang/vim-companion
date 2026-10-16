package dev.vimcompanion.spike.s5;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/** Appends lines to the files named by the s5.* system properties. Spike code, never merged. */
final class S5Log {
    private S5Log() {}

    static synchronized void append(String property, String line) {
        String file = System.getProperty(property);
        if (file == null || file.isEmpty()) {
            return;
        }
        try {
            Files.writeString(Path.of(file), line + "\n", StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND, StandardOpenOption.SYNC);
        } catch (IOException e) {
            System.err.println("S5 probe: cannot write " + file + ": " + e);
        }
    }

    static void report(String line) {
        append("s5.report", System.currentTimeMillis() + "\t" + line);
    }
}
