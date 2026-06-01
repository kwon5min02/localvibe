import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import ComparisonAttributeMatrix from './ui/ComparisonTable';
import { resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import { CARD_PLACEHOLDER_SVG } from '../utils/placeholderImage';

function ComparisonPlaceCard({ item, index, onSelect }) {
  const imageSrc =
    resolveBackendMediaUrl(item.imageUrl) || CARD_PLACEHOLDER_SVG;
  const regionLabel =
    item.attributes?.find(a => a.label === '지역')?.value || '';

  return (
    <motion.article
      className="comparison-modal-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35, ease: 'easeOut' }}
    >
      <button
        type="button"
        className="comparison-modal-card-hit"
        onClick={() => onSelect?.(item)}
        disabled={!onSelect}
      >
        <div className="comparison-modal-card-hero">
          <img
            src={imageSrc}
            alt={item.name || '장소'}
            className="comparison-modal-card-img"
            onError={e => {
              e.currentTarget.src = CARD_PLACEHOLDER_SVG;
            }}
          />
          <div className="comparison-modal-card-hero-overlay">
            <h3 className="comparison-modal-card-name">{item.name}</h3>
            {regionLabel ? (
              <p className="comparison-modal-card-region">{regionLabel}</p>
            ) : null}
          </div>
        </div>

        <div className="comparison-modal-card-body">
          {item.summary ? (
            <p className="comparison-modal-card-summary">{item.summary}</p>
          ) : null}
          {item.address ? (
            <p className="comparison-modal-card-address">{item.address}</p>
          ) : null}
          {item.attributes?.length > 0 ? (
            <dl className="comparison-modal-attrs">
              {item.attributes
                .filter(a => a.value && a.label !== '지역')
                .map(attr => (
                  <div key={attr.label} className="comparison-modal-attr-row">
                    <dt>{attr.label}</dt>
                    <dd>{attr.value}</dd>
                  </div>
                ))}
            </dl>
          ) : null}
        </div>
      </button>
      {onSelect ? (
        <p className="comparison-modal-card-hint">카드를 누르면 상세 보기</p>
      ) : null}
    </motion.article>
  );
}

export default function ComparisonModal({
  items = [],
  comparisonSummary = '',
  matrixRows = [],
  onClose,
  onSelectPlace,
}) {
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const title =
    items.length >= 2
      ? `${items[0]?.name || '장소 A'} vs ${items[1]?.name || '장소 B'}`
      : items[0]?.name || '장소 비교';

  return createPortal(
    <div
      className="comparison-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="comparison-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comparison-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <header className="comparison-modal-header">
          <button
            type="button"
            className="comparison-modal-back"
            onClick={onClose}
            aria-label="닫기"
          >
            ←
          </button>
          <div className="comparison-modal-header-text">
            <h2 id="comparison-modal-title" className="comparison-modal-title">
              장소 비교
            </h2>
            <p className="comparison-modal-subtitle">{title}</p>
          </div>
          <button
            type="button"
            className="comparison-modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </header>

        <div className="comparison-modal-body">
          {!items.length ? (
            <p className="comparison-modal-empty">
              비교할 장소 정보를 찾을 수 없어요.
            </p>
          ) : (
            <>
              {comparisonSummary ? (
                <div className="comparison-modal-summary" role="note">
                  <span className="comparison-modal-summary-label">AI 한눈에</span>
                  <p>{comparisonSummary}</p>
                </div>
              ) : null}
              <ComparisonAttributeMatrix items={items} matrixRows={matrixRows} />
            <div
              className={`comparison-modal-grid comparison-modal-grid--${Math.min(items.length, 3)}`}
            >
              {items.map((item, i) => (
                <ComparisonPlaceCard
                  key={item.id ?? i}
                  item={item}
                  index={i}
                  onSelect={onSelectPlace}
                />
              ))}
              {items.length === 2 ? (
                <span className="comparison-modal-vs" aria-hidden="true">
                  VS
                </span>
              ) : null}
            </div>
            </>
          )}
        </div>

        <footer className="comparison-modal-footer">
          <p>채팅에서 다른 장소도 vs로 비교해 볼 수 있어요.</p>
          <button type="button" className="comparison-modal-done" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
