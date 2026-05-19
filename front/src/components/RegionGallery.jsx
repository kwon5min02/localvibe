import { useState } from "react";
import { resolveBackendMediaUrl } from "../utils/apiMediaUrl";

const CARD_IMAGE_FALLBACK = "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80";
const SUMMARY_FALLBACK = '광주·전남 추천 스팟 정보를 확인해보세요.';

export default function RegionGallery({ regions, onSelect, scrappedIds = [], onToggleScrap, onAddToTrip }) {
  const [justScrapped, setJustScrapped] = useState(null);

  const normalizeSummary = (summary) => {
    const text = String(summary || '').trim();
    if (!text) return SUMMARY_FALLBACK;
    return text.length > 44 ? `${text.slice(0, 44)}...` : text;
  };

  const inferThemeTag = (region) => {
    const text = `${region?.name || ''} ${region?.summary || ''}`;
    if (/카페|커피|브런치|디저트/.test(text)) return '카페';
    if (/맛집|식당|음식|국밥|고기/.test(text)) return '맛집';
    if (/해변|바다|섬|해수욕/.test(text)) return '해변';
    if (/산|등산|트레킹|숲|공원/.test(text)) return '자연';
    if (/박물관|전시|갤러리|역사/.test(text)) return '문화';
    return '관광';
  };

  const inferRegionTag = (region) => {
    const regionText = String(region?.region || '').trim();
    if (regionText) return regionText;
    const provinceText = String(region?.province || '').trim();
    if (provinceText) return provinceText;
    const address = String(region?.address || '').trim();
    if (address) return address.split(/\s+/)[0] || '지역';
    return '지역';
  };

  const handleToggleScrap = (e, regionId) => {
    e.stopPropagation();
    setJustScrapped(regionId);
    setTimeout(() => setJustScrapped(null), 400);
    onToggleScrap?.(regionId);
  };

  const handleAddToTrip = (e, region) => {
    e.stopPropagation();
    onAddToTrip?.(region);
  };

  return (
    <section className="gallery-scroll-area">
      <div className="region-grid">
        {regions.map((region) => {
          const isScrapped = scrappedIds.includes(region.id);
          const isJustScrapped = justScrapped === region.id;
          return (
            <article key={region.id} className="region-card">
              <div
                className="region-preview"
                role="button"
                tabIndex={0}
                onClick={() => onSelect(region)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(region); } }}
              >
                <button
                  type="button"
                  className={`card-heart-btn${isScrapped ? ' active' : ''}${isJustScrapped ? ' just-popped' : ''}`}
                  onClick={(e) => handleToggleScrap(e, region.id)}
                  aria-label={isScrapped ? "스크랩 해제" : "스크랩"}
                >
                  {isScrapped ? '♥' : '♡'}
                </button>

                <img
                  src={resolveBackendMediaUrl(region.imageUrl) || CARD_IMAGE_FALLBACK}
                  alt={region.name}
                  className="region-image"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = CARD_IMAGE_FALLBACK; }}
                />

                <div className="region-overlay">
                  <span className="region-overlay-name">{region.name}</span>
                  <p className="region-overlay-summary">{normalizeSummary(region.summary)}</p>
                  <div className="region-overlay-footer">
                    <div className="region-overlay-tags">
                      <span className="region-overlay-tag">{inferThemeTag(region)}</span>
                      <span className="region-overlay-tag">{inferRegionTag(region)}</span>
                    </div>
                    <button
                      type="button"
                      className="card-add-btn"
                      aria-label="여행에 담기"
                      onClick={(e) => handleAddToTrip(e, region)}
                      title="여행에 담기"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
