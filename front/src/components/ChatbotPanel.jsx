import { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export default function ChatbotPanel({ onRecommendFeed }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "랜덤 추천으로 나와있어요. 원하는 여행/업종/분위기를 입력하면 새롭게 다시 피드를 추천드릴게요."
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) {
      return;
    }

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed })
      });

      if (!response.ok) {
        throw new Error("chat api error");
      }

      const data = await response.json();
      if (Array.isArray(data?.recommendedRegionIds)) {
        onRecommendFeed?.(data.recommendedRegionIds);
      }
      setMessages((prev) => [...prev, { role: "assistant", text: data.answer || "응답이 비어 있습니다." }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "챗봇 연결에 실패했습니다. 잠시 후 다시 시도해 주세요." }
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="chatbot-panel">
      <h2 className="chatbot-title">LocalVibe 챗봇</h2>
      <div className="chatbot-messages">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`chatbot-message ${message.role}`}>
            {message.text}
          </div>
        ))}
        {isLoading && <div className="chatbot-message assistant">응답 생성 중...</div>}
      </div>
      <form className="chatbot-form" onSubmit={handleSubmit}>
        <input
          className="chatbot-input"
          type="text"
          placeholder="예: 여자친구랑 2박3일 광주 여행 코스 추천해줘"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button className="chatbot-send" type="submit" disabled={isLoading}>
          전송
        </button>
      </form>
    </section>
  );
}
