import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import ImageGallery from './ui/ImageGallery';
import MultiMarkerMap from './ui/MultiMarkerMap';

export default function TripVisualModal({
  componentType,
  uiData = null,
  title = '시각화',
  onClose,
  onMarkerSelect,
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

  const locations = uiData?.locations ?? [];
  const images = uiData?.images ?? [];

  return createPortal(
    <div
      className="trip-visual-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="trip-visual-modal-dialog"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <header className="trip-visual-modal-header">
          <h2 className="trip-visual-modal-title">{title}</h2>
          <button
            type="button"
            className="trip-visual-modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </header>
        <div className="trip-visual-modal-body">
          {componentType === 'showMap' ? (
            <>
              <p className="trip-visual-modal-hint">
                로드맵에 담긴 장소 위치예요. 확정 동선이 아니라 참고용입니다.
              </p>
              <MultiMarkerMap
                locations={locations}
                onMarkerSelect={onMarkerSelect}
              />
            </>
          ) : null}
          {componentType === 'showImageGallery' ? (
            <ImageGallery images={images} />
          ) : null}
        </div>
        <footer className="trip-visual-modal-footer">
          <button type="button" className="trip-visual-modal-done" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
