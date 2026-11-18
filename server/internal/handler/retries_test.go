package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/munggae-dev/home-clip-board/server/internal/model"
	"github.com/munggae-dev/home-clip-board/server/internal/store"
)

func TestKeyedUploadRetries(t *testing.T) {
	dir := t.TempDir()
	uploads := filepath.Join(dir, "uploads")
	dbPath := filepath.Join(dir, "board.db")
	open := func() (*Handler, *fiber.App) {
		t.Helper()
		st, err := store.Open(dbPath, uploads)
		if err != nil {
			t.Fatal(err)
		}
		h := New(st)
		app := fiber.New()
		h.Register(app)
		return h, app
	}
	h, app := open()
	defer func() { h.store.Close() }()

	send := func(path, contentType, key string, body []byte) (int, string, error) {
		req := httptest.NewRequest(http.MethodPost, "/api/queue/"+path, bytes.NewReader(body))
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Idempotency-Key", key)
		res, err := app.Test(req, -1)
		if err != nil {
			return 0, "", err
		}
		defer res.Body.Close()
		if res.StatusCode >= 400 {
			return res.StatusCode, "", nil
		}
		var item model.QueueItem
		err = json.NewDecoder(res.Body).Decode(&item)
		return res.StatusCode, item.ID, err
	}

	image := func(content string) (string, []byte) {
		t.Helper()
		var body bytes.Buffer
		w := multipart.NewWriter(&body)
		file, err := w.CreatePart(textproto.MIMEHeader{
			"Content-Disposition": {`form-data; name="file"; filename="clip.png"`},
			"Content-Type":        {"image/png"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(file, content); err != nil {
			t.Fatal(err)
		}
		if err = w.Close(); err != nil {
			t.Fatal(err)
		}
		return w.FormDataContentType(), body.Bytes()
	}

	key := uuid.NewString()
	contentType, body := image("fixture image bytes")
	const attempts = 5
	statuses := make([]int, attempts)
	ids := make([]string, attempts)
	errs := make([]error, attempts)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			statuses[i], ids[i], errs[i] = send("image", contentType, key, body)
		}(i)
	}
	wg.Wait()
	created := 0
	for i, id := range ids {
		if errs[i] != nil || id == "" || id != ids[0] {
			t.Fatalf("upload %d: %q, %v", i, id, errs[i])
		}
		switch statuses[i] {
		case 201:
			created++
		case 200:
		default:
			t.Fatalf("upload %d: status %d", i, statuses[i])
		}
	}
	if created != 1 {
		t.Fatalf("created %d times", created)
	}
	files, err := os.ReadDir(uploads)
	if err != nil || len(files) != 1 {
		t.Fatalf("expected 1 image file, got %d (%v)", len(files), err)
	}
	saved, err := os.ReadFile(filepath.Join(uploads, files[0].Name()))
	if err != nil || string(saved) != "fixture image bytes" {
		t.Fatalf("image was not preserved: %v", err)
	}

	// The receipt must survive a restart, including when the first response was lost.
	if err = h.store.Close(); err != nil {
		t.Fatal(err)
	}
	h, app = open()
	expect := func(path, ct, k string, data []byte, status int) string {
		t.Helper()
		got, id, err := send(path, ct, k, data)
		if err != nil || got != status {
			t.Fatalf("POST %s: status %d, expected %d (%v)", path, got, status, err)
		}
		return id
	}
	noChange := h.changes.listen()
	if id := expect("image", contentType, key, body, 200); id != ids[0] {
		t.Fatal("changed id after restart")
	}
	differentType, differentBody := image("fixture image bytez")
	expect("image", differentType, key, differentBody, 409)
	expect("text", "application/json", key, []byte(`{"content":"fixture image bytes"}`), 409)
	expect("text", "application/json", "invalid-key", []byte(`{"content":"hello"}`), 400)
	select {
	case <-noChange:
		t.Fatal("replay or failed request notified SSE")
	default:
	}

	del, err := app.Test(httptest.NewRequest(http.MethodDelete, "/api/queue/"+ids[0], nil))
	if err != nil {
		t.Fatal(err)
	}
	del.Body.Close()
	if del.StatusCode != 204 {
		t.Fatalf("DELETE returned %s", del.Status)
	}
	expect("image", contentType, key, body, 410)
	files, err = os.ReadDir(uploads)
	if err != nil || len(files) != 0 {
		t.Fatalf("deleted or rejected attempts left files: %v, %v", files, err)
	}

	textKey := uuid.NewString()
	textBody := []byte(`{"content":" hello "}`)
	first := expect("text", "application/json", textKey, textBody, 201)
	second := expect("text", "application/json", textKey, []byte(`{"content":"hello"}`), 200)
	if first == "" || first != second {
		t.Fatal("text ID changed on replay")
	}
	expect("text", "application/json", textKey, []byte(`{"content":"bye"}`), 409)
	if a, b := expect("text", "application/json", "", textBody, 201), expect("text", "application/json", "", textBody, 201); a == b {
		t.Fatalf("unkeyed requests unexpectedly reused %s", a)
	}
}
