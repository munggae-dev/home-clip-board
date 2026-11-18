package model

import "time"

const (
	TypeText  = "text"
	TypeImage = "image"
)

type QueueItem struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Content   string    `json:"content,omitempty"`
	FilePath  string    `json:"-"`
	Mime      string    `json:"mime,omitempty"`
	Size      int64     `json:"size,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type QueueItemMeta struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Preview   string    `json:"preview,omitempty"`
	Mime      string    `json:"mime,omitempty"`
	Size      int64     `json:"size,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	ThumbURL  string    `json:"thumb_url,omitempty"`
}

type CreateTextRequest struct {
	Content string `json:"content"`
}
