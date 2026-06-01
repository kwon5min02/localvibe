import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { createPortal, flushSync } from 'react-dom';
import ComparisonModal from './ComparisonModal';
import TripVisualModal from './TripVisualModal';
import {
  buildCurrentSchedulePayload,
  getMaxLocationsByDuration,
  TRIP_ITEMS_PER_DAY_DEFAULT,
  TRIP_LOADING_PHASES,
} from '../utils/tripSchedule';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const ASSISTANT_MESSAGE_DELAY = 0.3;
const LOADING_INDICATOR_DELAY = 0.7;
const LOADING_PHASE_INTERVAL_MS = 2200;

/** 프론트 보조: 백엔드가 최종 기간·액션을 판단합니다. */
function parseTripDuration(text) {
  const nightsDaysMatch = text.match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (nightsDaysMatch) {
    const nights = Number(nightsDaysMatch[1]);
    const days = Number(nightsDaysMatch[2]);
    if (Number.isFinite(nights) && Number.isFinite(days) && days >= 1) {
      return {
        nights,
        days,
        maxLocations: getMaxLocationsByDuration(days),
        itemsPerDay: TRIP_ITEMS_PER_DAY_DEFAULT,
      };
    }
  }

  const nightsOnlyMatch = text.match(/(\d+)\s*박/);
  if (nightsOnlyMatch) {
    const nights = Number(nightsOnlyMatch[1]);
    const days = nights + 1;
    if (Number.isFinite(nights) && days >= 1) {
      return {
        nights,
        days,
        maxLocations: getMaxLocationsByDuration(days),
        itemsPerDay: TRIP_ITEMS_PER_DAY_DEFAULT,
      };
    }
  }

  const daysOnlyMatch = text.match(/(\d+)\s*일/);
  if (daysOnlyMatch) {
    const days = Number(daysOnlyMatch[1]);
    const nights = Math.max(0, days - 1);
    if (Number.isFinite(days) && days >= 1) {
      return {
        nights,
        days,
        maxLocations: getMaxLocationsByDuration(days),
        itemsPerDay: TRIP_ITEMS_PER_DAY_DEFAULT,
      };
    }
  }

  return null;
}

/** 비교·갤러리·지도 + '방금/저 공원' 등 맥락 후속 */
function isTripVisualRequest(text) {
  const t = String(text || '');
  if (/비교|vs\b|VS\b|차이|대비/.test(t)) {
    return true;
  }
  if (/사진|이미지|갤러리|보고\s*싶/.test(t)) {
    return true;
  }
  if (
    /(지도|마커|맵|위치)/.test(t) &&
    /(보여|표시|띄워|알려|찍|볼|줄래|까|펼쳐|확인|열어)/.test(t)
  ) {
    return true;
  }
  if (
    /(저|그거|그\s|방금|아까|직전|위에|아까\s*말한|방금\s*보여|방금\s*추천)/.test(t) &&
    /(비교|vs)/.test(t)
  ) {
    return true;
  }
  return false;
}

function hasAssistantNumberedPlaceContext(history) {
  return (history || []).some(
    m =>
      m.role === 'assistant' &&
      m.text &&
      /\d+\.\s*[^\n]{2,}/.test(m.text),
  );
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

const HELP_TEXT = `말씀하신 뜻을 읽고 일정을 맞춰 드려요. 예시만 참고하세요.

• 지역·기간·분위기로 추천·일정 만들기
• 장소 이름 없이도 "절은 빼고 카페 위주", "2일차만 여유롭게"처럼 조정
• 특정 장소만 빼기·바꾸기 ("○○ 말고 △△")
• 코스 전체를 다시 짜고 싶을 때는 그렇게 말씀해 주세요

비교·사진 갤러리도 채팅으로 요청할 수 있어요.`;

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

const ACTION_LABEL_MAP = {
  comparePlaces: '비교 보기',
  showMap: '지도 보기',
  showImageGallery: '사진 갤러리',
};

const VISUAL_TITLE_MAP = {
  comparePlaces: '장소 비교',
  showMap: '일정 지도',
  showImageGallery: '이미지 갤러리',
};

/**
 * TripChatPanel — 의도·추천·일정은 /api/chat/trip(백엔드)이 담당합니다.
 * 프론트는 응답의 recommendedRegionIds·schedule·detectedAction만 로드맵에 반영합니다.
 * 비교 UI는 /api/visual + ComparisonModal.
 */
const INITIAL_MESSAGE = {
  role: 'assistant',
  text: '어떤 여행을 계획하고 계신가요? 예: "서울 1일 카페 여행", "부산 2박 3일"',
};

function buildRecentMessagesPayload(messages) {
  return (messages || [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .filter(m => m.text && m.text !== INITIAL_MESSAGE.text)
    .slice(-8)
    .map(m => ({
      role: m.role,
      text: String(m.text).slice(0, 800),
    }));
}

function TripChatPanelInner({
  onTripLocationsChange,
  onTripLocationsReplaceAll,
  onReplaceLocation,
  onRemoveLocation,
  resolveRegionName,
  onComparePlaceSelect,
  currentLocations = [],
  tripDuration: tripDurationProp = null,
  onTripMetaChange,
  onResetRef,
}) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhaseIndex, setLoadingPhaseIndex] = useState(0);
  const [tripDuration, setTripDuration] = useState(tripDurationProp);
  const [lastAction, setLastAction] = useState(null);
  const [visualPopup, setVisualPopup] = useState(null);
  const messagesContainerRef = useRef(null);
  const suppressRoadmapEchoRef = useRef(false);
  const manualEditEchoRef = useRef(false);
  const chatAbortRef = useRef(null);

  useEffect(() => {
    if (onResetRef) {
      onResetRef.current = () => {
        setMessages([INITIAL_MESSAGE]);
        setTripDuration(null);
        setLastAction(null);
        setVisualPopup(null);
        onTripMetaChange?.({ duration: null, lastAction: null });
      };
    }
  }, [onResetRef, onTripMetaChange]);

  useEffect(() => {
    setTripDuration(tripDurationProp);
  }, [tripDurationProp]);

  useEffect(() => {
    if (!isLoading) {
      setLoadingPhaseIndex(0);
      return undefined;
    }
    const timer = setInterval(() => {
      setLoadingPhaseIndex(i => (i + 1) % TRIP_LOADING_PHASES.length);
    }, LOADING_PHASE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isLoading]);

  function publishMeta(duration, action) {
    if (duration) {
      setTripDuration(duration);
    }
    if (action) {
      setLastAction(action);
    }
    onTripMetaChange?.({
      duration: duration || tripDuration,
      lastAction: action || lastAction,
    });
  }

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

  // 로드맵에서 직접 삭제·이동할 때만 짧은 안내 (API 응답과 중복 방지)
  const prevCountRef = useRef(currentLocations.length);
  useEffect(() => {
    if (suppressRoadmapEchoRef.current) {
      suppressRoadmapEchoRef.current = false;
      prevCountRef.current = currentLocations.length;
      return;
    }
    if (!manualEditEchoRef.current) {
      prevCountRef.current = currentLocations.length;
      return;
    }
    manualEditEchoRef.current = false;
    const prev = prevCountRef.current;
    const curr = currentLocations.length;
    if (curr < prev) {
      setMessages(prevMsgs => [
        ...prevMsgs,
        {
          role: 'assistant',
          text:
            curr === 0
              ? '로드맵에서 모든 장소를 제거했어요.'
              : '로드맵에서 장소를 제거했어요. 순서·시간은 다시 맞춰 두었어요.',
        },
      ]);
    }
    prevCountRef.current = curr;
  }, [currentLocations.length]);

  async function sendMessage(trimmed) {
    if (!trimmed || isLoading) {
      return;
    }

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

    const parsedFromMessage = parseTripDuration(trimmed);
    const durationForRequest = parsedFromMessage ?? tripDuration;
    if (parsedFromMessage) {
      setTripDuration(parsedFromMessage);
      onTripMetaChange?.({ duration: parsedFromMessage });
    }

    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    setIsLoading(true);
    try {
      const chatHistoryForTrip = [...messages, { role: 'user', text: trimmed }];
      const response = await fetch(`${API_BASE_URL}/api/chat/trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          tripDuration: durationForRequest
            ? { nights: durationForRequest.nights, days: durationForRequest.days }
            : null,
          currentLocationIds: currentLocations.map(loc => loc.id),
          currentSchedule: buildCurrentSchedulePayload(currentLocations),
          recentMessages: buildRecentMessagesPayload(chatHistoryForTrip),
        }),
      });

      if (!response.ok) throw new Error('chat api error');
      const data = await response.json();

      // 기간 감지 시 상태 업데이트
      const activeDuration = data?.detectedDuration || tripDuration;
      if (activeDuration) {
        publishMeta(activeDuration, data?.detectedAction);
      } else if (data?.detectedAction) {
        publishMeta(null, data.detectedAction);
      }

      const action = data?.detectedAction;

      // unsupported: 지원하지 않는 요청
      if (action === 'unsupported') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: String(data?.answer || '').trim() },
        ]);
        return;
      }

      // refine / replan: 일정 전체 반영 (테마·제외 조정 포함)
      if (action === 'refine' || action === 'replan') {
        if (Array.isArray(data?.recommendedRegionIds) && data.recommendedRegionIds.length > 0) {
          const cap = activeDuration?.maxLocations ?? data.recommendedRegionIds.length;
          suppressRoadmapEchoRef.current = true;
          onTripLocationsReplaceAll?.(
            data.recommendedRegionIds.slice(0, cap),
            data.schedule ?? null,
          );
          const answer =
            String(data?.answer || '').trim() ||
            (action === 'refine' ? '일정을 조정했어요.' : '일정을 새로 구성했어요.');
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: answer,
              action,
            },
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
        if (
          Array.isArray(data?.recommendedRegionIds) &&
          data.recommendedRegionIds.length > 0
        ) {
          const cap = activeDuration?.maxLocations ?? data.recommendedRegionIds.length;
          suppressRoadmapEchoRef.current = true;
          onTripLocationsReplaceAll?.(
            data.recommendedRegionIds.slice(0, cap),
            data.schedule ?? null,
          );
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: String(data?.answer || '').trim() || '일정을 조정했어요.',
              action: 'refine',
            },
          ]);
          return;
        }
        if (!targetId || !currentRoadmapIds.has(targetId)) {
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text:
                String(data?.answer || '').trim() ||
                '그 장소는 일정에 없어요. 「절 빼고 카페·식당 넣어줘」처럼 말씀해 주시면 일정 전체를 조정할게요.',
            },
          ]);
        } else {
          manualEditEchoRef.current = true;
          onRemoveLocation?.(targetId);
          setMessages(prev => [
            ...prev,
            { role: 'assistant', text: '요청하신 장소를 일정에서 제거했어요.' },
          ]);
        }
        return;
      }

      // replace: 장소 교체
      if (action === 'replace') {
        if (
          !data?.excludedLocationId &&
          Array.isArray(data?.recommendedRegionIds) &&
          data.recommendedRegionIds.length > 0
        ) {
          const cap = activeDuration?.maxLocations ?? data.recommendedRegionIds.length;
          suppressRoadmapEchoRef.current = true;
          onTripLocationsReplaceAll?.(
            data.recommendedRegionIds.slice(0, cap),
            data.schedule ?? null,
          );
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: String(data?.answer || '').trim() || '일정을 조정했어요.',
              action: 'refine',
            },
          ]);
          return;
        }
        if (!data?.excludedLocationId) {
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text:
                String(data?.answer || '').trim() ||
                '바꿀 장소 이름을 일정에서 찾지 못했어요. 「○○ 말고 △△」처럼 적어 주시거나, 「절 빼고 카페 넣어줘」처럼 말씀해 주세요.',
            },
          ]);
          return;
        }
        const oldId = data.excludedLocationId;
        const newId = data?.recommendedRegionIds?.[0];
        const currentRoadmapIds = new Set(currentLocations.map(loc => loc.id));
        if (!currentRoadmapIds.has(oldId)) {
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text:
                String(data?.answer || '').trim() ||
                '일정에 없는 장소예요. 로드맵에 있는 이름으로 다시 말씀해 주세요.',
            },
          ]);
        } else if (newId && newId !== oldId) {
          suppressRoadmapEchoRef.current = true;
          onReplaceLocation?.(oldId, newId, data.schedule ?? null);
          const answerText = String(data?.answer || '').trim();
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text: answerText || '장소를 교체했어요. 순서·시간을 다시 맞춰 두었어요.',
            },
          ]);
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
          suppressRoadmapEchoRef.current = true;
          onTripLocationsChange?.(idsForApply, {
            maxLocations,
            schedule: data.schedule ?? null,
          });
          const answerText = String(data?.answer || '').trim();
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              text:
                answerText ||
                `${idsForApply.length}곳을 로드맵에 반영했어요.`,
              action: action || 'recommend',
            },
          ]);
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
      {
        let answerText = String(data?.answer || '').trim() || '응답을 받지 못했어요.';
        if (
          currentLocations.length === 0 &&
          /이미\s*설정|일정이\s*이미|일정이\s*있/.test(answerText)
        ) {
          answerText =
            '아직 로드맵에 담긴 장소가 없어요. 기간만 잡힌 상태일 수 있어요. 같은 조건으로 "제주 2박3일 해변 위주로 추천해줘"처럼 다시 말씀해 주세요.';
        } else if (currentLocations.length === 0 && activeDuration) {
          answerText =
            answerText === '응답을 받지 못했어요.'
              ? `${activeDuration.nights}박 ${activeDuration.days}일 조건은 받았는데, 아직 추천 장소를 못 담았어요. 지역 데이터 범위를 확인하거나 다시 추천을 요청해 주세요.`
              : `${answerText}\n\n(로드맵은 아직 비어 있어요. 장소가 안 보이면 한 번 더 추천을 요청해 주세요.)`;
        }
        setMessages(prev => [...prev, { role: 'assistant', text: answerText }]);
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: '요청을 취소했어요.' },
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: '챗봇 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
        ]);
      }
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
      }
      setIsLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) {
      return;
    }

    flushSync(() => {
      setMessages(prev => [...prev, { role: 'user', text: trimmed }]);
      setInput('');
    });
    await sendMessage(trimmed);
  }

  function handleCancelLoading() {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setIsLoading(false);
  }

  return (
    <section className="trip-chat-panel">
      <div className="trip-chat-title-wrap">
        <h2 className="trip-chat-title">로드맵 편집 챗봇</h2>
        <div className="trip-chat-help-btn">
          ?
          <div className="trip-chat-help-tooltip">{HELP_TEXT}</div>
        </div>
      </div>

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
              ACTION_LABEL_MAP[message.componentType] && (
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
            className="trip-chat-message assistant trip-chat-loading"
            initial={{ opacity: 0, x: -100, y: 20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{
              duration: 0.3,
              ease: 'easeOut',
              delay: LOADING_INDICATOR_DELAY,
            }}
          >
            <p className="trip-chat-loading-text">
              {TRIP_LOADING_PHASES[loadingPhaseIndex]}
            </p>
            <p className="trip-chat-loading-hint">
              첫 요청은 AI·검색 준비로 30초~2분 걸릴 수 있어요.
            </p>
            <button
              type="button"
              className="trip-chat-cancel-btn"
              onClick={handleCancelLoading}
            >
              요청 취소
            </button>
            <div className="trip-chat-loading-dots">
              <span className="chatbot-skeleton-dot" />
              <span className="chatbot-skeleton-dot" />
              <span className="chatbot-skeleton-dot" />
            </div>
          </motion.div>
        )}
      </div>

      {visualPopup?.componentType === 'comparePlaces' ? (
        <ComparisonModal
          items={visualPopup.uiData?.items ?? []}
          comparisonSummary={visualPopup.uiData?.comparisonSummary ?? ''}
          matrixRows={visualPopup.uiData?.matrixRows ?? []}
          onClose={() => setVisualPopup(null)}
          onSelectPlace={
            onComparePlaceSelect
              ? item => {
                  if (item?.id != null) {
                    onComparePlaceSelect(item.id);
                    setVisualPopup(null);
                  }
                }
              : undefined
          }
        />
      ) : null}
      {visualPopup?.componentType === 'showMap' ||
      visualPopup?.componentType === 'showImageGallery' ? (
        <TripVisualModal
          componentType={visualPopup.componentType}
          uiData={visualPopup.uiData}
          title={VISUAL_TITLE_MAP[visualPopup.componentType] ?? '시각화'}
          onClose={() => setVisualPopup(null)}
          onMarkerSelect={
            onComparePlaceSelect
              ? loc => {
                  if (loc?.id != null) {
                    onComparePlaceSelect(loc.id);
                    setVisualPopup(null);
                  }
                }
              : undefined
          }
        />
      ) : null}

      {/* Input form */}
      <form className="trip-chat-form" onSubmit={handleSubmit}>
        <input
          className="trip-chat-input"
          type="text"
          placeholder={
            tripDuration
              ? '자유롭게 말씀해 주세요 (예: 2일차만 맛집 위주, 절 빼고 여유롭게)'
              : '예: 부산 2박 3일, 친구랑 맛집·카페 위주'
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
