const form = document.getElementById('lookupForm');
const status = document.getElementById('lookupStatus');
const result = document.getElementById('lookupResult');
const historyBody = document.getElementById('historyBody');
const historyStatus = document.getElementById('historyStatus');
const chart = document.getElementById('scoreChart');
const chartStatus = document.getElementById('chartStatus');
const refreshStats = document.getElementById('refreshStats');
async function loadStats() {
  refreshStats.disabled = true;
  chartStatus.textContent = 'Đang tải thống kê…';
  try {
    const response = await fetch('/api/admin/stats');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không thể tải thống kê.');
    const leaderboard = document.getElementById('adminLeaderboardBody');
    leaderboard.replaceChildren();
    const ranked = data.points.slice().sort((a, b) => b.score - a.score || new Date(a.playedAt) - new Date(b.playedAt));
    ranked.forEach((player, index) => {
      const row = document.createElement('tr');
      for (const value of [index + 1, player.username, player.code || '—', player.score.toLocaleString('vi-VN'), player.playCount, new Date(player.playedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      leaderboard.append(row);
    });
    document.getElementById('adminLeaderboardStatus').textContent = ranked.length ? `${ranked.length} người chơi` : 'Chưa có người chơi hoàn thành.';
    chart.replaceChildren();
    const counts = new Map();
    for (const player of data.points) counts.set(player.score, (counts.get(player.score) || 0) + 1);
    if (!counts.has(0)) counts.set(0, 0);
    const distribution = [...counts].sort((a, b) => a[0] - b[0]).map(([score, count]) => ({ score, count }));
    const maximum = distribution.reduce((max, point) => Math.max(max, point.count), 1);
    const maxScore = Math.max(1, distribution.at(-1)?.score || 0);
    const svgNode = (tag, attributes, text) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const svg = svgNode('svg', { viewBox: '0 0 640 300', role: 'img', 'aria-label': 'Số người chơi theo điểm chính xác' });
    svg.append(svgNode('title', {}, 'Trục ngang: điểm. Trục dọc: số người chơi đạt điểm đó.'));
    const ceiling = Math.max(4, Math.ceil(maximum / 4) * 4);
    for (let i = 0; i <= 4; i++) {
      const y = 240 - i * 50;
      svg.append(svgNode('line', { x1: 48, x2: 604, y1: y, y2: y, stroke: '#637c80', 'stroke-opacity': '.4' }));
      svg.append(svgNode('text', { x: 38, y: y + 4, 'text-anchor': 'end', fill: '#dce4da', 'font-size': 12 }, i * ceiling / 4));
    }
    const points = distribution.map((point, i) => ({
      x: 48 + point.score / maxScore * 556,
      y: 240 - point.count / ceiling * 200, ...point, index: i
    }));
    if (points.length > 1) {
      let line = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        const previous = points[i - 1];
        const current = points[i];
        const middle = (previous.x + current.x) / 2;
        line += ` C ${middle} ${previous.y}, ${middle} ${current.y}, ${current.x} ${current.y}`;
      }
      svg.append(svgNode('path', { d: `${line} L ${points.at(-1).x} 240 L ${points[0].x} 240 Z`, fill: '#e7bd66', 'fill-opacity': '.1' }));
      svg.append(svgNode('path', { d: line, fill: 'none', stroke: '#e7bd66', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    }
    for (const p of points) {
      const dot = svgNode('circle', { cx: p.x, cy: p.y, r: 3, fill: '#e7bd66', stroke: '#fff', 'stroke-width': 1 });
      dot.append(svgNode('title', {}, `${p.score} điểm: ${p.count} người chơi`));
      svg.append(dot);
      if (points.length <= 12 || p.index % Math.ceil(points.length / 8) === 0) {
        svg.append(svgNode('text', { x: p.x, y: p.y - 12, 'text-anchor': 'middle', fill: '#ffcf4a', 'font-size': 13 }, p.count));
        svg.append(svgNode('text', { x: p.x, y: 262, 'text-anchor': 'middle', fill: '#dce4da', 'font-size': 11 }, p.score));
      }
    }
    svg.append(svgNode('text', { x: 48, y: 18, fill: '#dce4da', 'font-size': 12 }, 'Số người chơi'));
    svg.append(svgNode('text', { x: 320, y: 290, 'text-anchor': 'middle', fill: '#dce4da', 'font-size': 12 }, 'Điểm'));
    chart.append(svg);
    chartStatus.textContent = `${data.total} người chơi đã hoàn thành lần đầu`;
  } catch (error) { chartStatus.textContent = error.message; }
  finally { refreshStats.disabled = false; }
}
refreshStats.addEventListener('click', loadStats);
void loadStats();
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  result.replaceChildren();
  status.textContent = 'Đang tra cứu…';
  try {
    const response = await fetch('/api/admin/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
      code: document.getElementById('code').value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không thể tra cứu.');
    const { player } = data;
    historyBody.replaceChildren();
    historyStatus.textContent = `${player.username} · ${data.history.length} lần chơi`;
    data.history.forEach((play, index) => {
      const row = document.createElement('tr');
      for (const value of [data.history.length - index, new Date(play.playedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), play.score.toLocaleString('vi-VN')]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      historyBody.append(row);
    });
    for (const [label, value] of Object.entries({
      'Người chơi': player.username, 'Mã': player.firstPlayCode,
      'Điểm lần chơi đầu': player.firstPlayScore, 'Kỷ lục': player.highestScore,
      'Ngày chơi đầu': new Date(player.firstPlayedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      'Số lần chơi': player.playCount
    })) {
      const row = document.createElement('p');
      row.textContent = `${label}: ${value}`;
      result.append(row);
    }
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'big-btn admin-delete';
    deleteButton.textContent = 'Xóa người chơi';
    deleteButton.addEventListener('click', async () => {
      if (!confirm(`Xóa ${player.username} (mã ${player.firstPlayCode}) cùng toàn bộ điểm đã lưu?`)) return;
      deleteButton.disabled = true;
      try {
        const response = await fetch(`/api/admin/player/${encodeURIComponent(player.firstPlayCode)}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Không thể xóa người chơi.');
        result.replaceChildren();
        historyBody.replaceChildren();
        historyStatus.textContent = 'Tra cứu mã để xem các lần chơi và điểm.';
        status.textContent = `Đã xóa ${player.username}.`;
        await loadStats();
      } catch (error) {
        status.textContent = error.message;
        deleteButton.disabled = false;
      }
    });
    result.append(deleteButton);
    status.textContent = '';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
