import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { flushSync } from 'react-dom';
import ComparisonTable from './ui/ComparisonTable';
import ImageGallery from './ui/ImageGallery';
import MultiMarkerMap from './ui/MultiMarkerMap';

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

const VISUAL_INTENT_PATTERNS = [
  /비교|vs\b|VS\b|차이|대비/,
  /사진|이미지|보고\s*싶/,
  /지도|마커|위치.*보여/,
];

const HELP_TEXT = `📋 사용 가능한 기능을 알려드릴게요!

🗺️ 장소 추천 & 일정 관리
• "[지역] [테마] 추천해줘" → 로드맵에 장소 추가
• "[N]일" / "[N]박 [N]일" → 여행 기간 설정
• "[N]일 더 추가해줘" → 기간 연장
• "[장소명] 제외해줘" → 장소 삭제
• "[장소명] 말고 다른 곳으로 바꿔줘" → 장소 교체

🖼️ 시각화
• "[장소A] vs [장소B] 비교해줘" → 두 장소 비교 카드 팝업
• "[테마] 사진 보고 싶어" → 이미지 갤러리 팝업
• "지도 보여줘" → 현재 일정 전체 마커 지도 팝업`;

const HELP_PATTERNS = [
  /도움말|도움|헬프|help/i,
  /뭐\s*(할|해|도와|가능)/,
  /기능\s*(뭐|있|알려|목록)/,
  /어떻게\s*(써|사용|활용)/,
  /사용법|설명해/,
];

function isHelpIntent(text) {
  return HELP_PATTERNS.some(p => p.test(text));
}

const UNSUPPORTED_PATTERNS = [
  /경로|동선|루트|지도로\s*보여/,
  /날씨|기온|비\s*오|맑|흐림/,
  /예약|가격|요금|비용|얼마/,
  /영업\s*시간|몇\s*시|오픈|클로즈/,
  /교통|버스|지하철|기차|택시|주차/,
];

function isUnsupportedIntent(text) {
  return UNSUPPORTED_PATTERNS.some(p => p.test(text));
}

function isVisualIntent(text) {
  return VISUAL_INTENT_PATTERNS.some(pattern => pattern.test(text));
}

const ACTION_COMPONENT_MAP = {
  comparePlaces: (data) => <ComparisonTable items={data?.items ?? []} />,
  showImageGallery: (data) => <ImageGallery images={data?.images ?? []} />,
  showMap: (data) => <MultiMarkerMap locations={data?.locations ?? []} />,
};

const ACTION_LABEL_MAP = {
  comparePlaces: '비교 보기',
  showImageGallery: '이미지 갤러리 보기',
  showMap: '지도에서 보기',
};

async function callVisualAction(message, currentLocationNames) {
  const response = await fetch(`${API_BASE_URL}/api/visual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, currentLocationNames }),
  });
  if (!response.ok) throw new Error('visual api error');
  return response.json();
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
 * Different from ChatbotPanel which is for gallery recommendations
 *
 * Props:
 *   - onTripLocationsChange: Function called with recommended region IDs
 *   - currentLocations: Array of currently added locations (for context)
 */
const INITIAL_MESSAGE = {
  role: 'assistant',
  text: '🗺️ 어디로 여행 갈까요? 지역, 테마, 기간을 자유롭게 말해주세요!\n사용 가능한 기능이 궁금하시면 "도움말"을 입력해보세요.',
};

function TripChatPanelInner({
  onTripLocationsChange,
  onReplaceLocation,
  onRemoveLocation,
  resolveRegionName,
  currentLocations = [],
  onResetRef,
}) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastLocationCount, setLastLocationCount] = useState(0);
  const [tripDuration, setTripDuration] = useState(null);
  const [visualPopup, setVisualPopup] = useState(null); // { componentType, uiData }
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    if (onResetRef) {
      onResetRef.current = () => {
        setMessages([INITIAL_MESSAGE]);
        setTripDuration(null);
        setLastLocationCount(0);
      };
    }
  }, [onResetRef]);

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

    if (isHelpIntent(trimmed)) {
      setMessages(prev => [...prev, { role: 'assistant', text: HELP_TEXT }]);
      return;
    }

    const removeIntentName = parseRemoveIntent(trimmed);
    if (hasRemoveIntent(trimmed)) {
      if (currentLocations.length === 0) {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: '현재 일정이 비어 있어요. 먼저 장소를 추가해 주세요.' },
        ]);
        return;
      }

      if (removeIntentName) {
        const normalizedTarget = normalizeForMatch(removeIntentName);
        const matchedLocation = currentLocations.find(loc =>
          normalizeForMatch(loc.name).includes(normalizedTarget),
        );

        if (matchedLocation) {
          onRemoveLocation?.(matchedLocation.id);
          setMessages(prev => [
            ...prev,
            { role: 'assistant', text: `${matchedLocation.name}을(를) 일정에서 제외했어요.` },
          ]);
          return;
        }
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: `제외할 장소를 찾지 못했어요. 현재 일정: ${currentLocations.map(l => l.name).join(', ')}`,
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

    const DEFAULT_DURATION = { nights: 1, days: 2, maxLocations: 10 };

    if (!tripDuration && !resolvedDuration) {
      // 기간 없으면 기본값으로 자동 설정 후 계속 진행
      setTripDuration(DEFAULT_DURATION);
    }

    if (shouldCaptureDuration) {
      setTripDuration(resolvedDuration);
      if (isDurationOnlyMessage(trimmed)) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: `${resolvedDuration.nights}박 ${resolvedDuration.days}일로 설정했어요. 어느 지역이나 테마를 원하시나요?`,
          },
        ]);
        return;
      }
      // 기간 + 지역이 함께 오면 확인 메시지 없이 추천으로 바로 진행
    }

    const activeDuration = shouldCaptureDuration
      ? resolvedDuration
      : (tripDuration ?? DEFAULT_DURATION);
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

    // 지도 요청 → currentLocations 직접 사용 (백엔드 호출 없음)
    if (/지도|마커|위치.*보여/.test(trimmed)) {
      if (currentLocations.length === 0) {
        setMessages(prev => [...prev, { role: 'assistant', text: '아직 일정에 장소가 없어요. 먼저 장소를 추가해주세요!' }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: `현재 일정 ${currentLocations.length}개 장소를 지도에 표시할게요.`,
          componentType: 'showMap',
          uiData: { locations: currentLocations },
        }]);
      }
      return;
    }

    // 시각화 요청 → /api/visual 직접 호출
    if (isVisualIntent(trimmed)) {
      setIsLoading(true);
      try {
        const currentNames = currentLocations.map(l => l.name);
        const data = await callVisualAction(trimmed, currentNames);
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: data.answer ?? '',
            componentType: data.componentType ?? null,
            uiData: data.uiData ?? null,
          },
        ]);
      } catch (err) {
        console.error('visual action error:', err);
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: '시각화 요청 처리 중 오류가 발생했습니다.' },
        ]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 명백히 지원 안 되는 요청이면 안내 메시지
    if (isUnsupportedIntent(trimmed)) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: '저는 여행 장소 추천, 장소 비교, 이미지 갤러리를 도와드릴 수 있어요!\n예: "광주 카페 추천해줘" / "달마고도 vs 불갑사 비교해줘" / "감성 카페 사진 보고 싶어"',
        },
      ]);
      return;
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
              text: `현재 ${maxLocations}개 장소로 가득 찼어요! 기간을 늘리거나, 특정 장소를 교체하고 싶으시면 말씀해주세요.\n예: "1일 더 추가해줘" / "달마고도 말고 다른 곳으로 바꿔줘"`,
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
            {message.componentType && ACTION_COMPONENT_MAP[message.componentType] && (
              <div className="copilot-ui-button-wrap">
                <button
                  className="copilot-ui-open-btn"
                  onClick={() => setVisualPopup({ componentType: message.componentType, uiData: message.uiData })}
                >
                  {ACTION_LABEL_MAP[message.componentType] ?? '시각화 보기'} →
                </button>
              </div>
            )}
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

      {/* Visual Popup Modal */}
      {visualPopup && (
        <div className="visual-popup-overlay" onClick={() => setVisualPopup(null)}>
          <div className="visual-popup-content" onClick={e => e.stopPropagation()}>
            <button className="visual-popup-close" onClick={() => setVisualPopup(null)}>✕</button>
            {ACTION_COMPONENT_MAP[visualPopup.componentType]?.(visualPopup.uiData)}
          </div>
        </div>
      )}

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

export default function TripChatPanel({ onResetRef, ...props }) {
  return <TripChatPanelInner {...props} onResetRef={onResetRef} />;
}
