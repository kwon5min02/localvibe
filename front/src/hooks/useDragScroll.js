import { useRef } from "react";

export function useDragScroll() {
  const dragStateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0
  });

  const onMouseDown = (event) => {
    const node = event.currentTarget;
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: node.scrollLeft,
      scrollTop: node.scrollTop
    };
  };

  const onMouseMove = (event) => {
    if (!dragStateRef.current.active) {
      return;
    }

    const node = event.currentTarget;
    const moveX = event.clientX - dragStateRef.current.startX;
    const moveY = event.clientY - dragStateRef.current.startY;

    node.scrollLeft = dragStateRef.current.scrollLeft - moveX;
    node.scrollTop = dragStateRef.current.scrollTop - moveY;
  };

  const onMouseUp = () => {
    dragStateRef.current.active = false;
  };

  return {
    onMouseDown,
    onMouseMove,
    onMouseUp
  };
}
