import { useState } from "react";

/**
 * 갤러리 검색 입력 → 제출 후 입력 비움.
 * @param {(query: string) => Promise<boolean>} onSearch
 */
export default function GallerySearchBox({ onSearch, busy = false, placeholder = "장소·분위기 검색 (Pinecone 벡터)" }) {
  const [q, setQ] = useState("");

  const runSearch = async (term) => {
    const t = String(term || "").trim();
    if (!t || busy) {
      return;
    }
    await onSearch(t);
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
    </div>
  );
}
