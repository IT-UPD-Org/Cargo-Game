import { sendApi } from './send-api.js';

export const cargoPlayer = {};
(() => {
  const form = document.getElementById('playerForm');
  const input = document.getElementById('username');
  const status = document.getElementById('playerStatus');
  const start = document.getElementById('ovBtn');
  let player = null;
  let pendingUsername = null;
  let needsNameCorrection = false;
  const nameButton = document.getElementById('playerName');
  const codePanel = document.getElementById('playerCode');
  function updateProfile() {
    document.getElementById('bestScore').textContent = player?.highestScore || 0;
    document.getElementById('playCount').textContent = player?.playCount || 0;
    nameButton.hidden = !player;
    codePanel.hidden = !player;
    nameButton.textContent = player?.username || '';
    codePanel.textContent = `Điểm cao nhất: ${player?.highestScore || 0}`;
  }
  const ranking = document.getElementById('leaderboardList');
  const rankingStatus = document.getElementById('leaderboardStatus');
  const refresh = document.getElementById('refreshLeaderboard');
  async function loadLeaderboard() {
    refresh.disabled = true;
    rankingStatus.textContent = 'Đang tải…';
    try {
      const result = await api('/api/leaderboard');
      ranking.replaceChildren();
      for (const entry of result.players) {
        const row = document.createElement('li');
        if (entry.isYou) row.classList.add('is-you');
        const rank = document.createElement('span');
        rank.textContent = `#${entry.rank}`;
        const name = document.createElement('span');
        name.textContent = entry.username + (entry.isYou ? ' (Bạn)' : '');
        const playCount = document.createElement('small');
        playCount.style.display = 'block';
        playCount.textContent = `${entry.playCount} lần chơi`;
        name.append(playCount);
        const score = document.createElement('strong');
        score.textContent = entry.highestScore.toLocaleString('vi-VN');
        row.append(rank, name, score);
        ranking.append(row);
      }
      rankingStatus.textContent = result.players.length ? '' : 'Chưa có người chơi. Hãy là người đầu tiên!';
    } catch (_) {
      rankingStatus.textContent = 'Không thể tải bảng xếp hạng. Nhấn Làm mới để thử lại.';
    } finally { refresh.disabled = false; }
  }
  refresh.addEventListener('click', loadLeaderboard);
  void loadLeaderboard();
  async function api(url, data) {
    return sendApi(url, data);
  }
  function display(p) {
    player = p; form.hidden = true; start.hidden = false; start.disabled = false;
    updateProfile();
    status.textContent = p.firstPlayCode ? `Mã của bạn: ${p.firstPlayCode}` : '';
    void loadLeaderboard();
  }
  start.disabled = true;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const button = form.querySelector('button'); button.disabled = true;
    status.textContent = '';
    try {
      const username = input.value.trim();
      if (!/^[\p{L}\p{N}_ .-]{2,24}$/u.test(username)) throw new Error('Tên cần 2–24 ký tự hợp lệ.');
      status.textContent = 'Đang kiểm tra tên…';
      await api('/api/player', { username, check: true });
      status.textContent = '';
      pendingUsername = username;
      form.hidden = true;
      start.hidden = false;
      start.disabled = false;
      if (needsNameCorrection) needsNameCorrection = false;
      start.click();
    }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  Object.defineProperties(cargoPlayer, Object.getOwnPropertyDescriptors({
    get firstPlayCode() { return player?.firstPlayCode; },
    get firstPlayScore() { return player?.firstPlayScore; },
    get highestScore() { return player?.highestScore; },
    get playCount() { return player?.playCount; },
    get ready() { return !!player || !!pendingUsername; },
    async save(scores, playId) {
      if (!player && pendingUsername) {
        try {
          const registered = await api('/api/player', { username: pendingUsername });
          player = registered.player;
          pendingUsername = null;
        } catch (error) {
          needsNameCorrection = true;
          form.hidden = false;
          throw error;
        }
      }
      const result = await api('/api/score', { scores, playId });
      player = result.player;
      player.playCount = result.playCount;
      updateProfile();
      void loadLeaderboard();
      return result.score;
    }
  }));
  api('/api/player', {}).then(({ player }) => {
    if (player) display(player);
    else { form.hidden = false; start.hidden = true; status.textContent = 'Nhập tên để bắt đầu chơi.'; }
  }).catch(error => { form.hidden = false; start.hidden = true; status.textContent = error.message; });
})();
