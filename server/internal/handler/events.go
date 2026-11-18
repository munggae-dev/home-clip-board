package handler

import (
	"bufio"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// All listeners wait on the same channel. Closing it broadcasts a change
// without queuing individual mutations for slow clients.
type queueChanges struct {
	mu   sync.Mutex
	next chan struct{}
}

func (q *queueChanges) listen() <-chan struct{} {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.next
}

func (q *queueChanges) notify() {
	q.mu.Lock()
	defer q.mu.Unlock()
	close(q.next)
	q.next = make(chan struct{})
}

func (h *Handler) QueueEvents(c *fiber.Ctx) error {
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-store")
	c.Set("X-Accel-Buffering", "no")
	if c.Method() == fiber.MethodHead {
		return nil
	}

	// Subscribe before sending the headers that trigger EventSource.onopen.
	changed := h.changes.listen()
	shutdown := c.Context().Done()
	resp := c.Response()
	resp.ImmediateHeaderFlush = true
	resp.SetBodyStreamWriter(func(w *bufio.Writer) {
		heartbeat := time.NewTicker(25 * time.Second)
		defer heartbeat.Stop()
		frame := ": connected\n\n"
		for {
			if _, err := w.WriteString(frame); err != nil {
				return
			}
			if err := w.Flush(); err != nil {
				return
			}
			select {
			case <-shutdown:
				return
			case <-changed:
				changed = h.changes.listen()
				frame = "event: queue-changed\ndata: {}\n\n"
			case <-heartbeat.C:
				frame = ": keep-alive\n\n"
			}
		}
	})
	return nil
}
