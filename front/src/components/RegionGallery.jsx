const CARD_IMAGE_FALLBACK = "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80";
const SUMMARY_FALLBACK = '광주·전남 추천 스팟 정보를 확인해보세요.';

export default function RegionGallery({ regions, onSelect, scrappedIds = [], onToggleScrap }) {
  const normalizeSummary = (summary) => {
    const text = String(summary || '').trim();
    if (!text) {
      return SUMMARY_FALLBACK;
    }
    return text.length > 42 ? `${text.slice(0, 42)}...` : text;
  };

  const inferThemeTag = (region) => {
    const text = `${region?.name || ''} ${region?.summary || ''}`;
    if (/카페|커피|브런치/.test(text)) return '카페';
    if (/맛집|식당|음식|국밥|고기/.test(text)) return '맛집';
    if (/해변|바다|섬|해수욕/.test(text)) return '해변';
    return '관광명소';
  };

  const inferRegionTag = (region) => {
    const regionText = String(region?.region || '').trim();
    if (regionText) {
      return regionText;
    }
    const provinceText = String(region?.province || '').trim();
    if (provinceText) {
      return provinceText;
    }
    const address = String(region?.address || '').trim();
    if (address) {
      const firstToken = address.split(/\s+/)[0];
      if (firstToken) {
        return firstToken;
      }
    }
    return '지역정보';
  };

  return (
    <section className="gallery-scroll-area">
      <div className="region-grid">
        {regions.map((region) => (
          <article key={region.id} className="region-card">
            <div
              className="region-preview"
              role="button"
              tabIndex={0}
              onClick={() => onSelect(region)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(region);
                }
              }}
            >
              <button
                type="button"
                className={`card-heart-btn ${scrappedIds.includes(region.id) ? 'active' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleScrap?.(region.id);
                }}
                aria-label="스크랩 토글"
              >
                {scrappedIds.includes(region.id) ? '♥' : '♡'}
              </button>
              <img
                src={region.imageUrl}
                alt={region.name}
                className="region-image"
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = CARD_IMAGE_FALLBACK;
                }}
              />
              <div className="region-overlay">
                <span className="region-overlay-name">{region.name}</span>
                <p className="region-overlay-summary">
                  {normalizeSummary(region.summary)}
                </p>
                <div className="region-overlay-footer">
                  <div className="region-overlay-tags">
                    <span className="region-overlay-tag">🏛 {inferThemeTag(region)}</span>
                    <span className="region-overlay-tag">{inferRegionTag(region)}</span>
                  </div>
                  <span className="card-add-btn" aria-hidden="true">
                    +
                  </span>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
