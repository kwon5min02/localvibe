/** 장소 비교 속성 표 (행=항목, 열=장소) */

export default function ComparisonAttributeMatrix({ items = [], matrixRows = [] }) {
  if (!items.length) {
    return <p className="ui-empty">비교할 장소 정보를 찾을 수 없어요.</p>;
  }

  const rows =
    matrixRows.length > 0
      ? matrixRows
      : buildFallbackRows(items);

  if (!rows.length) {
    return null;
  }

  return (
    <div className="comparison-matrix-wrap">
      <table className="comparison-matrix">
        <thead>
          <tr>
            <th scope="col" className="comparison-matrix-corner">
              항목
            </th>
            {items.map((item, i) => (
              <th key={item.id ?? i} scope="col" className="comparison-matrix-place-col">
                {item.name || `장소 ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.label}>
              <th scope="row" className="comparison-matrix-row-label">
                {row.label}
              </th>
              {(row.values || []).map((val, i) => (
                <td key={`${row.label}-${i}`} className="comparison-matrix-cell">
                  {val && val !== '—' ? val : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildFallbackRows(items) {
  const labels = ['지역', '추천 업종', '혼잡 시간대', '예상 고객층'];
  return labels
    .map(label => {
      const values = items.map(item => {
        const hit = (item.attributes || []).find(a => a.label === label);
        return hit?.value?.trim() || '—';
      });
      if (values.every(v => !v || v === '—')) {
        return null;
      }
      return { label, values };
    })
    .filter(Boolean);
}
