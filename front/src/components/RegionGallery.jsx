const CARD_IMAGE_FALLBACK = "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80";

export default function RegionGallery({ regions, onSelect }) {
  return (
    <section className="gallery-scroll-area">
      <div className="region-grid">
        {regions.map((region) => (
          <article key={region.id} className="region-card">
            <button className="region-preview" type="button" onClick={() => onSelect(region)}>
              <img
                src={region.imageUrl}
                alt={region.name}
                className="region-image"
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.src = CARD_IMAGE_FALLBACK;
                }}
              />
            </button>
            <div className="region-meta">
              <span className="region-name">{region.name}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
