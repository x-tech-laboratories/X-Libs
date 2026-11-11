package com.xtechlaboratories.xlibs;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.CertificateExpiredException;
import java.security.cert.CertificateNotYetValidException;
import java.security.cert.X509Certificate;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

// Servers whose https certificate the phone refuses, such as a home server's self-signed one: reads the certificate and
// what is wrong with it, keeps the ones the user trusts, each for its own host, and lets the WebView accept them.
@CapacitorPlugin(name = "XLibsCertificates")
public class CertificatesPlugin extends Plugin {

    // ========================================================================
    // Start
    // ========================================================================

    // Runs before the bridge hands the WebView its client, so this one is the client it gets.
    @Override
    public void load() {
        getBridge().setWebViewClient(new TrustingWebViewClient(getBridge()));
    }

    // ========================================================================
    // Trusted certificates
    // ========================================================================

    private static final String PREFERENCES_NAME = "x_libs_certificates";
    private static final String TRUSTED_KEY = "trusted";

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    // A missing or malformed list reads as nothing trusted.
    static JSONArray read_trusted(Context context) {
        try {
            return new JSONArray(preferences(context).getString(TRUSTED_KEY, "[]"));
        } catch (Exception error) {
            return new JSONArray();
        }
    }

    private static void write_trusted(Context context, JSONArray list) {
        preferences(context).edit().putString(TRUSTED_KEY, list.toString()).apply();
    }

    static boolean is_trusted(Context context, String host, String fingerprint) {
        JSONArray list = read_trusted(context);
        for (int index = 0; index < list.length(); index++) {
            JSONObject entry = list.optJSONObject(index);
            if (entry != null && host.equals(entry.optString("host")) && fingerprint.equals(entry.optString("fingerprint"))) return true;
        }
        return false;
    }

    private static JSONArray without_host(JSONArray list, String host) {
        JSONArray kept = new JSONArray();
        for (int index = 0; index < list.length(); index++) {
            JSONObject entry = list.optJSONObject(index);
            if (entry != null && !host.equals(entry.optString("host"))) kept.put(entry);
        }
        return kept;
    }

    // ========================================================================
    // Reading a server's certificate
    // ========================================================================

    private static final int TIMEOUT_MS = 10 * 1000;

    // SHA-256 as colon-separated hex, as the desktop app and openssl show it.
    static String fingerprint(X509Certificate certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder text = new StringBuilder();
        for (byte value : digest) {
            if (text.length() > 0) text.append(':');
            text.append(String.format("%02X", value));
        }
        return text.toString();
    }

    private static String iso_date(Date date) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(date);
    }

    private static String pem(X509Certificate certificate) throws Exception {
        return "-----BEGIN CERTIFICATE-----\n" + Base64.encodeToString(certificate.getEncoded(), Base64.DEFAULT) + "-----END CERTIFICATE-----";
    }

    // The other names it covers, written as openssl writes them, such as "DNS:nas.lan".
    private static JSArray alt_names(X509Certificate certificate) {
        JSArray names = new JSArray();
        try {
            Collection<List<?>> entries = certificate.getSubjectAlternativeNames();
            if (entries == null) return names;
            for (List<?> entry : entries) {
                int kind = (Integer) entry.get(0);
                if (kind == 2) names.put("DNS:" + entry.get(1));
                else if (kind == 7) names.put("IP Address:" + entry.get(1));
            }
        } catch (Exception error) {
            // A certificate whose names cannot be read shows none.
        }
        return names;
    }

    private static JSObject details(X509Certificate certificate) throws Exception {
        JSObject details = new JSObject();
        details.put("subject", certificate.getSubjectX500Principal().getName());
        details.put("issuer", certificate.getIssuerX500Principal().getName());
        details.put("alt_names", alt_names(certificate));
        details.put("valid_from", iso_date(certificate.getNotBefore()));
        details.put("valid_to", iso_date(certificate.getNotAfter()));
        details.put("fingerprint", fingerprint(certificate));
        details.put("serial_number", certificate.getSerialNumber().toString(16).toUpperCase(Locale.US));
        details.put("pem", pem(certificate));
        return details;
    }

    private static boolean signs_itself(X509Certificate certificate) {
        try {
            certificate.verify(certificate.getPublicKey());
            return certificate.getIssuerX500Principal().equals(certificate.getSubjectX500Principal());
        } catch (Exception error) {
            return false;
        }
    }

    // The phone's own authorities' verdict on the chain, or null when they accept it.
    private static Exception authority_problem(X509Certificate[] chain) {
        try {
            TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            factory.init((KeyStore) null);
            for (TrustManager manager : factory.getTrustManagers()) {
                if (manager instanceof X509TrustManager) {
                    ((X509TrustManager) manager).checkServerTrusted(chain, "GENERIC");
                    return null;
                }
            }
            return new Exception("no trust manager");
        } catch (Exception error) {
            return error;
        }
    }

    private static boolean caused_by(Throwable error, Class<?> kind) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (kind.isInstance(cause)) return true;
        }
        return false;
    }

    // Connects without checking the certificate, only to read it; nothing is sent over the connection.
    static JSObject check(Context context, String address) throws Exception {
        URL url = new URL(address);
        if (!url.getProtocol().equals("https")) return null;
        String host = url.getHost();
        int port = url.getPort() == -1 ? 443 : url.getPort();

        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(null, new TrustManager[] { new AcceptingTrustManager() }, null);
        Socket plain = new Socket();
        plain.connect(new InetSocketAddress(host, port), TIMEOUT_MS);
        plain.setSoTimeout(TIMEOUT_MS);
        X509Certificate[] chain;
        SSLSession session;
        try (SSLSocket socket = (SSLSocket) tls.getSocketFactory().createSocket(plain, host, port, true)) {
            socket.startHandshake();
            session = socket.getSession();
            Certificate[] certificates = session.getPeerCertificates();
            chain = new X509Certificate[certificates.length];
            for (int index = 0; index < certificates.length; index++) chain[index] = (X509Certificate) certificates[index];
        }
        X509Certificate leaf = chain[0];

        // TLS stops at the first problem it finds, so the name and dates are checked here as well.
        Set<String> problems = new LinkedHashSet<>();
        Exception refused = authority_problem(chain);
        if (refused != null && !caused_by(refused, CertificateExpiredException.class) && !caused_by(refused, CertificateNotYetValidException.class)) {
            problems.add(chain.length == 1 && signs_itself(leaf) ? "self_signed" : "unknown_authority");
        }
        if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, session)) problems.add("wrong_host");
        Date now = new Date();
        if (leaf.getNotAfter().before(now)) problems.add("expired");
        if (leaf.getNotBefore().after(now)) problems.add("not_yet_valid");
        if (refused != null && problems.isEmpty()) problems.add("other");
        if (problems.isEmpty()) return null;

        JSArray details = new JSArray();
        for (X509Certificate certificate : chain) details.put(details(certificate));
        String origin = url.getPort() == -1 ? "https://" + host : "https://" + host + ":" + port;
        String leaf_fingerprint = fingerprint(leaf);

        JSObject result = new JSObject();
        result.put("origin", origin);
        result.put("host", host);
        result.put("problems", new JSArray(new ArrayList<>(problems)));
        result.put("reason", refused != null && refused.getMessage() != null ? refused.getMessage() : String.join(", ", problems));
        result.put("chain", details);
        result.put("trusted", is_trusted(context, host, leaf_fingerprint));
        return result;
    }

    private static final class AcceptingTrustManager implements X509TrustManager {
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String auth_type) {}

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String auth_type) {}

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    // ========================================================================
    // Methods for the page
    // ========================================================================

    private JSObject listed(JSONArray list) {
        return new JSObject().put("certificates", list);
    }

    // Answers with the check, or with check null when the certificate is fine, not https, or unreachable.
    @PluginMethod
    public void check(PluginCall call) {
        String address = call.getString("url", "");
        new Thread(() -> {
            JSObject result = new JSObject();
            try {
                JSObject found = check(getContext(), address);
                result.put("check", found == null ? JSONObject.NULL : found);
            } catch (Exception error) {
                result.put("check", JSONObject.NULL);
            }
            call.resolve(result);
        }).start();
    }

    // Trusts the certificate the host shows now, refused when it no longer has the fingerprint the user saw.
    @PluginMethod
    public void trust(PluginCall call) {
        String address = call.getString("url", "");
        String wanted = call.getString("fingerprint", "");
        new Thread(() -> {
            try {
                JSObject found = check(getContext(), address);
                if (found == null) {
                    call.reject(new URL(address).getHost() + " no longer shows a certificate that needs trusting");
                    return;
                }
                JSONObject leaf = found.getJSONArray("chain").getJSONObject(0);
                String host = found.getString("host");
                if (!wanted.equals(leaf.getString("fingerprint"))) {
                    call.reject(host + " now shows a different certificate; check it again before trusting it");
                    return;
                }
                JSONObject entry = new JSONObject();
                entry.put("host", host);
                entry.put("fingerprint", wanted);
                entry.put("subject", leaf.getString("subject"));
                entry.put("problems", found.getJSONArray("problems"));
                entry.put("pem", leaf.getString("pem"));
                entry.put("trusted_at", iso_date(new Date()));
                JSONArray list = without_host(read_trusted(getContext()), host).put(entry);
                write_trusted(getContext(), list);
                forget_refusals();
                call.resolve(listed(list));
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "could not trust the certificate" : error.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void list(PluginCall call) {
        call.resolve(listed(read_trusted(getContext())));
    }

    @PluginMethod
    public void forget(PluginCall call) {
        JSONArray list = without_host(read_trusted(getContext()), call.getString("host", ""));
        write_trusted(getContext(), list);
        forget_refusals();
        call.resolve(listed(list));
    }

    // The WebView remembers each certificate it refused or let through, so it is told to ask again.
    private void forget_refusals() {
        getBridge().executeOnMainThread(() -> getBridge().getWebView().clearSslPreferences());
    }
}
