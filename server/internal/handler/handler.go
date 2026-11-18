package handler

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/munggae-dev/home-clip-board/server/internal/model"
	"github.com/munggae-dev/home-clip-board/server/internal/store"
)

const maxImageSize = 10 << 20 // 10MB

var allowedMimes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
	"image/gif":  true,
}

type Handler struct {
	store   *store.Store
	changes queueChanges
}

func New(s *store.Store) *Handler {
	return &Handler{store: s, changes: queueChanges{next: make(chan struct{})}}
}

func (h *Handler) Register(app *fiber.App) {
	api := app.Group("/api")
	api.Get("/health", h.Health)
	api.Get("/queue", h.ListQueue)
	api.Get("/queue/events", h.QueueEvents)
	api.Post("/queue/text", h.CreateText)
	api.Post("/queue/image", h.CreateImage)
	api.Get("/queue/:id", h.GetQueueItem)
	api.Get("/queue/:id/file", h.GetQueueFile)
	api.Delete("/queue/:id", h.DeleteQueueItem)
}

func (h *Handler) Health(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"status": "ok"})
}

func (h *Handler) ListQueue(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 100)
	items, err := h.store.List(limit)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	if items == nil {
		items = []model.QueueItemMeta{}
	}
	return c.JSON(fiber.Map{"items": items})
}

func requestKey(c *fiber.Ctx) (string, error) {
	raw := c.Get("Idempotency-Key")
	if raw == "" {
		return "", nil
	}
	id, err := uuid.Parse(raw)
	if err != nil || len(raw) != 36 || !strings.EqualFold(id.String(), raw) || id == uuid.Nil {
		return "", fiber.NewError(fiber.StatusBadRequest, "Idempotency-Key must be a UUID")
	}
	return id.String(), nil
}

func (h *Handler) createdResponse(c *fiber.Ctx, item *model.QueueItem, created bool, err error) error {
	switch {
	case errors.Is(err, store.ErrRequestConflict):
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
	case errors.Is(err, store.ErrItemDeleted):
		return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": err.Error()})
	case err != nil:
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	case created:
		h.changes.notify()
		return c.Status(fiber.StatusCreated).JSON(item)
	default:
		return c.JSON(item)
	}
}

func (h *Handler) CreateText(c *fiber.Ctx) error {
	key, err := requestKey(c)
	if err != nil {
		return err
	}
	var req model.CreateTextRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid json body")
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		return fiber.NewError(fiber.StatusBadRequest, "content is empty")
	}
	var digest []byte
	if key != "" {
		sum := sha256.Sum256([]byte(content))
		digest = sum[:]
	}
	item, created, err := h.store.Insert(model.QueueItem{Type: model.TypeText, Content: content, Size: int64(len(content))}, key, digest)
	return h.createdResponse(c, item, created, err)
}

func (h *Handler) CreateImage(c *fiber.Ctx) error {
	key, err := requestKey(c)
	if err != nil {
		return err
	}
	file, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "file field required")
	}
	if file.Size > maxImageSize {
		return fiber.NewError(fiber.StatusBadRequest, fmt.Sprintf("file exceeds %d bytes", maxImageSize))
	}

	contentType := file.Header.Get("Content-Type")
	if contentType == "" {
		contentType = mime.TypeByExtension(filepath.Ext(file.Filename))
	}
	if !allowedMimes[contentType] {
		return fiber.NewError(fiber.StatusBadRequest, "unsupported image type")
	}

	ext := extForMime(contentType)
	if ext == "" {
		return fiber.NewError(fiber.StatusBadRequest, "unsupported image type")
	}

	relName := uuid.New().String() + ext
	dest := filepath.Join(h.store.UploadDir(), relName)

	src, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	defer src.Close()

	dst, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	sum := sha256.New()
	var writer io.Writer = dst
	if key != "" {
		writer = io.MultiWriter(dst, sum)
	}
	written, err := io.Copy(writer, src)
	closeErr := dst.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(dest)
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	item, created, err := h.store.Insert(model.QueueItem{Type: model.TypeImage, FilePath: relName, Mime: contentType, Size: written}, key, sum.Sum(nil))
	if !created {
		os.Remove(dest)
	}
	return h.createdResponse(c, item, created, err)
}

func (h *Handler) GetQueueItem(c *fiber.Ctx) error {
	item, err := h.store.GetByID(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	if item == nil {
		return fiber.NewError(fiber.StatusNotFound, "not found")
	}
	return c.JSON(item)
}

func (h *Handler) GetQueueFile(c *fiber.Ctx) error {
	item, err := h.store.GetByID(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	if item == nil || item.Type != model.TypeImage {
		return fiber.NewError(fiber.StatusNotFound, "not found")
	}
	full, err := h.store.ResolveFilePath(item.FilePath)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	if _, err := os.Stat(full); os.IsNotExist(err) {
		return fiber.NewError(fiber.StatusNotFound, "file missing")
	}
	return c.SendFile(full, true)
}

func (h *Handler) DeleteQueueItem(c *fiber.Ctx) error {
	item, err := h.store.Delete(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	if item == nil {
		return fiber.NewError(fiber.StatusNotFound, "not found")
	}
	h.changes.notify()
	return c.SendStatus(fiber.StatusNoContent)
}

func extForMime(m string) string {
	switch m {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ""
	}
}
