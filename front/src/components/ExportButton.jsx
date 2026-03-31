import html2canvas from 'html2canvas';

/**
 * ExportButton Component
 * Provides PNG (image) export functionality
 *
 * Props:
 *   - roadmapLocations: Array of location objects to export
 *   - onExportStart: Optional callback when export begins
 *   - onExportEnd: Optional callback when export completes
 */
export default function ExportButton({
  roadmapLocations = [],
  onExportStart,
  onExportEnd,
}) {
  // Export roadmap as PNG image
  const handleExportPNG = async () => {
    if (roadmapLocations.length === 0) {
      alert('Cannot export empty roadmap. Please add locations first.');
      return;
    }

    onExportStart?.();
    try {
      // Get the SVG container
      const roadmapElement = document.getElementById('roadmap-container');
      if (!roadmapElement) {
        alert('Could not find roadmap container');
        return;
      }

      // Capture as canvas with high quality
      const canvas = await html2canvas(roadmapElement, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        allowTaint: true,
      });

      // Convert to image and download
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `trip-roadmap-${new Date().getTime()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('PNG export failed:', error);
      alert('Failed to export PNG. Please try again.');
    } finally {
      onExportEnd?.();
    }
  };

  const isDisabled = roadmapLocations.length === 0;

  return (
    <div className="export-button-group">
      <button
        className="export-btn export-png-btn"
        onClick={handleExportPNG}
        disabled={isDisabled}
        title={
          isDisabled
            ? 'Add locations to your roadmap first'
            : 'Export roadmap as PNG image'
        }
      >
        📸 Export PNG
      </button>
    </div>
  );
}
