package app.rezka.tv;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class StreamReaderTest {
    @Test public void readsAResponseAcrossMultipleBuffers() throws Exception {
        byte[] body = new byte[24000];
        for (int i = 0; i < body.length; i++) body[i] = (byte) (i % 251);
        assertArrayEquals(body, StreamReader.read(new ByteArrayInputStream(body)));
    }

    @Test public void preservesEncodedMetadataAndEmptyResponses() throws Exception {
        byte[] body = "Интерстеллар".getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(body, StreamReader.read(new ByteArrayInputStream(body)));
        assertArrayEquals(new byte[0], StreamReader.read(new ByteArrayInputStream(new byte[0])));
    }

    @Test public void rejectsOversizedResponsesBeforeUnboundedAllocation() throws Exception {
        try {
            StreamReader.read(new ByteArrayInputStream(new byte[1025]), 1024);
            fail("An oversized response must be rejected");
        } catch (IOException expected) {
            // The plugin turns this into a recoverable request error.
        }
    }
}
