export default function ChatSearchBar({ query, onChange }) {
  return (
    <div className="chat-bar-wrap">
      <input
        className="chat-bar"
        type="text"
        placeholder="광주/전남 지역명을 검색하세요. 예: 충장로, 여수, 순천"
        value={query}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
