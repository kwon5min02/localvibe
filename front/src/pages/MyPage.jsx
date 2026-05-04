const CARD_IMAGE_FALLBACK =
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80';

export default function MyPage({ scrappedRegions = [], onToggleScrap, onOpenRegion }) {
  return (
    <section className="mypage-section">
      <h1 className="top-title">마이페이지</h1>
      <p className="gallery-subtitle">하트로 저장한 장소를 모아볼 수 있어요.</p>

      {scrappedRegions.length === 0 ? (
        <div className="mypage-empty">아직 저장한 장소가 없습니다.</div>
      ) : (
        <div className="region-grid">
          {scrappedRegions.map(region => (
            <article key={region.id} className="region-card">
              <div
                className="region-preview"
                role="button"
                tabIndex={0}
                onClick={() => onOpenRegion?.(region)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenRegion?.(region);
                  }
                }}
              >
                <button
                  type="button"
                  className="card-heart-btn active"
                  onClick={event => {
                    event.stopPropagation();
                    onToggleScrap?.(region.id);
                  }}
                  aria-label="스크랩 해제"
                >
                  ♥
                </button>
                <img
                  src={region.imageUrl}
                  alt={region.name}
                  className="region-image"
                  onError={event => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = CARD_IMAGE_FALLBACK;
                  }}
                />
                <div className="region-overlay">
                  <span className="region-overlay-name">{region.name}</span>
                  <p className="region-overlay-summary">
                    {String(region.summary || '').trim() || '요약 정보가 없습니다.'}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
