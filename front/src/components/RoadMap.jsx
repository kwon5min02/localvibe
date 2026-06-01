import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { resolveBackendMediaUrl } from '../utils/apiMediaUrl';
import {
  displayOrderLabel,
  displayPeriod,
  formatDayPeriodSummary,
  groupDayItemsByPeriodBand,
  moveLocationToDay,
  moveLocationToIndex,
  shouldShowCardPeriod,
} from '../utils/tripSchedule';

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

const FALLBACK_ITEMS_PER_DAY = 6;

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="9" cy="7" r="1.5" fill="currentColor" />
      <circle cx="15" cy="7" r="1.5" fill="currentColor" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" />
      <circle cx="9" cy="17" r="1.5" fill="currentColor" />
      <circle cx="15" cy="17" r="1.5" fill="currentColor" />
    </svg>
  );
}

export default function RoadMap({
  locations = [],
  tripDayCount = 1,
  itemsPerDay = 6,
  onItineraryChange,
  onNodeClick,
  onRemoveNode,
  selectedId = null,
  isModalOpen = false,
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [dropHint, setDropHint] = useState(null);

  const nodes = useMemo(() => {
    return locations.map((loc, index) => ({
      index,
      id: loc?.id != null ? String(loc.id) : String(index),
      clickId: loc?.id != null ? loc.id : index,
      name: loc?.name ?? `장소 ${index + 1}`,
      description:
        loc?.summary ?? loc?.description ?? '지역 정보가 준비 중입니다.',
      imageUrl: resolveBackendMediaUrl(loc?.imageUrl) || FALLBACK_IMAGE,
      tripDay: loc?.tripDay ?? null,
      period: displayPeriod(loc),
    }));
  }, [locations]);

  const daySections = useMemo(() => {
    const hasScheduleDays = nodes.some(node => node.tripDay != null);
    const byDay = new Map();

    nodes.forEach((node, index) => {
      const dayNumber = hasScheduleDays
        ? Number(node.tripDay) || 1
        : Math.floor(index / FALLBACK_ITEMS_PER_DAY) + 1;
      if (!byDay.has(dayNumber)) {
        byDay.set(dayNumber, []);
      }
      byDay.get(dayNumber).push({
        ...node,
        renderIndex: index,
        orderInDay: byDay.get(dayNumber).length,
      });
    });

    const maxFromNodes = byDay.size
      ? Math.max(...byDay.keys())
      : 0;
    const totalDays = Math.max(
      1,
      Number(tripDayCount) || maxFromNodes || 1,
      maxFromNodes,
    );

    return Array.from({ length: totalDays }, (_, i) => {
      const dayNumber = i + 1;
      const items = byDay.get(dayNumber) || [];
      const rawLocs = items.map(it =>
        locations.find((l, idx) => idx === it.renderIndex),
      );
      return {
        dayNumber,
        items,
        isEmpty: items.length === 0,
        periodSummary: formatDayPeriodSummary(rawLocs.filter(Boolean)),
        showCardPeriod: shouldShowCardPeriod(items.length),
      };
    });
  }, [nodes, locations, tripDayCount]);

  const effectiveDays = Math.max(
    1,
    Number(tripDayCount) ||
      (daySections.length
        ? daySections[daySections.length - 1].dayNumber
        : 1),
  );

  function clearDrag() {
    setDragIndex(null);
    setDropHint(null);
  }

  function commitReorder(nextLocations) {
    onItineraryChange?.(nextLocations);
    clearDrag();
  }

  function handleDropOnDay(targetDay) {
    if (dragIndex == null || !onItineraryChange) {
      return;
    }
    commitReorder(
      moveLocationToDay(
        locations,
        dragIndex,
        targetDay,
        effectiveDays,
        itemsPerDay,
      ),
    );
  }

  function handleDropBeforeItem(toIndex) {
    if (dragIndex == null || !onItineraryChange) {
      return;
    }
    commitReorder(
      moveLocationToIndex(
        locations,
        dragIndex,
        toIndex,
        effectiveDays,
        itemsPerDay,
      ),
    );
  }

  const dragEnabled = Boolean(onItineraryChange);

  function renderPlaceCard(node, section, band) {
    const isSelected =
      selectedId != null &&
      (selectedId === node.clickId ||
        String(selectedId) === String(node.clickId));
    const isDragging = dragIndex === node.renderIndex;
    const itemDropActive =
      dropHint?.type === 'item' && dropHint.index === node.renderIndex;

    return (
      <motion.article
        key={`${node.id}-${node.renderIndex}`}
        id={`roadmap-place-${node.clickId}`}
        className={`sroadmap-item ${isSelected ? 'selected' : ''} ${
          isDragging ? 'sroadmap-item--dragging' : ''
        } ${itemDropActive ? 'sroadmap-item--drop-before' : ''}`}
        custom={node.renderIndex}
        variants={itemVariants}
        draggable={dragEnabled}
        onDragStart={
          dragEnabled
            ? event => {
                setDragIndex(node.renderIndex);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(
                  'text/plain',
                  String(node.renderIndex),
                );
              }
            : undefined
        }
        onDragEnd={dragEnabled ? clearDrag : undefined}
        onDragOver={
          dragEnabled
            ? event => {
                event.preventDefault();
                setDropHint({
                  type: 'item',
                  index: node.renderIndex,
                });
              }
            : undefined
        }
        onDrop={
          dragEnabled
            ? event => {
                event.preventDefault();
                event.stopPropagation();
                handleDropBeforeItem(node.renderIndex);
              }
            : undefined
        }
      >
        <div className="sroadmap-marker">
          {dragEnabled ? (
            <span
              className="sroadmap-drag-handle"
              aria-hidden="true"
              title="드래그하여 이동"
            >
              <DragHandleIcon />
            </span>
          ) : (
            <span className="sroadmap-dot" />
          )}
          <div
            className="sroadmap-marker-actions"
            aria-label={`${node.name} 관리`}
          >
            {onRemoveNode ? (
              <button
                className="sroadmap-remove-btn"
                type="button"
                aria-label={`${node.name} 제거`}
                onClick={event => {
                  event.stopPropagation();
                  event.currentTarget.blur();
                  onRemoveNode(node.clickId);
                }}
              >
                <DeleteIcon />
              </button>
            ) : null}
          </div>
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
              draggable={false}
              onError={event => {
                event.currentTarget.src = FALLBACK_IMAGE;
              }}
            />
          </div>
        </button>

        <div
          className="sroadmap-body"
          onClick={() => onNodeClick?.(node.clickId)}
          style={{ cursor: 'pointer' }}
        >
          <p className="sroadmap-time sroadmap-time--order">
            {displayOrderLabel(node.orderInDay)}
          </p>
          <h4 className="sroadmap-title">{node.name}</h4>
          <p className="sroadmap-description">{node.description}</p>
        </div>
      </motion.article>
    );
  }

  return (
    <div
      className={`sroadmap-container sroadmap-timeline ${
        isModalOpen ? 'modal-open' : ''
      }`}
    >
      <motion.div
        className="sroadmap-timeline-list"
        initial="hidden"
        animate="visible"
        variants={wrapV}
      >
        {daySections.map(section => {
          const dayDropActive =
            dropHint?.type === 'day' && dropHint.day === section.dayNumber;

          const periodBands = groupDayItemsByPeriodBand(section.items, locations);
          const bandByRenderIndex = new Map();
          periodBands.forEach(band => {
            band.items.forEach(node => {
              bandByRenderIndex.set(node.renderIndex, band);
            });
          });

          return (
            <section
              key={`day-${section.dayNumber}`}
              className={`sroadmap-day-section ${
                section.isEmpty ? 'sroadmap-day-section--empty' : ''
              } ${dayDropActive ? 'sroadmap-day-section--drop-target' : ''}`}
              onDragOver={
                dragEnabled
                  ? event => {
                      event.preventDefault();
                      setDropHint({ type: 'day', day: section.dayNumber });
                    }
                  : undefined
              }
              onDragLeave={
                dragEnabled
                  ? () => {
                      if (dropHint?.type === 'day' && dropHint.day === section.dayNumber) {
                        setDropHint(null);
                      }
                    }
                  : undefined
              }
              onDrop={
                dragEnabled
                  ? event => {
                      event.preventDefault();
                      handleDropOnDay(section.dayNumber);
                    }
                  : undefined
              }
            >
              <div className="sroadmap-day-header-wrap">
                <h3 className="sroadmap-day-header">
                  {section.dayNumber}일차
                  <span className="sroadmap-day-count">
                    {section.items.length > 0 ? `${section.items.length}곳` : '비어 있음'}
                  </span>
                </h3>
                {section.periodSummary ? (
                  <p className="sroadmap-day-period-summary">{section.periodSummary}</p>
                ) : null}
                {dragEnabled && dayDropActive ? (
                  <span className="sroadmap-day-drop-label">놓으면 이 날로 이동</span>
                ) : null}
                {section.isEmpty && dragEnabled ? (
                  <p className="sroadmap-day-empty-hint">카드를 여기로 끌어오세요</p>
                ) : null}
              </div>

              {(() => {
                let lastBandKey = null;
                return section.items.map(node => {
                  const band = bandByRenderIndex.get(node.renderIndex) || {
                    key: 'flex',
                    label: '순서',
                    hint: '',
                  };
                  const showBandHead = band.key !== lastBandKey;
                  lastBandKey = band.key;

                  return (
                    <div key={`flow-${node.renderIndex}`} className="sroadmap-item-flow">
                      {showBandHead ? (
                        <div
                          className={`sroadmap-period-band-head sroadmap-period-band-head--inline sroadmap-period-band-head--${band.key}`}
                        >
                          <span className="sroadmap-period-band-label">{band.label}</span>
                        </div>
                      ) : null}
                      {renderPlaceCard(node, section, band)}
                    </div>
                  );
                });
              })()}
            </section>
          );
        })}
      </motion.div>
    </div>
  );
}
