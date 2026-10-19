package dev.remoteaccess.spike;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.json.*;

/** This phone's pairing key and the browsers it has granted. The private key never leaves the Keystore. */
final class Paired {
    private static final String ALIAS="device-identity", FILE="paired.json";
    private Paired() { }

    private static synchronized KeyStore.PrivateKeyEntry key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            // No user-authentication binding: an unattended phone must sign after a restart.
            KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build());
            generator.generateKeyPair();
        }
        return (KeyStore.PrivateKeyEntry)store.getEntry(ALIAS,null);
    }

    /** X.509 SubjectPublicKeyInfo, base64; the relay and browser fingerprint the same bytes. */
    static String publicKey() throws Exception { return Base64.encodeToString(key().getCertificate().getPublicKey().getEncoded(),Base64.NO_WRAP); }
    /** DER-encoded ECDSA over SHA-256. */
    static String sign(String message) throws Exception {
        Signature signature=Signature.getInstance("SHA256withECDSA");
        signature.initSign(key().getPrivateKey()); signature.update(message.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(signature.sign(),Base64.NO_WRAP);
    }
    static String fingerprint(String spki) throws Exception {
        return Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(Base64.decode(spki,Base64.NO_WRAP)),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
    }
    static String mac(String secret,String message) throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(Base64.decode(secret,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),"HmacSHA256"));
        return Base64.encodeToString(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
    }

    /** {routes:[{host,port}], viewers:[{fpr,key,name,pairedAt}]}, or null before the first pairing. */
    static synchronized JSONObject load(Context context) {
        try { return new JSONObject(new String(Files.readAllBytes(new File(context.getFilesDir(),FILE).toPath()),StandardCharsets.UTF_8)); }
        catch (Exception e) { return null; }
    }
    static synchronized boolean any(Context context) {
        JSONObject paired=load(context);
        return paired!=null && paired.optJSONArray("viewers")!=null && paired.optJSONArray("viewers").length()>0;
    }
    static synchronized void addViewer(Context context,JSONArray routes,String key,String name) throws Exception {
        JSONObject paired=load(context); if (paired==null) paired=new JSONObject().put("viewers",new JSONArray());
        String fpr=fingerprint(key);
        JSONArray kept=new JSONArray(), viewers=paired.getJSONArray("viewers");
        for (int i=0;i<viewers.length();i++) if (!viewers.getJSONObject(i).getString("fpr").equals(fpr)) kept.put(viewers.getJSONObject(i));
        kept.put(new JSONObject().put("fpr",fpr).put("key",key).put("name",name).put("pairedAt",System.currentTimeMillis()));
        save(context,paired.put("routes",routes).put("viewers",kept));
    }
    static synchronized void removeViewer(Context context,String fpr) throws Exception {
        JSONObject paired=load(context); if (paired==null) return;
        JSONArray kept=new JSONArray(), viewers=paired.getJSONArray("viewers");
        for (int i=0;i<viewers.length();i++) if (!viewers.getJSONObject(i).getString("fpr").equals(fpr)) kept.put(viewers.getJSONObject(i));
        if (kept.length()==0) { new File(context.getFilesDir(),FILE).delete(); return; }
        save(context,paired.put("viewers",kept));
    }
    static synchronized JSONArray fingerprints(Context context) throws JSONException {
        JSONArray result=new JSONArray(); JSONObject paired=load(context);
        JSONArray viewers=paired==null ? new JSONArray() : paired.optJSONArray("viewers");
        for (int i=0;viewers!=null && i<viewers.length();i++) result.put(viewers.getJSONObject(i).getString("fpr"));
        return result;
    }
    private static void save(Context context,JSONObject paired) throws Exception {
        File target=new File(context.getFilesDir(),FILE), temp=new File(context.getFilesDir(),FILE+".tmp");
        Files.write(temp.toPath(),paired.toString().getBytes(StandardCharsets.UTF_8));
        Files.move(temp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
    }
}
