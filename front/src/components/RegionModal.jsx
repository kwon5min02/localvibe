import KakaoMap from "./KakaoMap";

function normalizeInsightValues(values = []) {
  const seen = new Set();
  return values.reduce((acc, raw) => {
    const v = String(raw || "").trim();
    if (!v || v === "정보를 제공 받을 수 없습니다." || /^\d+$/.test(v) || seen.has(v)) return acc;
    seen.add(v); acc.push(v); return acc;
  }, []);
}

function buildFallbackValues(title, region) {
  const place = String(region?.name || "").trim();
  if (title === "추천 업종") return ["로컬 관광", "식음료", "체험형 방문"];
  if (title === "혼잡 시간대") return ["주말 13:00-17:00", "공휴일 오후"];
  return place ? [`${place} 관심 방문객`, "로컬 여행객"] : ["로컬 여행객", "당일 방문객"];
}

function toCardItems(region) {
  return [
    { title: "추천 업종", values: region.recommendedBusinesses || [] },
    { title: "혼잡 시간대", values: region.busyHours || [] },
    { title: "예상 고객층", values: region.targetCustomers || [] },
  ].map(card => {
    const cleaned = normalizeInsightValues(card.values);
    return { ...card, values: cleaned.length > 0 ? cleaned.slice(0, 4) : buildFallbackValues(card.title, region) };
  });
}

const FALLBACK_IMG = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80";

function resolveMediaUrl(url, apiBaseUrl) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = String(apiBaseUrl || "").replace(/\/$/, "");
  return u.startsWith("/") && base ? `${base}${u}` : u;
}

export default function RegionModal({
  region, isLoading, onClose, apiBaseUrl = "",
  crawlImageUrls = [], article = null, articleLoading = false,
  scrappedIds = [], onToggleScrap, onAddToTrip,
}) {
  if (!region) return null;

  const cards = toCardItems(region);
  const isScrapped = scrappedIds.includes(region.id);
  const shortSummary = region.summaryShort || region.summary || "정보를 제공 받을 수 없습니다.";
  const longSummary = region.summary || "";
  const showOriginal = longSummary && shortSummary && longSummary !== shortSummary;
  const allTags = cards.flatMap(c => c.values).slice(0, 8);

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 2000,
      }}
      role="presentation"
      onClick={onClose}
    >
      <article
        style={{
          position: 'relative',
          width: 'min(640px, 96vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: 16,
          zIndex: 2001,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
        }}
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        {/* X 닫기 — 우측 상단 */}
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          style={{
            position: 'absolute', top: 12, right: 12,
            width: 30, height: 30, borderRadius: '50%',
            border: 'none', background: 'rgba(0,0,0,0.45)',
            color: '#fff', fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10, lineHeight: 1,
          }}
        >✕</button>

        {/* 히어로 이미지 */}
        <div style={{ position: 'relative', width: '100%', height: 260, flexShrink: 0, overflow: 'hidden', borderRadius: '16px 16px 0 0' }}>
          <img
            src={region.imageUrl || FALLBACK_IMG}
            alt={region.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_IMG; }}
          />
          {/* 이미지 하단 오버레이 */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 55%, transparent 100%)',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
            padding: '20px 22px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {region.region && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600, background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)' }}>
                  📍 {region.region}
                </span>
              )}
              {region.dataSource && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>{region.dataSource}</span>
              )}
            </div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.2, letterSpacing: '-0.2px', textShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>
              {region.name}
            </h2>
          </div>
        </div>

        {/* 본문 */}
        <div style={{ padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 액션 버튼 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => onToggleScrap?.(region.id)}
              style={{
                height: 36, padding: '0 16px', borderRadius: 8,
                border: isScrapped ? '1px solid #e05b6f' : '1px solid #e5e5e5',
                background: isScrapped ? '#fff5f6' : '#fff',
                color: isScrapped ? '#e05b6f' : '#555',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 150ms',
              }}
            >
              {isScrapped ? '♥ 스크랩됨' : '♡ 스크랩'}
            </button>
            <button
              type="button"
              onClick={() => onAddToTrip?.(region)}
              style={{
                height: 36, padding: '0 16px', borderRadius: 8,
                border: 'none', background: '#111', color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 150ms',
              }}
            >
              + 여행에 담기
            </button>
          </div>

          {/* 주소 */}
          {region.address && (
            <p style={{ margin: 0, fontSize: 12, color: '#888' }}>📍 {region.address}</p>
          )}

          {/* 요약 — 잡지 스타일 */}
          <div style={{ borderLeft: '3px solid #111', paddingLeft: 14 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: '#444' }}>{shortSummary}</p>
            {showOriginal && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', color: '#666', fontWeight: 600, fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3 }}>전문 보기</summary>
                <p style={{ margin: '8px 0 0', lineHeight: 1.7, fontSize: 13, color: '#555' }}>{longSummary}</p>
              </details>
            )}
          </div>

          {/* 출처 */}
          {region.dataSource && (
            <p style={{ margin: 0, fontSize: 11, color: '#bbb' }}>출처: {region.dataSource}</p>
          )}

          {/* 태그 가로 스크롤 */}
          {allTags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
              {allTags.map(tag => (
                <span key={tag} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, border: '1px solid #e5e5e5', background: '#f8f8f8', color: '#555', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 인사이트 섹션 제목 */}
          <div>
            <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.8px', borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
              장소 인사이트
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
              {cards.map(card => (
                <article key={card.title} style={{ border: '1px solid #eee', borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
                  <h4 style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{card.title}</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {card.values.map(v => (
                      <span key={v} style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999, border: '1px solid #eee', background: '#f8f8f8', color: '#555', fontSize: 11, fontWeight: 500 }}>{v}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>

          {/* 위치 지도 */}
          <div>
            <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.8px', borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>위치</h3>
            <KakaoMap address={region.address} latitude={region.latitude} longitude={region.longitude} />
          </div>

          {isLoading && <p style={{ margin: 0, color: '#888', fontSize: 13 }}>상세 데이터를 불러오는 중...</p>}

          {/* 크롤링 이미지 */}
          {crawlImageUrls.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.8px', borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>블로그 사진</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {crawlImageUrls.map(u => (
                  <a key={u} href={resolveMediaUrl(u, apiBaseUrl)} target="_blank" rel="noreferrer" style={{ display: 'block', width: 88, height: 66, borderRadius: 7, overflow: 'hidden', border: '1px solid #eee' }}>
                    <img src={resolveMediaUrl(u, apiBaseUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* AI 아티클 */}
          {(articleLoading || (article && (article.title || article.content))) && (
            <div>
              <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.8px', borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>AI 아티클</h3>
              {articleLoading && <p style={{ margin: 0, color: '#aaa', fontSize: 13 }}>크롤링 및 아티클 생성 중… (최대 1~2분)</p>}
              {!articleLoading && article && (
                <>
                  {article.title && <h4 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#111' }}>{article.title}</h4>}
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.85, fontSize: 13, color: '#555', padding: '14px 16px', background: '#f8f8f8', borderRadius: 8, border: '1px solid #eee', fontFamily: 'Georgia, serif' }}>
                    {article.content || ""}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
