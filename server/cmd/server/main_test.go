package main

import (
	"crypto/tls"
	"io"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/munggae-dev/home-clip-board/server/internal/store"
	"github.com/valyala/fasthttp"
)

func TestBrowserOriginPolicy(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "board.db"), filepath.Join(dir, "uploads"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	handle := newApp(st).Handler()

	const host = "board.example:8443"
	const origin = "https://" + host
	for _, tc := range []struct {
		name, host, origin, site, method, path string
		tls                                    bool
		want                                   int
	}{
		{"same origin upload", host, origin, "same-origin", "POST", "/api/queue/text", true, 201},
		{"tailnet CLI", host, "", "", "POST", "/api/queue/text", true, 201},
		{"different site upload", host, "https://another.example", "", "POST", "/api/queue/text", true, 403},
		{"different port delete", host, "https://board.example", "", "DELETE", "/api/queue/missing", true, 403},
		{"different scheme", host, "http://" + host, "", "POST", "/api/queue/text", true, 403},
		{"opaque origin", host, "null", "", "POST", "/api/queue/image", true, 403},
		{"same site preflight", host, origin, "same-site", "OPTIONS", "/api/queue/text", true, 403},
		{"cross site resource", host, "", "cross-site", "GET", "/api/queue", true, 403},
		{"default TLS port", "board.example:443", "https://board.example", "", "GET", "/api/queue", true, 200},
		{"local dev", "localhost:3000", "http://localhost:3000", "same-origin", "POST", "/api/queue/text", false, 201},
		{"dev IPv6", "[::1]:3000", "http://[::1]:3000", "same-origin", "GET", "/api/queue", false, 200},
		{"unrecognized HTTP host", host, "http://" + host, "same-origin", "GET", "/api/queue", false, 403},
		{"no legacy CA endpoint", host, origin, "same-origin", "GET", "/api/setup/root-ca.pem", true, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, peer := net.Pipe()
			defer server.Close()
			defer peer.Close()
			if tc.tls {
				server = tls.Server(server, &tls.Config{})
			}
			var ctx fasthttp.RequestCtx
			ctx.Init2(server, nil, false)
			req := &ctx.Request
			req.Header.SetMethod(tc.method)
			req.SetRequestURI(tc.path)
			req.Header.SetHost(tc.host)
			req.Header.SetContentType("application/json")
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("Sec-Fetch-Site", tc.site)
			req.Header.Set("X-Forwarded-Host", "another.example")
			req.Header.Set("X-Forwarded-Proto", "https")
			if tc.method == "POST" {
				req.SetBodyString(`{"content":"test"}`)
			}
			handle(&ctx)
			if got := ctx.Response.StatusCode(); got != tc.want {
				t.Fatalf("status = %d, want %d", got, tc.want)
			}
			if got := ctx.Response.Header.Peek("Access-Control-Allow-Origin"); len(got) != 0 {
				t.Errorf("unexpected CORS header %q", got)
			}
		})
	}
	items, err := st.List(10)
	if err != nil || len(items) != 3 {
		t.Fatalf("expected only the 3 allowed writes, got %d (error %v)", len(items), err)
	}
}

func TestBoardCannotBeFramed(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("board"), 0600); err != nil {
		t.Fatal(err)
	}
	app := newApp(nil)
	registerStatic(app, dir)
	for _, path := range []string{"/", "/settings"} {
		res, err := app.Test(httptest.NewRequest("GET", path, nil))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 || res.Header.Get("Content-Security-Policy") != "frame-ancestors 'none'" {
			t.Errorf("%s returned %d with CSP %q", path, res.StatusCode, res.Header.Get("Content-Security-Policy"))
		}
	}
}

func TestReleaseMetadataResponse(t *testing.T) {
	for _, tc := range []struct {
		filename, content, mime, cache string
	}{
		{"manifest.webmanifest", `{"share_target":{"action":"/share"}}`, "application/manifest+json", "no-cache"},
		{"version.json", `{"version":"1.0.0"}`, "application/json", "no-store"},
	} {
		t.Run(tc.filename, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, tc.filename), []byte(tc.content), 0600); err != nil {
				t.Fatal(err)
			}
			app := newApp(nil)
			registerStatic(app, dir)
			for _, method := range []string{"GET", "HEAD"} {
				res, err := app.Test(httptest.NewRequest(method, "/"+tc.filename, nil))
				if err != nil {
					t.Fatal(err)
				}
				data, err := io.ReadAll(res.Body)
				res.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				if res.StatusCode != 200 || res.Header.Get("Content-Type") != tc.mime || res.Header.Get("Cache-Control") != tc.cache {
					t.Fatalf("%s: %s, %v", method, res.Status, res.Header)
				}
				if method == "GET" && string(data) != tc.content {
					t.Fatalf("unexpected body %q", data)
				}
			}
		})
	}
}

func TestMissingVersionDoesNotReturnAppShell(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("board"), 0600); err != nil {
		t.Fatal(err)
	}
	app := newApp(nil)
	registerStatic(app, dir)
	res, err := app.Test(httptest.NewRequest("GET", "/version.json", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 404 || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("missing version: %s, %v", res.Status, res.Header)
	}
}
