import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { resolveBackendMediaUrl } from '../../utils/apiMediaUrl';

export default function ImageGallery({ images = [] }) {
  const [lightbox, setLightbox] = useState(null);

  if (!images.length) {
    return <p className="ui-empty">이미지를 찾을 수 없어요.</p>;
  }

  return (
    <>
      <div className="image-gallery">
        {images.map((img, i) => (
          <motion.div
            key={img.id ?? i}
            className="gallery-item"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => setLightbox(img)}
          >
            <img
              src={resolveBackendMediaUrl(img.imageUrl)}
              alt={img.name}
              className="gallery-img"
              onError={e => { e.target.closest('.gallery-item').style.display = 'none'; }}
            />
            <div className="gallery-caption">
              <span>{img.name}</span>
              {img.caption && <span className="gallery-sub">{img.caption}</span>}
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="lightbox-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              className="lightbox-content"
              initial={{ scale: 0.85 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.85 }}
              onClick={e => e.stopPropagation()}
            >
              <img src={resolveBackendMediaUrl(lightbox.imageUrl)} alt={lightbox.name} />
              <p className="lightbox-name">{lightbox.name}</p>
              {lightbox.caption && <p className="lightbox-caption">{lightbox.caption}</p>}
              <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
