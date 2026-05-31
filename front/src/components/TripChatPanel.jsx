import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { createPortal, flushSync } from 'react-dom';
import ComparisonTable from './ui/ComparisonTable';
// import ImageGallery from './ui/ImageGallery';
// import MultiMarkerMap from './ui/MultiMarkerMap';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const ASSISTANT_MESSAGE_DELAY = 0.3;
const LOADING_INDICATOR_DELAY = 0.7;

/** 비교·갤러리·지도 + '방금/저 공원' 등 맥락 후속 */
function isTripVisualRequest(text) {
  const t = String(text || '');
  if (/비교|vs\b|VS\b|차이|대비/.test(t)) {
    return true;
  }
  // 갤러리·지도 기능 비활성화
  // if (/사진|이미지|보고\s*싶|갤러리/.test(t)) return true;
  // if (/(지도|마커|맵)/.test(t) && /(보여|표시|띄워|알려|찍|볼|줄래|까|펼쳐)/.test(t)) return true;
  // if (/(위치|어디)/.test(t) && /(지도|맵|보여|알려|찍|볼|줄래|까)/.test(t)) return true;
  if (
    /(저|그거|그\s|방금|아까|직전|위에|아까\s*말한|방금\s*보여|방금\s*추천)/.test(t) &&
    /(비교|vs)/.test(t)
  ) {
    return true;
  }
  return false;
}

function buildVisualPayload(message, currentLocations, chatHistory) {
  const recentChat = (chatHistory || [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-14)
    .map(m => ({
      role: m.role,
      text: String(m.text || '').slice(0, 2000),
    }));

  return {
    message,
    currentLocationNames: currentLocations.map(l => l.name),
    locations: currentLocations.map(l => ({
      id: l.id,
      name: l.name,
      latitude: l.latitude ?? null,
      longitude: l.longitude ?? null,
      summary: (l.summary || '').slice(0, 200),
    })),
    recentChat,
  };
}

async function callVisualAction(payload) {
  const response = await fetch(`${API_BASE_URL}/api/visual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('visual api error');
  }
  return response.json();
}

const HELP_TEXT = `사용 가능한 기능을 알려드릴게요!

장소 추천 & 일정 관리
• "[지역] [테마] 추천해줘" → 로드맵에 장소 추가
• "[N]일" / "[N]박 [N]일" → 여행 기간 설정
• "[N]일 더 추가해줘" → 기간 연장
• "[장소명] 제외해줘" → 장소 삭제
• "[장소명] 말고 다른 곳으로 바꿔줘" → 장소 교체
• "코스 다시 짜줘" / "장소 교체해서 보여줘" → 말한 조건으로 로드맵 전체 새로 구성

시각화
• "[장소A] vs [장소B] 비교해줘" → 두 장소 비교 카드 팝업`;

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

const ACTION_COMPONENT_MAP = {
  comparePlaces: data => <ComparisonTable items={data?.items ?? []} />,
  // showImageGallery: data => <ImageGallery images={data?.images ?? []} />,
  // showMap: data => <MultiMarkerMap locations={data?.locations ?? []} />,
};

const ACTION_LABEL_MAP = {
  comparePlaces: '비교 보기',
  // showImageGallery: '이미지 갤러리 보기',
  // showMap: '지도에서 보기',
};

/**
 * TripChatPanel Component
 * Specialized chat for Trip Planner - adds/removes locations from roadmap
 *
 * Props:
 *   - onTripLocationsChange: Function called with recommended region IDs
 *   - currentLocations: Array of currently added locations (for context)
 */
const INITIAL_MESSAGE = {
  role: 'assistant',
  text: '어떤 여행을 계획하고 계신가요? 예: "서울 1일 카페 여행", "부산 2박 3일"',
};

function TripChatPanelInner({
  onTripLocationsChange,
  onTripLocationsReplaceAll,
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
  const [visualPopup, setVisualPopup] = useState(null);
  const messagesContainerRef = useRef(null);

  useEffect(() => {
    if (onResetRef) {
      onResetRef.current = () => {
        setMessages([INITIAL_MESSAGE]);
        setTripDuration(null);
        setLastLocationCount(0);
        setVisualPopup(null);
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
        addedCount === 1 ? '장소를 추가했어요.' : `${addedCount}개 장소를 추가했어요.`;

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
          ? '모든 장소를 제거했어요.'
          : `${removedCount}개 장소를 제거했어요.`;

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

    // 도움말은 로컬에서 즉시 처리
    if (isHelpIntent(trimmed)) {
      setMessages(prev => [...prev, { role: 'assistant', text: HELP_TEXT }]);
      return;
    }

    // 시각화 요청은 별도 API 사용
    const chatHistoryForVisual = [...messages, { role: 'user', text: trimmed }];
    if (isTripVisualRequest(trimmed)) {
      setIsLoading(true);
      try {
        const payload = buildVisualPayload(trimmed, currentLocations, chatHistoryForVisual);
        const data = await callVisualAction(payload);
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: data.answer ?? '',
            componentType: data.componentType ?? null,
            uiData: data.uiData ?? null,
          },
        ]);
      } catch {
        setMessages(prev => [...prev, { role: 'assistant', text: '시각화 요청 처리 중 오류가 발생했습니다.' }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 모든 의도 판단을 백엔드 AI에 위임
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          tripDuration: tripDuration
            ? { nights: tripDuration.nights, days: tripDuration.days }
            : null,
          currentLocationIds: currentLocations.map(loc => loc.id),
        }),
      });

      if (!response.ok) throw new Error('chat api error');
      const data = await response.json();

      // 기간 감지 시 상태 업데이트
      if (data?.detectedDuration) {
        setTripDuration(data.detectedDuration);
      }

      const activeDuration = data?.detectedDuration || tripDuration;
      const action = data?.detectedAction;

      // unsupported: 지원하지 않는 요청
      if (action === 'unsupported') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: String(data?.answer || '').trim() },
        ]);
        return;
      }

      // replan: 전체 교체
      if (action === 'replan') {
        if (Array.isArray(data?.recommendedRegionIds) && data.recommendedRegionIds.length > 0) {
          const cap = activeDuration?.maxLocations ?? data.recommendedRegionIds.length;
          onTripLocationsReplaceAll?.(data.recommendedRegionIds.slice(0, cap));
          setMessages(prev => [
            ...prev,
            { role: 'assistant', text: String(data?.answer || '').trim() || '일정을 새로 구성했어요.' },
          ]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', text: String(data?.answer || '').trim() || '새 일정을 만들지 못했어요. 다시 시도해 주세요.' }]);
        }
        return;
      }

      // remove: 장소 삭제 (대체 없음)
      if (action === 'remove') {
        const targetId = data?.excludedLocationId;
        const currentRoadmapIds = new Set(currentLocations.map(loc => loc.id));
        if (!targetId || !currentRoadmapIds.has(targetId)) {
          setMessages(prev => [...prev, { role: 'assistant', text: '현재 일정에 없는 장소예요. 로드맵에 있는 장소 이름을 말씀해 주세요.' }]);
        } else {
          onRemoveLocation?.(targetId);
        }
        return;
      }

      // replace: 장소 교체
      if (action === 'replace') {
        if (!data?.excludedLocationId) {
          setMessages(prev => [...prev, { role: 'assistant', text: '현재 일정에 없는 장소예요. 로드맵에 있는 장소 이름을 말씀해 주세요.' }]);
          return;
        }
        const oldId = data.excludedLocationId;
        const newId = data?.recommendedRegionIds?.[0];
        const currentRoadmapIds = new Set(currentLocations.map(loc => loc.id));
        if (!currentRoadmapIds.has(oldId)) {
          setMessages(prev => [...prev, { role: 'assistant', text: '현재 일정에 없는 장소예요. 로드맵에 있는 장소 이름을 말씀해 주세요.' }]);
        } else if (newId && newId !== oldId) {
          onReplaceLocation?.(oldId, newId);
          setMessages(prev => [...prev, { role: 'assistant', text: '장소를 교체했어요.' }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', text: '대체할 장소를 찾지 못했어요. 다시 시도해 주세요.' }]);
        }
        return;
      }

      // recommend / add_preference: 장소 추가
      if (Array.isArray(data?.recommendedRegionIds) && data.recommendedRegionIds.length > 0) {
        const maxLocations = activeDuration?.maxLocations;
        const currentLocationIds = new Set(currentLocations.map(loc => loc.id));
        const newIds = data.recommendedRegionIds.filter(id => !currentLocationIds.has(id));
        const remainingSlots = Number.isFinite(maxLocations)
          ? Math.max(0, maxLocations - currentLocations.length)
          : null;
        const idsForApply = Number.isFinite(remainingSlots) ? newIds.slice(0, remainingSlots) : newIds;

        if (idsForApply.length > 0) {
          onTripLocationsChange?.(idsForApply, { maxLocations });
        } else {
          const answerText = String(data?.answer || '').trim();
          setMessages(prev => [
            ...prev,
            { role: 'assistant', text: answerText || '추가할 새 장소를 찾지 못했어요.' },
          ]);
        }
        return;
      }

      // 추천 ID 없는 경우 (답변만 있음)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: String(data?.answer || '').trim() || '응답을 받지 못했어요.' },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: '챗봇 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="trip-chat-panel">
      <h2 className="trip-chat-title">로드맵 편집 챗봇</h2>

      {/* Current locations info */}
      {currentLocations.length > 0 && (
        <div className="trip-chat-info">
          <span className="info-label">
            현재 {currentLocations.length}개 장소
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
            {message.text}
            {message.componentType &&
              ACTION_COMPONENT_MAP[message.componentType] && (
                <div className="copilot-ui-button-wrap">
                  <button
                    type="button"
                    className="copilot-ui-open-btn"
                    onClick={() =>
                      setVisualPopup({
                        componentType: message.componentType,
                        uiData: message.uiData,
                      })
                    }
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
            <span className="chatbot-skeleton-dot" />
            <span className="chatbot-skeleton-dot" />
            <span className="chatbot-skeleton-dot" />
          </motion.div>
        )}
      </div>

      {visualPopup && createPortal(
        <div
          className="visual-popup-overlay"
          onClick={() => setVisualPopup(null)}
          role="presentation"
        >
          <div
            className="visual-popup-content"
            onClick={e => e.stopPropagation()}
            role="presentation"
          >
            <button
              type="button"
              className="visual-popup-close"
              onClick={() => setVisualPopup(null)}
            >
              ✕
            </button>
            {ACTION_COMPONENT_MAP[visualPopup.componentType]?.(
              visualPopup.uiData,
            )}
          </div>
        </div>,
        document.body,
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
          →
        </button>
      </form>
    </section>
  );
}

export default function TripChatPanel({
  onResetRef,
  onTripLocationsReplaceAll,
  ...props
}) {
  return (
    <TripChatPanelInner
      {...props}
      onResetRef={onResetRef}
      onTripLocationsReplaceAll={onTripLocationsReplaceAll}
    />
  );
}
