function toCardItems(region) {
  const noInfo = ["정보를 제공 받을 수 없습니다."];
  return [
    {
      title: "추천 업종",
      values: Array.isArray(region.recommendedBusinesses) && region.recommendedBusinesses.length > 0
        ? region.recommendedBusinesses
        : noInfo,
    },
    {
      title: "혼잡 시간대",
      values: Array.isArray(region.busyHours) && region.busyHours.length > 0 ? region.busyHours : noInfo,
    },
    {
      title: "예상 고객층",
      values: Array.isArray(region.targetCustomers) && region.targetCustomers.length > 0
        ? region.targetCustomers
        : noInfo,
    },
  ];
}

const MODAL_IMAGE_FALLBACK = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80";

export default function RegionModal({ region, isLoading, onClose }) {
  if (!region) {
    return null;
  }

  const cards = toCardItems(region);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article className="modal-content" role="dialog" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose}>
          닫기
        </button>
        <img
          src={region.imageUrl}
          alt={region.name}
          className="modal-image"
          onError={(event) => {
            event.currentTarget.src = MODAL_IMAGE_FALLBACK;
          }}
        />
        <h2>{region.name}</h2>
        <p>{region.summary || "정보를 제공 받을 수 없습니다."}</p>
        {region.dataSource && <p className="modal-source">출처: {region.dataSource}</p>}
        {isLoading && <p className="modal-loading">상세 데이터를 불러오는 중...</p>}
        <section className="insight-grid">
          {cards.map((card) => (
            <article key={card.title} className="insight-card">
              <h3>{card.title}</h3>
              <ul>
                {card.values.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      </article>
    </div>
  );
}
