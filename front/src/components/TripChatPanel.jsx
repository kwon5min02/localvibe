import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { flushSync } from 'react-dom';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const ASSISTANT_MESSAGE_DELAY = 0.3;
const LOADING_INDICATOR_DELAY = 0.7;

function getMaxLocationsByDuration(days) {
  return Math.max(1, days * 5);
}

function parseTripDuration(text) {
  // "추가" 또는 "더" 키워드가 있으면 기간 증감 요청이므로 null 반환
  if (/추가|더/.test(text)) {
    return null;
  }

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

function parseDurationIncrement(text) {
  if (/하루\s*(더|추가)/.test(text)) {
    return 1;
  }

  const numericDayMatch = text.match(/(\d+)\s*일\s*(더|추가)/);
  if (numericDayMatch) {
    const delta = Number(numericDayMatch[1]);
    if (Number.isFinite(delta) && delta > 0) {
      return delta;
    }
  }

  return 0;
}

function applyDurationIncrement(currentDuration, incrementDays) {
  if (
    !currentDuration ||
    !Number.isFinite(incrementDays) ||
    incrementDays <= 0
  ) {
    return null;
  }

  const nextDays = Math.max(1, Number(currentDuration.days) + incrementDays);
  const nextNights = Math.max(0, nextDays - 1);
  return {
    nights: nextNights,
    days: nextDays,
    maxLocations: getMaxLocationsByDuration(nextDays),
  };
}

function parseRequestedAddCount(text) {
  const match = text.match(/(\d+)\s*개\s*(더\s*)?(추가|추천)/);
  if (!match) {
    return null;
  }
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }
  return count;
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function parseReplaceIntent(text) {
  // "X말고 다른 걸로 바꿔줘", "X를 교체해줘", "X 다시 추천해줘" 등 감지
  const patterns = [
    /(.*?)\s*말고\s*(?:다른 )?(?:걸로 )?(?:바꿔|교체|변경)(?:\s*해)?(?:줘|주세요|달라|주라)?/,
    /(\S+?)\s*(?:을|를)\s*(?:다른 )?(?:걸로 )?(?:바꿔|교체|변경)(?:\s*해)?(?:줘|주세요|달라|주라)?/,
    /(\S+?)\s*(?:을|를)\s*다시\s*(?:추천|추천해)(?:\s*해)?(?:줘|주세요|달라|주라)?/,
    /(\S+?)\s*(?:을|를)\s*(?:바꿔|교체|변경)(?:\s*해)?(?:줘|주세요|달라|주라)?/,
    /(\S+?)\s*(?:다른 )?(?:걸로 )?(?:바꿔|교체|변경)(?:\s*해)?(?:줘|주세요|달라|주라)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const target = String(match[1] || '').trim();
      if (target) {
        return target;
      }
    }
  }
  return null;
}

function hasRemoveIntent(text) {
  return /제외|삭제|제거|없애|빼/.test(text);
}

function parseRemoveIntent(text) {
  // "X 제외해줘", "X 삭제해줘", "X 빼줘", "X 없애줘" 등 감지
  const patterns = [
    /(.*?)\s*(?:을|를)?\s*(?:제외|삭제|제거|빼|없애)(?:\s*해)?(?:줘|주세요|주라|줘요)?/,
    /(\S+?)\s*(?:을|를)\s*(?:제외|삭제|제거|빼|없애)(?:\s*해)?(?:줘|주세요|주라|줘요)?/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const target = String(match[1] || '').trim();
    if (target) {
      return target;
    }
  }

  return null;
}

/**
 * TripChatPanel Component
 * Specialized chat for Trip Planner - adds/removes locations from roadmap
 *
 * Props:
 *   - onTripLocationsChange: Function called with recommended region IDs
 *   - currentLocations: Array of currently added locations (for context)
 */
export default function TripChatPanel({
  onTripLocationsChange,
  onReplaceLocation,
  resolveRegionName,
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

    // Ensure the user's bubble appears immediately before additional intent parsing/network work.
    flushSync(() => {
      setMessages(prev => [...prev, { role: 'user', text: trimmed }]);
      setInput('');
    });

    const removeIntentName = parseRemoveIntent(trimmed);
    if (hasRemoveIntent(trimmed)) {
      if (currentLocations.length === 0) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: '현재 로드맵이 비어 있어 제거할 장소가 없습니다. 먼저 장소를 추가해 주세요.',
          },
        ]);
        return;
      }

      if (removeIntentName) {
        const normalizedTarget = normalizeForMatch(removeIntentName);
        const matchedLocation = currentLocations.find(loc =>
          normalizeForMatch(loc.name).includes(normalizedTarget),
        );

        if (matchedLocation) {
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: `${matchedLocation.name}은(는) 왼쪽 로드맵의 점(노드)에 마우스를 올리면 나오는 제거 버튼으로 바로 뺄 수 있어요.`,
            },
          ]);
          return;
        }
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: '제거는 왼쪽 로드맵 노드에 마우스를 올리면 나타나는 제거 버튼으로 할 수 있어요.',
        },
      ]);
      return;
    }

    const parsedDuration = parseTripDuration(trimmed);
    const incrementDays = parseDurationIncrement(trimmed);
    const incrementedDuration = applyDurationIncrement(
      tripDuration,
      incrementDays,
    );
    const resolvedDuration = parsedDuration || incrementedDuration;
    const shouldCaptureDuration = Boolean(resolvedDuration);

    if (!tripDuration && !resolvedDuration) {
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
      setTripDuration(resolvedDuration);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text:
            incrementedDuration && !parsedDuration
              ? `일정을 업데이트했어요! ${resolvedDuration.nights}박 ${resolvedDuration.days}일 기준으로 최대 ${resolvedDuration.maxLocations}개 장소까지 추천해드릴게요.`
              : `좋아요! ${resolvedDuration.nights}박 ${resolvedDuration.days}일 기준으로 최대 ${resolvedDuration.maxLocations}개 장소까지 추천해드릴게요. 이제 가고 싶은 지역이나 테마를 알려주세요.`,
        },
      ]);

      if (isDurationOnlyMessage(trimmed)) {
        return;
      }
    }

    const activeDuration = shouldCaptureDuration
      ? resolvedDuration
      : tripDuration;
    const requestedAddCount = parseRequestedAddCount(trimmed);
    const replaceLocationName = parseReplaceIntent(trimmed);

    // 교체 요청 처리
    if (replaceLocationName) {
      const normalizedTarget = normalizeForMatch(replaceLocationName);
      const matchedLocation = currentLocations.find(loc =>
        normalizeForMatch(loc.name).includes(normalizedTarget),
      );

      if (matchedLocation) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: `${matchedLocation.name}을 다른 장소로 교체해드릴게요!`,
          },
        ]);

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
              currentLocationIds: currentLocations.map(loc => loc.id),
              excludeLocationId: matchedLocation.id,
            }),
          });

          if (!response.ok) {
            throw new Error('chat api error');
          }

          const data = await response.json();

          if (
            Array.isArray(data?.recommendedRegionIds) &&
            data.recommendedRegionIds.length > 0
          ) {
            const newLocationId = data.recommendedRegionIds[0];
            if (newLocationId !== matchedLocation.id) {
              onReplaceLocation?.(matchedLocation.id, newLocationId);
              const newLocationName = resolveRegionName?.(newLocationId);
              setMessages(prev => [
                ...prev,
                {
                  role: 'assistant',
                  text: newLocationName
                    ? `${matchedLocation.name}을(를) ${newLocationName}(으)로 교체했어요.`
                    : `${matchedLocation.name}을(를) 다른 장소로 교체했어요.`,
                },
              ]);
            } else {
              setMessages(prev => [
                ...prev,
                {
                  role: 'assistant',
                  text: '같은 장소가 다시 추천되어 교체하지 못했어요. 지역이나 테마를 조금 더 알려주세요.',
                },
              ]);
            }
          } else {
            setMessages(prev => [
              ...prev,
              {
                role: 'assistant',
                text: '대체할 장소를 찾지 못했어요. 지역이나 테마를 조금 더 알려주시면 다시 교체해볼게요.',
              },
            ]);
          }
        } catch (error) {
          console.error('Chat error:', error);
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: '교체 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
            },
          ]);
        } finally {
          setIsLoading(false);
        }
        return;
      } else {
        const currentNames = currentLocations.map(loc => loc.name).join(', ');
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: `"${replaceLocationName}"을 찾지 못했어요. 현재 로드맵: ${currentNames || '비어 있음'}`,
          },
        ]);
        return;
      }
    }

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
          currentLocationIds: currentLocations.map(loc => loc.id),
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
        const currentLocationIds = new Set(currentLocations.map(loc => loc.id));
        const remainingSlots = Number.isFinite(maxLocations)
          ? Math.max(0, maxLocations - currentLocations.length)
          : null;
        const requestedLimit = Number.isFinite(requestedAddCount)
          ? requestedAddCount
          : null;

        // 현재 로드맵에 없는 새로운 ID들만 필터링
        const newIds = data.recommendedRegionIds.filter(
          id => !currentLocationIds.has(id),
        );

        const effectiveLimit = Number.isFinite(remainingSlots)
          ? Number.isFinite(requestedLimit)
            ? Math.min(remainingSlots, requestedLimit)
            : remainingSlots
          : requestedLimit;

        const idsForApply = Number.isFinite(effectiveLimit)
          ? newIds.slice(0, effectiveLimit)
          : newIds;

        if (idsForApply.length > 0) {
          // 추가할 장소 있음 → 로드맵에 반영
          onTripLocationsChange?.(idsForApply, {
            maxLocations,
            requestedAddCount,
          });
        } else if (remainingSlots === 0) {
          // 슬롯이 가득 찬 경우
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: `현재 ${maxLocations}개 장소로 가득 찼습니다. 기간을 연장하면 더 추가할 수 있어요! 예: "1일 더 추가해줘"`,
            },
          ]);
        } else if (newIds.length === 0) {
          // 추천 장소가 모두 이미 로드맵에 있는 경우
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: '모두 이미 추가된 장소네요. 다른 지역이나 테마를 추천해주시면 새로운 장소를 찾아드릴 수 있습니다!',
            },
          ]);
        }
      } else if (!Array.isArray(data?.recommendedRegionIds)) {
        // 권장 지역 ID가 없는 경우
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: data.answer || '응답이 비어 있습니다.' },
        ]);
      }
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
              delay: message.role === 'assistant' ? ASSISTANT_MESSAGE_DELAY : 0,
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
            transition={{
              duration: 0.3,
              ease: 'easeOut',
              delay: LOADING_INDICATOR_DELAY,
            }}
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
