package studio.ctw.hue;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class ShortcutPolicy {
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    static String stableId(String kind, String id) {
        label(kind);
        HueDeepLinkRouter.requireId(id);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest((kind + ":" + id).getBytes(StandardCharsets.UTF_8));
            StringBuilder hash = new StringBuilder(24);
            for (int index = 0; index < 12; index++) {
                int value = digest[index] & 0xff;
                hash.append(HEX[value >>> 4]).append(HEX[value & 0x0f]);
            }
            return "hue-" + kind + "-" + hash;
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    static String label(String kind) {
        return switch (kind) {
            case "project" -> "HUE Project";
            case "session" -> "HUE Session";
            default -> throw new IllegalArgumentException("Shortcut kind must be project or session");
        };
    }
}
