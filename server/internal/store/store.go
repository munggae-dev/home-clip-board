package store

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/munggae-dev/home-clip-board/server/internal/model"
	_ "modernc.org/sqlite"
)

var (
	ErrRequestConflict = errors.New("이 요청 번호가 다른 내용에 사용되었습니다.")
	ErrItemDeleted     = errors.New("이 요청으로 추가한 항목이 이미 삭제되었습니다.")
)

type Store struct {
	db        *sql.DB
	uploadDir string
}

func Open(dbPath, uploadDir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	// Serialize the short SQLite transactions, including simultaneous retries.
	db.SetMaxOpenConns(1)
	s := &Store{db: db, uploadDir: uploadDir}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) UploadDir() string {
	return s.uploadDir
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS queue_items (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			content TEXT,
			file_path TEXT,
			mime TEXT,
			size INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_queue_created ON queue_items(created_at DESC);
		CREATE TABLE IF NOT EXISTS queue_creation_requests (
			request_id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL UNIQUE,
			digest BLOB
		);
		CREATE TRIGGER IF NOT EXISTS clear_deleted_request_digest
		AFTER DELETE ON queue_items BEGIN
			UPDATE queue_creation_requests SET digest = NULL WHERE item_id = OLD.id;
		END;
	`)
	return err
}

// Insert records the request and its queue item atomically. A deleted item's
// receipt retains only random IDs so a delayed retry cannot recreate it.
func (s *Store) Insert(item model.QueueItem, key string, digest []byte) (*model.QueueItem, bool, error) {
	item.ID = uuid.NewString()
	item.CreatedAt = time.Now().UTC()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()

	if key != "" {
		result, err := tx.Exec(`INSERT INTO queue_creation_requests (request_id, item_id, digest)
			VALUES (?, ?, ?) ON CONFLICT(request_id) DO NOTHING`, key, item.ID, digest)
		if err != nil {
			return nil, false, err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return nil, false, err
		}
		if count == 0 {
			var id string
			var prior []byte
			if err := tx.QueryRow(`SELECT item_id, digest FROM queue_creation_requests WHERE request_id = ?`, key).Scan(&id, &prior); err != nil {
				return nil, false, err
			}
			if prior == nil {
				return nil, false, ErrItemDeleted
			}
			if !bytes.Equal(digest, prior) {
				return nil, false, ErrRequestConflict
			}
			existing, err := getByID(tx, id)
			if err != nil {
				return nil, false, err
			}
			if existing == nil {
				return nil, false, ErrItemDeleted
			}
			if existing.Type != item.Type || existing.Mime != item.Mime {
				return nil, false, ErrRequestConflict
			}
			return existing, false, nil
		}
	}

	_, err = tx.Exec(`INSERT INTO queue_items (id, type, content, file_path, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.Type, item.Content, item.FilePath, item.Mime, item.Size, item.CreatedAt.Format(time.RFC3339Nano))
	if err != nil {
		return nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &item, true, nil
}

func (s *Store) List(limit int) ([]model.QueueItemMeta, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(
		`SELECT id, type, content, file_path, mime, size, created_at FROM queue_items ORDER BY created_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []model.QueueItemMeta
	for rows.Next() {
		var id, typ, content, filePath, mime, createdStr string
		var size int64
		if err := rows.Scan(&id, &typ, &content, &filePath, &mime, &size, &createdStr); err != nil {
			return nil, err
		}
		createdAt, _ := time.Parse(time.RFC3339Nano, createdStr)
		meta := model.QueueItemMeta{
			ID:        id,
			Type:      typ,
			Mime:      mime,
			Size:      size,
			CreatedAt: createdAt,
		}
		switch typ {
		case model.TypeText:
			meta.Preview = truncate(content, 80)
		case model.TypeImage:
			meta.ThumbURL = "/api/queue/" + id + "/file"
		}
		items = append(items, meta)
	}
	return items, rows.Err()
}

func (s *Store) GetByID(id string) (*model.QueueItem, error) {
	return getByID(s.db, id)
}

type rowQuerier interface {
	QueryRow(string, ...any) *sql.Row
}

func getByID(q rowQuerier, id string) (*model.QueueItem, error) {
	var item model.QueueItem
	var createdStr string
	err := q.QueryRow(
		`SELECT id, type, content, file_path, mime, size, created_at FROM queue_items WHERE id = ?`,
		id,
	).Scan(&item.ID, &item.Type, &item.Content, &item.FilePath, &item.Mime, &item.Size, &createdStr)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdStr)
	return &item, nil
}

func (s *Store) Delete(id string) (*model.QueueItem, error) {
	item, err := s.GetByID(id)
	if err != nil || item == nil {
		return item, err
	}
	result, err := s.db.Exec(`DELETE FROM queue_items WHERE id = ?`, id)
	if err != nil {
		return nil, err
	}
	deleted, err := result.RowsAffected()
	if err != nil || deleted == 0 {
		return nil, err
	}
	if item.Type == model.TypeImage && item.FilePath != "" {
		full := filepath.Join(s.uploadDir, item.FilePath)
		_ = os.Remove(full)
	}
	return item, nil
}

func (s *Store) ResolveFilePath(relPath string) (string, error) {
	clean := filepath.Clean(relPath)
	if clean != relPath || strings.Contains(clean, "..") || filepath.IsAbs(clean) {
		return "", fmt.Errorf("invalid file path")
	}
	full := filepath.Join(s.uploadDir, clean)
	absUpload, err := filepath.Abs(s.uploadDir)
	if err != nil {
		return "", err
	}
	absFull, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(absFull, absUpload+string(os.PathSeparator)) && absFull != absUpload {
		return "", fmt.Errorf("path outside upload dir")
	}
	return absFull, nil
}

func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}
