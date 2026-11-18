package main

import (
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/munggae-dev/home-clip-board/server/internal/handler"
	"github.com/munggae-dev/home-clip-board/server/internal/store"
)

func main() {
	listenHost := envOr("LISTEN_HOST", "127.0.0.1")
	httpPort := envOr("PORT", "8080")
	httpsPort := envOr("HTTPS_PORT", "8443")
	dbPath := envOr("DB_PATH", "./data.db")
	uploadDir := envOr("UPLOAD_DIR", "./uploads")
	staticDir := envOr("STATIC_DIR", "../web/dist")
	tlsCert := os.Getenv("TLS_CERT")
	tlsKey := os.Getenv("TLS_KEY")
	if (tlsCert == "") != (tlsKey == "") {
		log.Fatal("set TLS_CERT and TLS_KEY together")
	}
	if tlsCert == "" && !isLoopbackHost(listenHost) {
		log.Fatal("HTTP development server requires a loopback LISTEN_HOST")
	}

	st, err := store.Open(dbPath, uploadDir)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	app := newApp(st)
	registerStatic(app, staticDir)

	if tlsCert != "" {
		addr := net.JoinHostPort(listenHost, httpsPort)
		log.Printf("HTTPS on %s", addr)
		if err := app.ListenTLS(addr, tlsCert, tlsKey); err != nil {
			log.Fatal(err)
		}
		return
	}
	addr := net.JoinHostPort(listenHost, httpPort)
	log.Printf("development HTTP on %s", addr)
	if err := app.Listen(addr); err != nil {
		log.Fatal(err)
	}
}

func newApp(st *store.Store) *fiber.App {
	// ReadBufferSize = 요청 헤더 최대 크기 (기본 4096 → Cookie 많을 때 431 오류)
	app := fiber.New(fiber.Config{
		BodyLimit:      maxImageSize() + 1<<20,
		ReadBufferSize: 64 * 1024,
	})
	app.Use(logger.New())
	app.Use("/api", sameOriginAPI)
	handler.New(st).Register(app)
	return app
}

// The production listener terminates TLS itself, including connections relayed
// by Tailscale Serve in TCP mode. Use the socket and Host, not proxy headers.
func sameOriginAPI(c *fiber.Ctx) error {
	c.Set("Cross-Origin-Resource-Policy", "same-origin")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("Cache-Control", "no-store")
	host := c.Get("Host")
	scheme, defaultPort := "https", ":443"
	if !c.Context().IsTLS() {
		if !isLoopbackHost(host) {
			return fiber.ErrForbidden
		}
		scheme, defaultPort = "http", ":80"
	}

	site := c.Get("Sec-Fetch-Site")
	if site == "cross-site" || site == "same-site" {
		return fiber.ErrForbidden
	}
	if origin := c.Get("Origin"); origin != "" {
		target := scheme + "://" + host
		if !strings.EqualFold(strings.TrimSuffix(origin, defaultPort), strings.TrimSuffix(target, defaultPort)) {
			return fiber.ErrForbidden
		}
	}
	return c.Next()
}

func isLoopbackHost(authority string) bool {
	host, _, err := net.SplitHostPort(authority)
	if err != nil {
		host = authority
	}
	return strings.EqualFold(host, "localhost") || net.ParseIP(strings.Trim(host, "[]")).IsLoopback()
}

func registerStatic(app *fiber.App, staticDir string) {
	info, err := os.Stat(staticDir)
	if err != nil || !info.IsDir() {
		return
	}

	indexHTML := filepath.Join(staticDir, "index.html")
	app.Use(func(c *fiber.Ctx) error {
		c.Set("Content-Security-Policy", "frame-ancestors 'none'")
		return c.Next()
	})
	// Serve release metadata explicitly before the SPA fallback. Minimal images
	// may have no system MIME database.
	registerMetadata := func(name, contentType, cacheControl string) {
		app.Get("/"+name, func(c *fiber.Ctx) error {
			err := c.SendFile(filepath.Join(staticDir, name))
			c.Set("Cache-Control", cacheControl)
			if err != nil {
				return err
			}
			c.Set("Content-Type", contentType)
			return nil
		})
	}
	registerMetadata("manifest.webmanifest", "application/manifest+json", "no-cache")
	registerMetadata("version.json", "application/json", "no-store")
	app.Static("/", staticDir, fiber.Static{
		Index:  "index.html",
		Browse: false,
	})
	app.Get("*", func(c *fiber.Ctx) error {
		if strings.HasPrefix(c.Path(), "/api") {
			return fiber.ErrNotFound
		}
		return c.SendFile(indexHTML)
	})
	log.Printf("serving static files from %s", staticDir)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func maxImageSize() int {
	return 10 << 20
}
