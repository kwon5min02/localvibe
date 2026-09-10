import { useEffect, useState, useRef } from 'react';
import KakaoMap from './KakaoMap';
import LineIcon from './ui/LineIcon';
import { resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import { buildArticleDisplayData } from '../utils/articleBlocks';
import { recordPlaceView } from '../features/places/placesApi';
import { fetchPosts } from '../features/community/communityApi';
import { timeAgo } from '../utils/timeAgo';

/** 장소 상세에 미리 보여줄 커뮤니티 글 수. 소개 글이 주인공이라 짧게 둔다. */
const COMMUNITY_PREVIEW_MAX = 3;

/* ── 인사이트 정규화 ── */
function normalizeInsightValues(values = []) {
  const seen = new Set();
  return values.reduce((acc, raw) => {
    const v = String(raw || '').trim();
    if (
      !v ||
      v === '정보를 제공 받을 수 없습니다.' ||
      /^\d+$/.test(v) ||
      seen.has(v)
    )
      return acc;
    seen.add(v);
    acc.push(v);
    return acc;
  }, []);
}

function buildFallbackValues(title, region) {
  const place = String(region?.name || '').trim();
  if (title === '추천 업종') return ['로컬 관광', '식음료', '체험형 방문'];
  if (title === '혼잡 시간대') return ['주말 13:00-17:00', '공휴일 오후'];
  return place
    ? [`${place} 관심 방문객`, '로컬 여행객']
    : ['로컬 여행객', '당일 방문객'];
}

function toCardItems(region) {
  return [
    { title: '추천 업종', values: region.recommendedBusinesses || [] },
    { title: '혼잡 시간대', values: region.busyHours || [] },
    { title: '예상 고객층', values: region.targetCustomers || [] },
  ].map(card => {
    const cleaned = normalizeInsightValues(card.values);
    return {
      ...card,
      values:
        cleaned.length > 0
          ? cleaned.slice(0, 4)
          : buildFallbackValues(card.title, region),
    };
  });
}

/* ── 하드코딩 아티클 (백엔드 연동 전) ── */
function generateArticle(region) {
  const name = region?.name || '이 장소';
  const regionName = region?.region || region?.province || '이 지역';
  const summary = region?.summary || '';
  return {
    title: `${name}`,
    author: 'LocalVibe 에디터',
    date: new Date().toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    body: [
      {
        type: 'lead',
        text: `${regionName}에서 진짜 로컬을 만나고 싶다면, 관광지도를 잠시 접어두자. ${name}은 그런 곳이다. 화려한 간판도, SNS 인증샷 명소도 아니지만, 한 번 발걸음을 들인 사람은 꼭 다시 찾게 되는 장소.`,
      },
      {
        type: 'subheader',
        text: '지역이 품은 이야기',
      },
      {
        type: 'paragraph',
        text: `${regionName}은 최근 몇 년 사이 조용한 변화를 겪고 있다. 젊은 로컬 창업자들이 하나둘 골목에 둥지를 틀기 시작했고, 오래된 가게들 사이에 새로운 공간이 들어서며 독특한 레이어가 생겨났다. ${name}도 그 흐름 속에서 탄생한 공간이다.`,
      },
      {
        type: 'paragraph',
        text:
          summary ||
          `처음에는 동네 주민들의 단골 장소로 알려졌다. 특별한 마케팅도 없었고, 리뷰를 부탁하는 일도 없었다. 그저 꾸준하게, 자기만의 방식으로 자리를 지켰다. 입소문은 자연스럽게 퍼졌고, 이제는 이 지역을 여행하는 사람들이 꼭 한 번 들르는 곳이 됐다.`,
      },
      {
        type: 'subheader',
        text: '공간이 주는 감각',
      },
      {
        type: 'paragraph',
        text: `${name}에 들어서면 어딘가 서두르지 않아도 된다는 느낌이 든다. 공간은 사람을 밀어내지 않는다. 창밖으로 보이는 ${regionName}의 골목, 테이블 위의 작은 소품들, 잔잔하게 깔린 음악까지 — 모든 것이 그 자리에 있어야 할 이유를 갖고 있다.`,
      },
      {
        type: 'quote',
        text: `"처음 왔을 때 그냥 지나칠 뻔했어요. 간판이 너무 작아서요. 근데 이제는 ${regionName} 오면 꼭 들르는 곳이 됐어요."`,
        attribution: '— 방문객 후기',
      },
      {
        type: 'subheader',
        text: '방문 전 알아두면 좋은 것',
      },
      {
        type: 'paragraph',
        text: `주말 오후는 사람이 몰린다. 여유롭게 즐기고 싶다면 평일 오전이나 저녁 시간대를 노리는 게 좋다. 대중교통 접근성도 나쁘지 않지만, 걸어서 주변 골목을 함께 둘러보는 걸 추천한다. ${regionName}의 진짜 매력은 지도 바깥에 있으니까.`,
      },
      {
        type: 'paragraph',
        text: `처음 방문이라면 이 공간이 제안하는 방식 그대로 따라가 보자. 두 번째 방문부터는 자기만의 루틴이 생긴다. 그게 로컬 스팟의 진짜 매력이다.`,
      },
    ],
  };
}

/* ── 이미지 캐러셀 ── */
function ImageCarousel({ images, fallback }) {
  const [current, setCurrent] = useState(0);
  const startX = useRef(null);
  const allImages = images.length > 0 ? images : [fallback];
  const total = allImages.length;

  const prev = () => setCurrent(c => (c - 1 + total) % total);
  const next = () => setCurrent(c => (c + 1) % total);

  const onTouchStart = e => {
    startX.current = e.touches[0].clientX;
  };
  const onTouchEnd = e => {
    if (startX.current === null) return;
    const diff = startX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) diff > 0 ? next() : prev();
    startX.current = null;
  };

  return (
    <div className="rm-carousel">
      {/* 이미지 */}
      <img
        src={allImages[current]}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          transition: 'opacity 0.3s ease',
        }}
        onError={e => {
          e.currentTarget.onerror = null;
          e.currentTarget.src = fallback;
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      />

      {/* 좌우 버튼 */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.35)',
              border: 'none',
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={next}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.35)',
              border: 'none',
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ›
          </button>
        </>
      )}

      {/* 인디케이터 */}
      {total > 1 && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 5,
          }}
        >
          {allImages.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrent(i)}
              style={{
                width: i === current ? 18 : 6,
                height: 6,
                borderRadius: 999,
                background: i === current ? '#fff' : 'rgba(255,255,255,0.45)',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                transition: 'width 200ms, background 200ms',
              }}
            />
          ))}
        </div>
      )}

      {/* 이미지 카운트 */}
      {total > 1 && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            background: 'rgba(0,0,0,0.4)',
            color: '#fff',
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            fontWeight: 600,
          }}
        >
          {current + 1} / {total}
        </div>
      )}
    </div>
  );
}

/* ── 아티클 렌더러 ── */
function ArticleBody({ blocks }) {
  return (
    <div style={{ fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
      {blocks.map((block, i) => {
        if (block.type === 'lead')
          return (
            <p
              key={i}
              style={{
                fontSize: 15,
                lineHeight: 1.9,
                color: '#222',
                fontWeight: 400,
                margin: '0 0 20px',
                borderLeft: '3px solid #111',
                paddingLeft: 14,
                fontStyle: 'normal',
              }}
            >
              {block.text}
            </p>
          );
        if (block.type === 'subheader')
          return (
            <h4
              key={i}
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#111',
                margin: '24px 0 10px',
                fontFamily: "'Pretendard', sans-serif",
                letterSpacing: '-0.2px',
              }}
            >
              {block.text}
            </h4>
          );
        if (block.type === 'paragraph')
          return (
            <p
              key={i}
              style={{
                fontSize: 14,
                lineHeight: 1.95,
                color: '#333',
                margin: '0 0 16px',
              }}
            >
              {block.text}
            </p>
          );
        if (block.type === 'quote')
          return (
            <blockquote
              key={i}
              style={{
                margin: '20px 0',
                padding: '14px 18px',
                background: '#f8f8f8',
                borderRadius: 8,
                borderLeft: 'none',
              }}
            >
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: '#444',
                  fontStyle: 'normal',
                  margin: '0 0 6px',
                }}
              >
                {block.text}
              </p>
              {block.attribution && (
                <cite
                  style={{ fontSize: 12, color: '#888', fontStyle: 'normal' }}
                >
                  {block.attribution}
                </cite>
              )}
            </blockquote>
          );
        return null;
      })}
    </div>
  );
}

/* ── 메인 모달 ── */
const FALLBACK_IMG =
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80';

export default function RegionModal({
  region,
  isLoading,
  onClose,
  apiBaseUrl = '',
  crawlImageUrls = [],
  article = null,
  articleLoading = false,
  scrappedIds = [],
  onToggleScrap,
  onAddToTrip,
  onGoCommunity,
}) {
  // Esc로 닫기 + 열려 있는 동안 뒤 배경 스크롤 잠금
  useEffect(() => {
    if (!region) return undefined;
    const onKeyDown = e => {
      if (e.key === 'Escape') onClose?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [region, onClose]);

  // 열람 기록 — '지금 많이 찾는 장소' 집계용. 같은 사람이 같은 날 여러 번 열어도
  // 서버가 하루 1회만 센다.
  const viewedId = region?.id;
  useEffect(() => {
    if (viewedId) recordPlaceView(viewedId);
  }, [viewedId]);

  // 이 장소에 달린 커뮤니티 글. 글쓰기에서 자동완성으로 고른 것만 잡힌다.
  const [placePosts, setPlacePosts] = useState([]);
  useEffect(() => {
    if (!viewedId) {
      setPlacePosts([]);
      return undefined;
    }
    let cancelled = false;
    fetchPosts({ placeId: viewedId, sort: 'new', limit: COMMUNITY_PREVIEW_MAX })
      .then(({ posts }) => {
        if (!cancelled) setPlacePosts(posts);
      })
      .catch(() => {
        // 소개 글이 주인공인 화면이라, 실패하면 이 구역만 조용히 접는다.
        if (!cancelled) setPlacePosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [viewedId]);

  if (!region) return null;

  const cards = toCardItems(region);
  const isScrapped = scrappedIds.includes(region.id);

  // 사진 크롤링을 하지 않으므로 이미지가 없는 장소가 많다.
  // 그럴 때는 빈 캐러셀 대신 아예 접어서 글이 먼저 보이게 한다.
  const allImages = [
    ...(region.imageUrl
      ? [resolveBackendMediaUrl(region.imageUrl, apiBaseUrl)]
      : []),
    ...crawlImageUrls.map(u => resolveBackendMediaUrl(u, apiBaseUrl)),
  ].filter(Boolean);

  const articleData = buildArticleDisplayData(article, region);
  const showPlacePosts = Boolean(onGoCommunity) && placePosts.length > 0;
  const hasSideContent =
    cards.length > 0 || region.address || region.latitude || showPlacePosts;

  return (
    <div className="rm-backdrop" role="presentation" onClick={onClose}>
      <article
        className="rm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rm-title"
        onClick={e => e.stopPropagation()}
      >
        {/* ── 상단 바 ── */}
        <div className="rm-bar">
          <button
            type="button"
            className="rm-close"
            onClick={onClose}
            aria-label="닫기"
          >
            <LineIcon name="close" className="" />
          </button>
          <div className="rm-bar-actions">
            <button
              type="button"
              className={`rm-heart${isScrapped ? ' active' : ''}`}
              onClick={() => onToggleScrap?.(region.id)}
              title={isScrapped ? '스크랩 해제' : '스크랩'}
            >
              {isScrapped ? '♥' : '♡'}
            </button>
            <button
              type="button"
              className="rm-add"
              onClick={() => onAddToTrip?.(region)}
            >
              + 담기
            </button>
          </div>
        </div>

        <div
          className="rm-body"
          style={
            hasSideContent ? undefined : { gridTemplateColumns: 'minmax(0,1fr)' }
          }
        >
          <div className="rm-main">
            <h1 className="rm-title" id="rm-title">
              {region.name}
            </h1>
            {articleData.title && articleData.title !== region.name && (
              <p className="rm-subtitle">{articleData.title}</p>
            )}
            <p className="rm-meta">
              {articleData.author}
              {region.region && <span> · {region.region}</span>}
            </p>

            {allImages.length > 0 && (
              <ImageCarousel images={allImages} fallback={FALLBACK_IMG} />
            )}

            {articleLoading ? (
              <div className="rm-loading">
                <div>AI 아티클 생성 중…</div>
                <div className="rm-loading-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : (
              <ArticleBody blocks={articleData.body} />
            )}

          </div>

          {hasSideContent && (
            <aside className="rm-side">
              {cards.length > 0 && (
                <section>
                  <h3 className="rm-section-title">장소 인사이트</h3>
                  <div className="rm-insight-list">
                    {cards.map(card => (
                      <div key={card.title} className="rm-insight">
                        <div className="rm-insight-title">{card.title}</div>
                        <div className="rm-tags">
                          {card.values.map(v => (
                            <span key={v} className="rm-tag">
                              {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 다녀온 사람들의 기록 — 글이 없으면 구역째 감춘다. 빈 목록이
                  사이드바 자리를 차지하게 두지 않는다.
                  onGoCommunity가 없는 곳(플래너)에서는 눌러도 갈 데가 없으므로 감춘다. */}
              {showPlacePosts && (
                <section className="rm-community">
                  <h3 className="rm-section-title">다녀온 사람들의 기록</h3>
                  <ul className="rm-community-list">
                    {placePosts.map(p => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="rm-community-item"
                          onClick={() => onGoCommunity?.(p.id)}
                        >
                          <span className="rm-community-title">{p.title}</span>
                          <span className="rm-community-meta">
                            {timeAgo(p.createdAt)}
                            <span className="rm-community-dot">·</span>
                            댓글 {p.comments}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="rm-community-more"
                    onClick={() => onGoCommunity?.(null, { q: region.name })}
                  >
                    커뮤니티에서 더 보기 →
                  </button>
                </section>
              )}

              <section>
                <h3 className="rm-section-title">위치</h3>
                <div className="rm-map">
                  <KakaoMap
                    address={region.address}
                    latitude={region.latitude}
                    longitude={region.longitude}
                  />
                </div>
                {region.address && (
                  <p className="rm-address">{region.address}</p>
                )}
              </section>
            </aside>
          )}
        </div>

        {isLoading && <div className="rm-badge">데이터 불러오는 중…</div>}
      </article>
    </div>
  );
}
