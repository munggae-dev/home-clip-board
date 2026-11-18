package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/munggae-dev/home-clip-board/server/internal/model"
	"github.com/munggae-dev/home-clip-board/server/internal/store"
	"github.com/valyala/fasthttp/fasthttputil"
)

func TestQueueEventsBroadcastCommittedMutations(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "test.db"), filepath.Join(dir, "uploads"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	h := New(st)
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	h.Register(app)
	ln := fasthttputil.NewInmemoryListener()
	go app.Listener(ln)
	defer app.ShutdownWithTimeout(2 * time.Second)

	transport := &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) {
		return ln.Dial()
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 8 * time.Second}

	readers := make([]*bufio.Reader, 2)
	for i := range readers {
		res, err := client.Get("http://clipboard/api/queue/events")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "text/event-stream" {
			t.Fatalf("unexpected stream response: %s %v", res.Status, res.Header)
		}
		readers[i] = bufio.NewReader(res.Body)
		expectFrame(t, readers[i], ": connected\n\n")
	}

	request := func(method, path, contentType string, body io.Reader, status int) []byte {
		t.Helper()
		req, err := http.NewRequest(method, "http://clipboard/api/queue"+path, body)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", contentType)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		if err != nil || res.StatusCode != status {
			t.Fatalf("%s %s: %s, body %s, err %v", method, path, res.Status, data, err)
		}
		return data
	}
	expectBroadcast := func() {
		t.Helper()
		for _, reader := range readers {
			expectFrame(t, reader, "event: queue-changed\ndata: {}\n\n")
		}
	}
	// Failures must leave the current generation open.
	unchanged := h.changes.listen()
	request("POST", "/text", "application/json", strings.NewReader(`{"content":""}`), 400)
	request("DELETE", "/missing", "", nil, 404)
	select {
	case <-unchanged:
		t.Fatal("failed mutation notified listeners")
	default:
	}

	data := request("POST", "/text", "application/json", strings.NewReader(`{"content":"hello"}`), 201)
	expectBroadcast()
	var item model.QueueItem
	if err := json.Unmarshal(data, &item); err != nil {
		t.Fatal(err)
	}
	request("DELETE", "/"+item.ID, "", nil, 204)
	expectBroadcast()

	var image bytes.Buffer
	form := multipart.NewWriter(&image)
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="file"; filename="clip.png"`},
		"Content-Type":        {"image/png"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("image fixture")); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	request("POST", "/image", form.FormDataContentType(), &image, 201)
	expectBroadcast()
}

func expectFrame(t *testing.T, reader *bufio.Reader, want string) {
	t.Helper()
	var frame strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		frame.WriteString(line)
		if line == "\n" {
			break
		}
	}
	if got := frame.String(); got != want {
		t.Fatalf("frame = %q, want %q", got, want)
	}
}
