package com.xtechlaboratories.xlibs;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

// UDP and TCP sockets for the phone service's worker, with TLS started on a connected socket in either role, as
// KDE Connect does after its plain identity line. The worker reaches it as window.XLibsSockets.call(request), one JSON
// request each with an id; replies and socket events come back through PhoneService as "sockets" events, bytes as base64.
// A TCP socket reads nothing until asked, by read_line for one line or by start_reading for everything after, so
// no byte meant for TLS is read as plain text.
final class WorkerSockets {

    private static final int CHUNK_BYTES = 64 * 1024;
    private static final int LINE_LIMIT_BYTES = 64 * 1024;

    private final Context context;
    private final PhoneService.Emitter emit;
    private final ExecutorService work = Executors.newCachedThreadPool();
    private final AtomicInteger next_id = new AtomicInteger(1);
    private final Map<Integer, Entry> sockets = new ConcurrentHashMap<>();
    private WifiManager.MulticastLock multicast;
    private int broadcasting = 0;

    WorkerSockets(Context context, PhoneService.Emitter emit) {
        this.context = context;
        this.emit = emit;
    }

    // ========================================================================
    // Sockets kept by id
    // ========================================================================

    private static final class Entry {
        DatagramSocket udp;
        boolean broadcast;
        ServerSocket server;
        Socket tcp;
        InputStream input;
        OutputStream output;
        volatile boolean reading;
        volatile boolean paused;
        final Object pause_lock = new Object();
        // Writes go out one at a time in order.
        final ExecutorService writer = Executors.newSingleThreadExecutor();
    }

    private Entry entry(JSONObject request) throws JSONException {
        Entry found = sockets.get(request.getInt("socket"));
        if (found == null) throw new IllegalStateException("no such socket");
        return found;
    }

    private int keep(Entry entry) {
        int id = next_id.getAndIncrement();
        sockets.put(id, entry);
        return id;
    }

    // ========================================================================
    // Requests
    // ========================================================================

    @JavascriptInterface
    public void call(String text) {
        work.execute(() -> {
            int id = 0;
            try {
                JSONObject request = new JSONObject(text);
                id = request.getInt("id");
                reply(id, answer(request));
            } catch (Exception error) {
                JSONObject failure = new JSONObject();
                try {
                    failure.put("kind", "reply").put("id", id).put("ok", false).put("error", String.valueOf(error.getMessage() == null ? error : error.getMessage()));
                } catch (JSONException ignored) {
                }
                emit.emit("sockets", failure.toString());
            }
        });
    }

    private JSONObject answer(JSONObject request) throws Exception {
        switch (request.getString("op")) {
            case "udp_open": return udp_open(request);
            case "udp_send": return udp_send(request);
            case "tcp_listen": return tcp_listen(request);
            case "tcp_connect": return tcp_connect(request);
            case "read_line": return read_line(request);
            case "start_reading": return start_reading(request);
            case "pause": entry(request).paused = true; return new JSONObject();
            case "resume": return resume(request);
            case "write": return write(request);
            case "tls_start": return tls_start(request);
            case "close": close(request.getInt("socket"), null); return new JSONObject();
            case "list_interfaces": return list_interfaces();
            default: throw new IllegalArgumentException("unknown op " + request.getString("op"));
        }
    }

    private void reply(int id, JSONObject value) throws JSONException {
        emit.emit("sockets", new JSONObject().put("kind", "reply").put("id", id).put("ok", true).put("value", value).toString());
    }

    private void event(int socket, String type, JSONObject fields) {
        try {
            fields.put("kind", "event").put("socket", socket).put("type", type);
            emit.emit("sockets", fields.toString());
        } catch (JSONException ignored) {
        }
    }

    // ========================================================================
    // UDP
    // ========================================================================

    private JSONObject udp_open(JSONObject request) throws Exception {
        Entry entry = new Entry();
        DatagramSocket udp = new DatagramSocket(null);
        udp.setReuseAddress(true);
        udp.bind(new InetSocketAddress(request.optInt("port", 0)));
        entry.udp = udp;
        entry.broadcast = request.optBoolean("broadcast", false);
        if (entry.broadcast) {
            udp.setBroadcast(true);
            hold_multicast(true);
        }
        int id = keep(entry);
        work.execute(() -> {
            byte[] buffer = new byte[CHUNK_BYTES];
            try {
                while (!udp.isClosed()) {
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    udp.receive(packet);
                    event(id, "message", new JSONObject()
                        .put("data", Base64.encodeToString(packet.getData(), packet.getOffset(), packet.getLength(), Base64.NO_WRAP))
                        .put("address", packet.getAddress().getHostAddress())
                        .put("port", packet.getPort()));
                }
            } catch (Exception error) {
                close(id, udp.isClosed() ? null : error);
            }
        });
        return new JSONObject().put("socket", id).put("port", udp.getLocalPort());
    }

    private JSONObject udp_send(JSONObject request) throws Exception {
        Entry entry = entry(request);
        byte[] data = Base64.decode(request.getString("data"), Base64.NO_WRAP);
        entry.udp.send(new DatagramPacket(data, data.length, InetAddress.getByName(request.getString("address")), request.getInt("port")));
        return new JSONObject();
    }

    // Wi-Fi drops broadcasts and multicasts to save power unless an app holds the lock.
    private synchronized void hold_multicast(boolean hold) {
        broadcasting += hold ? 1 : -1;
        if (broadcasting > 0 && multicast == null) {
            WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) return;
            multicast = wifi.createMulticastLock("x-libs-sockets");
            multicast.setReferenceCounted(false);
            try {
                multicast.acquire();
            } catch (SecurityException ignored) {
                // The app did not declare CHANGE_WIFI_MULTICAST_STATE; broadcasts then arrive only while the screen is on.
            }
        } else if (broadcasting <= 0 && multicast != null) {
            if (multicast.isHeld()) multicast.release();
            multicast = null;
            broadcasting = 0;
        }
    }

    // ========================================================================
    // TCP
    // ========================================================================

    private JSONObject tcp_listen(JSONObject request) throws Exception {
        ServerSocket server = new ServerSocket();
        server.setReuseAddress(true);
        String host = request.optString("host", "");
        server.bind(host.isEmpty() ? new InetSocketAddress(request.optInt("port", 0)) : new InetSocketAddress(host, request.optInt("port", 0)));
        Entry entry = new Entry();
        entry.server = server;
        int id = keep(entry);
        work.execute(() -> {
            try {
                while (!server.isClosed()) {
                    Socket accepted = server.accept();
                    int accepted_id = keep(connected(accepted));
                    event(id, "connection", describe(accepted).put("connection", accepted_id));
                }
            } catch (Exception error) {
                close(id, server.isClosed() ? null : error);
            }
        });
        return new JSONObject().put("socket", id).put("port", server.getLocalPort());
    }

    private JSONObject tcp_connect(JSONObject request) throws Exception {
        Socket socket = new Socket();
        socket.connect(new InetSocketAddress(request.getString("host"), request.getInt("port")), request.optInt("timeout_ms", 10_000));
        int id = keep(connected(socket));
        return describe(socket).put("socket", id);
    }

    private Entry connected(Socket socket) throws Exception {
        socket.setTcpNoDelay(true);
        socket.setKeepAlive(true);
        Entry entry = new Entry();
        entry.tcp = socket;
        entry.input = socket.getInputStream();
        entry.output = socket.getOutputStream();
        return entry;
    }

    private static JSONObject describe(Socket socket) throws JSONException {
        return new JSONObject()
            .put("local_port", socket.getLocalPort())
            .put("remote_address", socket.getInetAddress().getHostAddress())
            .put("remote_port", socket.getPort());
    }

    // Reads one line, byte by byte, so nothing past its newline is taken.
    private JSONObject read_line(JSONObject request) throws Exception {
        Entry entry = entry(request);
        if (entry.reading) throw new IllegalStateException("the socket is already reading");
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        while (true) {
            int next = entry.input.read();
            if (next < 0) throw new IllegalStateException("the socket closed before a whole line");
            if (next == '\n') break;
            line.write(next);
            if (line.size() > LINE_LIMIT_BYTES) throw new IllegalStateException("the line is too long");
        }
        return new JSONObject().put("line", line.toString("UTF-8"));
    }

    private JSONObject start_reading(JSONObject request) throws Exception {
        int id = request.getInt("socket");
        Entry entry = entry(request);
        if (entry.reading) return new JSONObject();
        entry.reading = true;
        work.execute(() -> {
            byte[] buffer = new byte[CHUNK_BYTES];
            try {
                while (true) {
                    synchronized (entry.pause_lock) {
                        while (entry.paused) entry.pause_lock.wait();
                    }
                    int count = entry.input.read(buffer);
                    if (count < 0) break;
                    event(id, "data", new JSONObject().put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)));
                }
                close(id, null);
            } catch (Exception error) {
                close(id, entry.tcp.isClosed() ? null : error);
            }
        });
        return new JSONObject();
    }

    private JSONObject resume(JSONObject request) throws Exception {
        Entry entry = entry(request);
        synchronized (entry.pause_lock) {
            entry.paused = false;
            entry.pause_lock.notifyAll();
        }
        return new JSONObject();
    }

    private JSONObject write(JSONObject request) throws Exception {
        Entry entry = entry(request);
        byte[] data = Base64.decode(request.getString("data"), Base64.NO_WRAP);
        // Waits for the bytes to go out, so the worker's writes keep their order and their pace.
        entry.writer.submit(() -> {
            entry.output.write(data);
            entry.output.flush();
            return null;
        }).get();
        return new JSONObject();
    }

    // ========================================================================
    // TLS
    // ========================================================================

    // Starts TLS on a connected socket with the given certificate and key, trusting any peer: the worker checks the
    // peer's certificate itself, as KDE Connect pins it at pairing. The TCP role and the TLS role need not match.
    private JSONObject tls_start(JSONObject request) throws Exception {
        Entry entry = entry(request);
        if (entry.reading) throw new IllegalStateException("start TLS before reading");
        boolean server = "server".equals(request.getString("role"));

        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(key_managers(request.getString("certificate"), request.getString("key")), new TrustManager[] { new AnyPeer() }, null);
        SSLSocket secure = (SSLSocket) tls.getSocketFactory().createSocket(entry.tcp, entry.tcp.getInetAddress().getHostAddress(), entry.tcp.getPort(), true);
        secure.setUseClientMode(!server);
        if (server) secure.setNeedClientAuth(true);
        secure.startHandshake();

        entry.tcp = secure;
        entry.input = secure.getInputStream();
        entry.output = secure.getOutputStream();

        JSONObject value = new JSONObject().put("protocol", secure.getSession().getProtocol()).put("cipher", secure.getSession().getCipherSuite());
        Certificate[] peer = secure.getSession().getPeerCertificates();
        value.put("peer_certificate", peer.length > 0 ? pem("CERTIFICATE", peer[0].getEncoded()) : JSONObject.NULL);
        return value;
    }

    private static KeyManagerFactory key_managers_factory() throws Exception {
        return KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    }

    private static javax.net.ssl.KeyManager[] key_managers(String certificate_pem, String key_pem) throws Exception {
        X509Certificate certificate = (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(certificate_pem.getBytes("US-ASCII")));
        byte[] key_bytes = Base64.decode(key_pem.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", ""), Base64.DEFAULT);
        String algorithm = certificate.getPublicKey().getAlgorithm();
        PrivateKey key = KeyFactory.getInstance(algorithm).generatePrivate(new PKCS8EncodedKeySpec(key_bytes));

        KeyStore store = KeyStore.getInstance("PKCS12");
        store.load(null, null);
        char[] password = new char[0];
        store.setKeyEntry("identity", key, password, new Certificate[] { certificate });
        KeyManagerFactory factory = key_managers_factory();
        factory.init(store, password);
        return factory.getKeyManagers();
    }

    private static String pem(String label, byte[] der) {
        return "-----BEGIN " + label + "-----\n" + Base64.encodeToString(der, Base64.DEFAULT) + "-----END " + label + "-----\n";
    }

    @SuppressWarnings("CustomX509TrustManager")
    private static final class AnyPeer implements X509TrustManager {
        @SuppressWarnings("TrustAllX509TrustManager")
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String auth_type) {
        }

        @SuppressWarnings("TrustAllX509TrustManager")
        @Override
        public void checkServerTrusted(X509Certificate[] chain, String auth_type) {
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    // ========================================================================
    // Interfaces
    // ========================================================================

    // The phone's IPv4 addresses with their broadcast addresses, for announcing on each network.
    private static JSONObject list_interfaces() throws Exception {
        JSONArray list = new JSONArray();
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback()) continue;
            for (InterfaceAddress address : network.getInterfaceAddresses()) {
                if (!(address.getAddress() instanceof Inet4Address)) continue;
                list.put(new JSONObject()
                    .put("name", network.getName())
                    .put("address", address.getAddress().getHostAddress())
                    .put("broadcast", address.getBroadcast() == null ? JSONObject.NULL : address.getBroadcast().getHostAddress()));
            }
        }
        return new JSONObject().put("interfaces", list);
    }

    // ========================================================================
    // Closing
    // ========================================================================

    private void close(int id, Exception error) {
        Entry entry = sockets.remove(id);
        if (entry == null) return;
        quietly(entry.udp);
        quietly(entry.server);
        quietly(entry.tcp);
        entry.writer.shutdownNow();
        if (entry.broadcast) hold_multicast(false);
        try {
            event(id, "close", new JSONObject().put("error", error == null ? JSONObject.NULL : String.valueOf(error.getMessage())));
        } catch (JSONException ignored) {
        }
    }

    private static void quietly(Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (Exception ignored) {
        }
    }

    // Closes every socket, when the service stops.
    void close_all() {
        for (Integer id : sockets.keySet()) close(id, null);
        work.shutdownNow();
    }
}
