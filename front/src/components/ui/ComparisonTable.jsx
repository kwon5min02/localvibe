import { motion } from 'framer-motion';
import { resolveBackendMediaUrl } from '../../utils/apiMediaUrl';

export default function ComparisonTable({ items = [] }) {
  if (!items.length) {
    return <p className="ui-empty">비교할 장소 정보를 찾을 수 없어요.</p>;
  }

  return (
    <div className="comparison-table">
      {items.map((item, i) => (
        <motion.div
          key={item.id ?? i}
          className="comparison-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
        >
          {resolveBackendMediaUrl(item.imageUrl) && (
            <img
              src={resolveBackendMediaUrl(item.imageUrl)}
              alt={item.name}
              className="comparison-card-img"
              onError={e => { e.target.style.display = 'none'; }}
            />
          )}
          <div className="comparison-card-body">
            <h4 className="comparison-card-name">{item.name}</h4>
            {item.summary && (
              <p className="comparison-card-summary">{item.summary}</p>
            )}
            {item.attributes?.length > 0 && (
              <ul className="comparison-card-attrs">
                {item.attributes
                  .filter(a => a.value)
                  .map(attr => (
                    <li key={attr.label}>
                      <span className="attr-label">{attr.label}</span>
                      <span className="attr-value">{attr.value}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
