import { useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * Timeline Roadmap
 * Vertical timeline with marker dots and rectangular image cards.
 */

const FALLBACK_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='300'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%23e8ebf7'/%3E%3Cstop offset='100%25' stop-color='%23cdd6f2'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23g)'/%3E%3Ctext x='50%25' y='52%25' dominant-baseline='middle' text-anchor='middle' fill='%235468a3' font-family='Arial' font-size='28'%3ELocalVibe%3C/text%3E%3C/svg%3E";

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: index => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: index * 0.05,
      duration: 0.35,
      ease: 'easeOut',
    },
  }),
};

const wrapV = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const ITEMS_PER_DAY = 5;

export default function RoadMap({
  locations = [],
  onNodeClick,
  selectedId = null,
}) {
  const nodes = useMemo(() => {
    return locations.map((loc, index) => ({
      index,
      id: loc?.id != null ? String(loc.id) : String(index),
      clickId: loc?.id != null ? loc.id : index,
      name: loc?.name ?? `Location ${index + 1}`,
      description:
        loc?.summary ?? loc?.description ?? '지역 정보가 준비 중입니다.',
      imageUrl: loc?.imageUrl || FALLBACK_IMAGE,
    }));
  }, [locations]);

  const daySections = useMemo(() => {
    const sections = [];

    nodes.forEach((node, index) => {
      const dayNumber = Math.floor(index / ITEMS_PER_DAY) + 1;
      let section = sections.find(item => item.dayNumber === dayNumber);

      if (!section) {
        section = { dayNumber, items: [] };
        sections.push(section);
      }

      section.items.push({
        ...node,
        renderIndex: index,
      });
    });

    return sections;
  }, [nodes]);

  return (
    <div className="sroadmap-container sroadmap-timeline">
      <motion.div
        className="sroadmap-timeline-list"
        initial="hidden"
        animate="visible"
        variants={wrapV}
      >
        {daySections.map(section => (
          <section
            key={`day-${section.dayNumber}`}
            className="sroadmap-day-section"
          >
            <h3 className="sroadmap-day-header">{section.dayNumber}일차</h3>

            {section.items.map(node => {
              const isSelected =
                selectedId != null &&
                (selectedId === node.clickId ||
                  String(selectedId) === String(node.clickId));

              return (
                <motion.article
                  key={node.id}
                  className={`sroadmap-item ${isSelected ? 'selected' : ''}`}
                  custom={node.renderIndex}
                  variants={itemVariants}
                >
                  <div className="sroadmap-marker" aria-hidden>
                    <span className="sroadmap-dot" />
                  </div>

                  <button
                    className="sroadmap-image-trigger"
                    type="button"
                    aria-label={`${node.name} 상세 보기`}
                    onClick={() => onNodeClick?.(node.clickId)}
                  >
                    <div className="sroadmap-thumb-wrap">
                      <img
                        className="sroadmap-thumb"
                        src={node.imageUrl}
                        alt={node.name}
                        loading="lazy"
                        onError={event => {
                          event.currentTarget.src = FALLBACK_IMAGE;
                        }}
                      />
                    </div>
                  </button>

                  <div className="sroadmap-body">
                    <h4 className="sroadmap-title">{node.name}</h4>
                    <p className="sroadmap-description">{node.description}</p>
                  </div>
                </motion.article>
              );
            })}
          </section>
        ))}
      </motion.div>
    </div>
  );
}
