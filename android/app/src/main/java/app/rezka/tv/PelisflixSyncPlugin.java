package app.rezka.tv;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "PelisflixSync")
public class PelisflixSyncPlugin extends Plugin {
    private static final String STORE = "pelisflix-sync-session";
    private static final String ALIAS = "pelisflix-watch-sync-key";

    @PluginMethod public void session(PluginCall call) {
        try {
            String encoded = getContext().getSharedPreferences(STORE, 0).getString("ciphertext", null);
            JSObject result = new JSObject();
            if (encoded == null) { result.put("session", JSONObject.NULL); call.resolve(result); return; }
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            byte[] iv = java.util.Arrays.copyOfRange(bytes, 0, 12);
            byte[] encrypted = java.util.Arrays.copyOfRange(bytes, 12, bytes.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            result.put("session", new JSObject(new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)));
            call.resolve(result);
        } catch (Exception error) { call.reject("Saved sign-in could not be read securely.", error); }
    }

    @PluginMethod public void saveSession(PluginCall call) {
        String token = call.getString("token"), email = call.getString("email"), server = call.getString("server");
        if (token == null || email == null || server == null) { call.reject("The sign-in response was incomplete."); return; }
        try {
            JSONObject payload = new JSONObject(); payload.put("token", token); payload.put("email", email); payload.put("server", server);
            payload.put("expiresAt", call.getData().optLong("expiresAt", 0L));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV(), encrypted = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + encrypted.length]; System.arraycopy(iv, 0, combined, 0, iv.length); System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
            getContext().getSharedPreferences(STORE, 0).edit().putString("ciphertext", Base64.encodeToString(combined, Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception error) { call.reject("Sign-in could not be saved securely.", error); }
    }

    @PluginMethod public void clearSession(PluginCall call) {
        getContext().getSharedPreferences(STORE, 0).edit().clear().apply();
        call.resolve();
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
}
