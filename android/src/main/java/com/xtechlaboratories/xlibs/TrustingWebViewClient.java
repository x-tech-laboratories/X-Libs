package com.xtechlaboratories.xlibs;

import android.net.Uri;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Bundle;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;

// Lets the WebView reach a server whose certificate the phone refuses only when the user trusted that exact certificate for that host.
public class TrustingWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;

    public TrustingWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        try {
            String host = Uri.parse(error.getUrl()).getHost();
            X509Certificate server = server_certificate(error.getCertificate());
            if (host != null && server != null && CertificatesPlugin.is_trusted(bridge.getContext(), host, CertificatesPlugin.fingerprint(server))) {
                handler.proceed();
                return;
            }
        } catch (Exception problem) {
            // A certificate that cannot be read is refused below.
        }
        handler.cancel();
    }

    // SslCertificate only hands out its X.509 form from Android 10, but its saved state carries the encoded certificate on every version.
    private static X509Certificate server_certificate(SslCertificate certificate) throws Exception {
        if (certificate == null) return null;
        Bundle state = SslCertificate.saveState(certificate);
        byte[] encoded = state.getByteArray("x509-certificate");
        if (encoded == null) return null;
        return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(encoded));
    }
}
