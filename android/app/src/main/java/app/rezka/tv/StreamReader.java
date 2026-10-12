package app.rezka.tv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Buffered reads compatible with every Android version supported by the app. */
final class StreamReader {
    private StreamReader() {}

    static byte[] read(InputStream input) throws IOException {
        return read(input, 16 * 1024 * 1024);
    }

    static byte[] read(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (count > limit - output.size()) {
                throw new IOException("The content source returned too much data. Try another mirror.");
            }
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
}
