import KakaoMap from "./KakaoMap";

function normalizeInsightValues(values = []) {
  const seen = new Set();
  const normalized = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) {
      continue;
    }
    if (value === "정보를 제공 받을 수 없습니다.") {
      continue;
    }
    // Drop bare numeric artifacts like "2"
    if (/^\d+$/.test(value)) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function buildFallbackValues(title, region) {
  const place = String(region?.name || "").trim();
  if (title === "추천 업종") {
    return ["로컬 관광", "식음료", "체험형 방문"];
  }
  if (title === "혼잡 시간대") {
    return ["주말 13:00-17:00", "공휴일 오후"];
  }
  const targets = ["로컬 여행객", "당일 방문객"];
  if (place) {
    targets.unshift(`${place} 관심 방문객`);
  }
  return targets;
}

function toCardItems(region) {
  const base = [
    {
      title: "추천 업종",
      values: Array.isArray(region.recommendedBusinesses) && region.recommendedBusinesses.length > 0
        ? region.recommendedBusinesses
        : [],
    },
    {
      title: "혼잡 시간대",
      values: Array.isArray(region.busyHours) && region.busyHours.length > 0 ? region.busyHours : [],
    },
    {
      title: "예상 고객층",
      values: Array.isArray(region.targetCustomers) && region.targetCustomers.length > 0
        ? region.targetCustomers
        : [],
    },
  ];

  return base.map((card) => {
    const cleaned = normalizeInsightValues(card.values);
    return {
      ...card,
      values: cleaned.length > 0 ? cleaned.slice(0, 4) : buildFallbackValues(card.title, region),
    };
  });
}

const MODAL_IMAGE_FALLBACK = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80";

function resolveMediaUrl(url, apiBaseUrl) {
  const u = String(url || "").trim();
  if (!u) {
    return "";
  }
  if (u.startsWith("http://") || u.startsWith("https://")) {
    return u;
  }
  const base = String(apiBaseUrl || "").replace(/\/$/, "");
  if (u.startsWith("/") && base) {
    return `${base}${u}`;
  }
  return u;
}

export default function RegionModal({
  region,
  isLoading,
  onClose,
  apiBaseUrl = "",
  crawlImageUrls = [],
  article = null,
  articleLoading = false,
}) {
  if (!region) {
    return null;
  }

  const cards = toCardItems(region);
  const shortSummary = region.summaryShort || region.summary || "정보를 제공 받을 수 없습니다.";
  const longSummary = region.summary || "";
  const showOriginal = longSummary && shortSummary && longSummary !== shortSummary;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article className="modal-content" role="dialog" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose}>
          닫기
        </button>
        <img
          src={region.imageUrl || MODAL_IMAGE_FALLBACK}
          alt={region.name}
          className="modal-image"
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = MODAL_IMAGE_FALLBACK;
          }}
        />
        <h2>{region.name}</h2>
        <p>{shortSummary}</p>
        {showOriginal && (
          <details className="modal-summary-details">
            <summary>원문 보기</summary>
            <p>{longSummary}</p>
          </details>
        )}
        {region.dataSource && <p className="modal-source">출처: {region.dataSource}</p>}
        <KakaoMap address={region.address} latitude={region.latitude} longitude={region.longitude} />
        {isLoading && <p className="modal-loading">상세·인사이트 데이터를 불러오는 중...</p>}
        {crawlImageUrls.length > 0 && (
          <section className="modal-crawl-section" aria-label="크롤링 이미지">
            <h3 className="modal-section-title">블로그에서 모은 사진</h3>
            <div className="modal-crawl-gallery">
              {crawlImageUrls.map((u) => (
                <a
                  key={u}
                  className="modal-crawl-thumb-wrap"
                  href={resolveMediaUrl(u, apiBaseUrl)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={resolveMediaUrl(u, apiBaseUrl)}
                    alt=""
                    className="modal-crawl-thumb"
                  />
                </a>
              ))}
            </div>
          </section>
        )}
        {(articleLoading || (article && (article.title || article.content))) && (
          <section className="modal-article-section" aria-label="AI 아티클">
            <h3 className="modal-section-title">AI 아티클</h3>
            {articleLoading && <p className="modal-loading">크롤링 및 아티클 생성 중입니다… (최대 1~2분)</p>}
            {!articleLoading && article && (
              <>
                {article.title ? <h4 className="modal-article-title">{article.title}</h4> : null}
                <div className="modal-article-body">{article.content || ""}</div>
              </>
            )}
          </section>
        )}
        <section className="insight-grid">
          {cards.map((card) => (
            <article key={card.title} className="insight-card">
              <h3>{card.title}</h3>
              <ul>
                {card.values.map((value) => (
                  <li key={value} className="insight-pill">{value}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      </article>
    </div>
  );
}
