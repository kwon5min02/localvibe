/** 마이페이지 여행에 장소 담기 / 플래너 일정 저장 시 공통 선택 모달 */
export default function TripSelectModal({
  title = '어떤 여행에 담을까요?',
  myTrips = [],
  onSelect,
  onCreateNew,
  onClose,
}) {
  return (
    <div className="trip-select-backdrop" onClick={onClose} role="presentation">
      <div
        className="trip-select-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="trip-select-header">
          <h2 className="trip-select-title">{title}</h2>
          <button type="button" className="trip-select-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="trip-select-body">
          {myTrips.length === 0 ? (
            <p className="trip-select-empty">아직 만든 여행이 없어요.</p>
          ) : (
            myTrips.map(trip => (
              <button
                key={trip.id}
                type="button"
                className="trip-select-item"
                onClick={() => onSelect(trip.id)}
              >
                <div style={{ textAlign: 'left' }}>
                  <div className="trip-select-item-name">{trip.name}</div>
                  <div className="trip-select-item-count">
                    {trip.places?.length ?? 0}개 장소 ·{' '}
                    {new Date(trip.createdAt).toLocaleDateString('ko-KR')}
                  </div>
                </div>
                <span style={{ fontSize: 16, color: '#ccc' }}>›</span>
              </button>
            ))
          )}
        </div>
        <div className="trip-select-footer">
          <button type="button" className="trip-select-new-btn" onClick={onCreateNew}>
            + 새 여행 만들고 저장
          </button>
        </div>
      </div>
    </div>
  );
}
