import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

function getMaxLocationsByDuration(days) {
  return Math.max(1, days * 5);
}

function parseTripDuration(text) {
  const nightsDaysMatch = text.match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (nightsDaysMatch) {
    const nights = Number(nightsDaysMatch[1]);
    const days = Number(nightsDaysMatch[2]);
    if (Number.isFinite(nights) && Number.isFinite(days) && days >= 1) {
      return { nights, days, maxLocations: getMaxLocationsByDuration(days) };
    }
  }

  const nightsOnlyMatch = text.match(/(\d+)\s*박/);
  if (nightsOnlyMatch) {
    const nights = Number(nightsOnlyMatch[1]);
    const days = nights + 1;
    if (Number.isFinite(nights) && days >= 1) {
      return { nights, days, maxLocations: getMaxLocationsByDuration(days) };
    }
  }

  const daysOnlyMatch = text.match(/(\d+)\s*일/);
  if (daysOnlyMatch) {
    const days = Number(daysOnlyMatch[1]);
    const nights = Math.max(0, days - 1);
    if (Number.isFinite(days) && days >= 1) {
      return { nights, days, maxLocations: getMaxLocationsByDuration(days) };
    }
  }

  return null;
}

function isDurationOnlyMessage(text) {
  return /^\s*\d+\s*(박\s*\d+\s*일|박|일)\s*$/.test(text);
}

/**
 * TripChatPanel Component
 * Specialized chat for Trip Planner - adds/removes locations from roadmap
 * Different from ChatbotPanel which is for gallery recommendations
 *
 * Props:
 *   - onTripLocationsChange: Function called with recommended region IDs
 *   - currentLocations: Array of currently added locations (for context)
 */
export default function TripChatPanel({
  onTripLocationsChange,
  currentLocations = [],
}) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: '🗺️ 먼저 여행 기간을 알려주세요! 예: 2박 3일, 3일, 1박',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastLocationCount, setLastLocationCount] = useState(0);
  const [tripDuration, setTripDuration] = useState(null);
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    // Wait for layout/animation frame so the latest message height is reflected.
    const frameId = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frameId);
  }, [messages, isLoading]);

  // Show roadmap summary when locations are added/removed
  useEffect(() => {
    if (currentLocations.length > lastLocationCount) {
      // Locations added
      const addedCount = currentLocations.length - lastLocationCount;
      const summaryText =
        addedCount === 1
          ? `✅ 장소가 추가되었습니다!\n\n📍 현재 로드맵:\n${currentLocations
              .map((loc, i) => `${i + 1}. ${loc.name}`)
              .join('\n')}`
          : `✅ ${addedCount}개의 장소가 추가되었습니다!\n\n📍 현재 로드맵:\n${currentLocations
              .map((loc, i) => `${i + 1}. ${loc.name}`)
              .join('\n')}`;

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: summaryText,
        },
      ]);
    } else if (currentLocations.length < lastLocationCount) {
      // Locations removed
      const removedCount = lastLocationCount - currentLocations.length;
      const summaryText =
        currentLocations.length === 0
          ? '🗑️ 모든 장소가 제거되었습니다.'
          : `🗑️ ${removedCount}개의 장소가 제거되었습니다!\n\n📍 남은 로드맵:\n${currentLocations
              .map((loc, i) => `${i + 1}. ${loc.name}`)
              .join('\n')}`;

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: summaryText,
        },
      ]);
    }
    setLastLocationCount(currentLocations.length);
  }, [currentLocations, lastLocationCount]);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) {
      return;
    }

    setMessages(prev => [...prev, { role: 'user', text: trimmed }]);
    setInput('');

    const parsedDuration = parseTripDuration(trimmed);
    const shouldCaptureDuration = !tripDuration && parsedDuration;

    if (!tripDuration && !parsedDuration) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: '일정을 먼저 맞춰볼게요. 몇 박 몇 일 여행인지 알려주세요! 예: 2박 3일',
        },
      ]);
      return;
    }

    if (shouldCaptureDuration) {
      setTripDuration(parsedDuration);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: `좋아요! ${parsedDuration.nights}박 ${parsedDuration.days}일 기준으로 최대 ${parsedDuration.maxLocations}개 장소까지 추천해드릴게요. 이제 가고 싶은 지역이나 테마를 알려주세요.`,
        },
      ]);

      if (isDurationOnlyMessage(trimmed)) {
        return;
      }
    }

    const activeDuration = shouldCaptureDuration
      ? parsedDuration
      : tripDuration;
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          tripDuration: activeDuration
            ? {
                nights: activeDuration.nights,
                days: activeDuration.days,
              }
            : null,
        }),
      });

      if (!response.ok) {
        throw new Error('chat api error');
      }

      const data = await response.json();

      // Handle recommended region IDs - these get added to the roadmap
      if (
        Array.isArray(data?.recommendedRegionIds) &&
        data.recommendedRegionIds.length > 0
      ) {
        const maxLocations = activeDuration?.maxLocations;
        const limitedRegionIds = Number.isFinite(maxLocations)
          ? data.recommendedRegionIds.slice(0, maxLocations)
          : data.recommendedRegionIds;
        onTripLocationsChange?.(limitedRegionIds);

        if (maxLocations && data.recommendedRegionIds.length > maxLocations) {
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: `📌 ${activeDuration.nights}박 ${activeDuration.days}일 일정 기준으로 ${maxLocations}개 장소만 우선 반영했어요.`,
            },
          ]);
        }
      }

      // Show the AI's response
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: data.answer || '응답이 비어 있습니다.' },
      ]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: '챗봇 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="trip-chat-panel">
      <h2 className="trip-chat-title">🤖 로드맵 편집 챗봇</h2>

      {/* Current locations info */}
      {currentLocations.length > 0 && (
        <div className="trip-chat-info">
          <span className="info-label">
            현재 {currentLocations.length}개 장소
          </span>
          <span className="info-icons">
            {currentLocations.slice(0, 3).map(loc => (
              <span key={loc.id} title={loc.name}>
                📍
              </span>
            ))}
            {currentLocations.length > 3 && (
              <span>+{currentLocations.length - 3}</span>
            )}
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="trip-chat-messages" ref={messagesContainerRef}>
        {messages.map((message, index) => (
          <motion.div
            key={`${message.role}-${index}`}
            className={`trip-chat-message ${message.role}`}
            initial={{
              opacity: 0,
              x: message.role === 'user' ? 100 : -100,
              y: 20,
            }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{
              duration: 0.3,
              ease: 'easeOut',
              delay: index * 0.05,
            }}
          >
            {message.role === 'assistant' && (
              <span className="chat-icon">🤖</span>
            )}
            {message.text}
          </motion.div>
        ))}
        {isLoading && (
          <motion.div
            className="trip-chat-message assistant"
            initial={{ opacity: 0, x: -100, y: 20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <span className="chat-icon">🤖</span>
            응답 생성 중...
          </motion.div>
        )}
      </div>

      {/* Input form */}
      <form className="trip-chat-form" onSubmit={handleSubmit}>
        <input
          className="trip-chat-input"
          type="text"
          placeholder={
            tripDuration
              ? '예: 경주 중심으로 추천해줘, 불국사 추가해줘'
              : '예: 2박 3일, 3일, 1박'
          }
          value={input}
          onChange={event => setInput(event.target.value)}
          disabled={isLoading}
        />
        <button className="trip-chat-send" type="submit" disabled={isLoading}>
          {isLoading ? '⏳' : '✈️'}
        </button>
      </form>
    </section>
  );
}
