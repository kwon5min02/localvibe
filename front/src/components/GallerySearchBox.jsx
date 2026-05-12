import { useCallback, useState } from "react";

const LS_KEY = "lv_gallery_search_history";

function readHistory() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => String(x || "").trim()) : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, 20)));
}

/**
 * 네이버 검색창 스타일: 입력 → 검색 후 입력 비움. 최근 검색어는 칩으로만 유지(채팅 스레드 없음).
 * @param {(query: string) => Promise<boolean>} onSearch — true면 검색 성공(히스토리에 반영)
 */
export default function GallerySearchBox({ onSearch, busy = false, placeholder = "장소·분위기 검색 (Pinecone 벡터)" }) {
  const [q, setQ] = useState("");
  const [history, setHistory] = useState(readHistory);

  const pushHistory = useCallback((term) => {
    const t = String(term || "").trim();
    if (!t) {
      return;
    }
    setHistory((prev) => {
      const next = [t, ...prev.filter((h) => h !== t)].slice(0, 15);
      writeHistory(next);
      return next;
    });
  }, []);

  const runSearch = async (term) => {
    const t = String(term || "").trim();
    if (!t || busy) {
      return;
    }
    const ok = await onSearch(t);
    if (ok) {
      pushHistory(t);
    }
    setQ("");
  };

  return (
    <div className="gallery-search-stack">
      <form
        className="chat-bar-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(q);
        }}
      >
        <input
          className="chat-bar"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          autoComplete="off"
        />
        <button className="chat-bar-submit" type="submit" disabled={busy || !q.trim()}>
          {busy ? "검색 중…" : "검색"}
        </button>
      </form>
      {history.length > 0 && (
        <div className="gallery-search-history" aria-label="최근 검색">
          {history.map((h) => (
            <button
              key={h}
              type="button"
              className="gallery-history-chip"
              onClick={() => {
                void runSearch(h);
              }}
            >
              {h}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
