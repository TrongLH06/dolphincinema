/**
 * STARLIGHT CINEMA ROOM — Main Application Controller
 * File: d:\Agent\cinema-room\js\app.js
 * Chức năng:
 *  - Khởi tạo sơ đồ 21 ghế ngồi trong khán phòng (Hạng A Thường, Hạng B-C VIP, Hạng D Đôi Sweetbox)
 *  - Kết nối `window.CinemaSyncEngine` và `window.CinemaPlayerController`
 *  - Hiển thị bong bóng chat (.seat-speech-bubble) và biểu tượng cảm xúc (.seat-floating-emoji)
 *    bay lên trực tiếp ngay trên chiếc ghế của người gửi trong rạp
 *  - Xử lý chọn ghế, đổi tên/avatar, điều khiển Chủ rạp (Host), tắt đèn rạp và đóng/mở rèm nhung
 */

(function () {
  'use strict';

  const SEAT_ROWS = [
    { row: 'A', type: 'standard', seats: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] },
    { row: 'B', type: 'vip', seats: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'] },
    { row: 'C', type: 'vip', seats: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] },
    { row: 'D', type: 'sweetbox', seats: ['D1', 'D2', 'D3'] }
  ];

  // Lưu timer bong bóng thoại trên từng ghế để tự ẩn sau 5.5 giây
  const seatBubbleTimers = new Map();
  // Lưu các tin nhắn đã hiển thị trong khung chat để tránh trùng lặp
  const renderedMessageIds = new Set();

  let isDraggingSeek = false;

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const Sync = window.CinemaSyncEngine;
    const Player = window.CinemaPlayerController;

    // Tham chiếu các phần tử DOM
    const syncStatusBadge = document.getElementById('syncStatusBadge');
    const onlineCountEl = document.getElementById('onlineCount');
    const currentSeatBadge = document.getElementById('currentSeatBadge');

    const openProfileBtn = document.getElementById('openProfileBtn');
    const toggleHostPanelBtn = document.getElementById('toggleHostPanelBtn');
    const toggleLightsBtn = document.getElementById('toggleLightsBtn');
    const toggleCurtainBtn = document.getElementById('toggleCurtainBtn');

    const hostControlPanel = document.getElementById('hostControlPanel');
    const presetMediaSelect = document.getElementById('presetMediaSelect');
    const presetPills = document.querySelectorAll('.preset-pill');
    const mediaUrlInput = document.getElementById('mediaUrlInput');
    const mediaTitleInput = document.getElementById('mediaTitleInput');
    const loadMediaBtn = document.getElementById('loadMediaBtn');
    const localFileInput = document.getElementById('localFileInput');

    const hostPlayPauseBtn = document.getElementById('hostPlayPauseBtn');
    const hostRewindBtn = document.getElementById('hostRewindBtn');
    const hostForwardBtn = document.getElementById('hostForwardBtn');
    const soundToggleBtn = document.getElementById('soundToggleBtn');
    const hostSeekSlider = document.getElementById('hostSeekSlider');
    const mediaTimeLabel = document.getElementById('mediaTimeLabel');
    const volumeSlider = document.getElementById('volumeSlider');
    const forceSyncBtn = document.getElementById('forceSyncBtn');

    const cinemaViewport = document.getElementById('cinemaViewport');
    const curtainLeft = document.getElementById('curtainLeft');
    const curtainRight = document.getElementById('curtainRight');
    const screenReactionLayer = document.getElementById('screenReactionLayer');

    const seatingGrid = document.getElementById('seatingGrid');
    const reactionBtns = document.querySelectorAll('.reaction-btn');

    const audienceList = document.getElementById('audienceList');
    const chatMessages = document.getElementById('chatMessages');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');

    const profileModal = document.getElementById('profileModal');
    const nicknameInput = document.getElementById('nicknameInput');
    const avatarOptions = document.querySelectorAll('.avatar-option');
    const isHostCheckbox = document.getElementById('isHostCheckbox');
    const saveProfileBtn = document.getElementById('saveProfileBtn');

    // 1. Dựng cấu trúc ghế ngồi trong rạp (A1..A6, B1..B6, C1..C6, D1..D3)
    function buildInitialSeatingGrid() {
      if (!seatingGrid) return;
      seatingGrid.innerHTML = '';

      for (const rowDef of SEAT_ROWS) {
        const rowEl = document.createElement('div');
        rowEl.className = 'seat-row';
        rowEl.dataset.row = rowDef.row;

        const labelLeft = document.createElement('span');
        labelLeft.className = 'row-label';
        labelLeft.textContent = rowDef.row;
        rowEl.appendChild(labelLeft);

        for (const seatCode of rowDef.seats) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `seat-item ${rowDef.type === 'vip' ? 'vip' : ''} ${rowDef.type === 'sweetbox' ? 'sweetbox' : ''}`.trim();
          btn.dataset.seat = seatCode;
          btn.id = `seat-${seatCode}`;
          btn.setAttribute('aria-label', `Ghế ${seatCode}`);

          const avatarSpan = document.createElement('span');
          avatarSpan.className = 'seat-avatar';
          avatarSpan.textContent = rowDef.type === 'sweetbox' ? '🛋️' : '💺';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'seat-name';
          nameSpan.textContent = 'Ghế trống';

          const codeSpan = document.createElement('span');
          codeSpan.className = 'seat-code';
          codeSpan.textContent = seatCode;

          btn.appendChild(avatarSpan);
          btn.appendChild(nameSpan);
          btn.appendChild(codeSpan);

          btn.addEventListener('click', async () => {
            Player.playSfx('seat');
            const res = await Sync.selectSeat(seatCode);
            if (res && !res.ok && res.error) {
              appendSystemNotice(`⚠️ ${res.error}`);
            }
          });

          rowEl.appendChild(btn);
        }

        const labelRight = document.createElement('span');
        labelRight.className = 'row-label';
        labelRight.textContent = rowDef.row;
        rowEl.appendChild(labelRight);

        seatingGrid.appendChild(rowEl);
      }
    }

    buildInitialSeatingGrid();

    // 2. Khởi tạo Trình phát Media (Built-in Canvas + HTML5 Video + YouTube)
    Player.init({
      onTimeUpdate: (currentTime, duration) => {
        if (!isDraggingSeek && hostSeekSlider && duration > 0) {
          const pct = Math.min(100, Math.max(0, (currentTime / duration) * 100));
          hostSeekSlider.value = String(pct.toFixed(1));
        }
        if (mediaTimeLabel) {
          mediaTimeLabel.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        }
      }
    });

    // 3. Hiển thị bong bóng thoại ngay trên chiếc ghế trong rạp
    function showSeatSpeechBubble(seatId, text) {
      if (!seatId || !text) return;
      const seatBtn = document.getElementById(`seat-${seatId}`);
      if (!seatBtn) return;

      const oldBubble = seatBtn.querySelector('.seat-speech-bubble');
      if (oldBubble) oldBubble.remove();

      if (seatBubbleTimers.has(seatId)) {
        clearTimeout(seatBubbleTimers.get(seatId));
      }

      const bubble = document.createElement('div');
      bubble.className = 'seat-speech-bubble';
      bubble.textContent = text;
      seatBtn.appendChild(bubble);

      const timer = setTimeout(() => {
        bubble.remove();
        seatBubbleTimers.delete(seatId);
      }, 5500);
      seatBubbleTimers.set(seatId, timer);
    }

    // 4. Hiển thị Emoji bay lên từ ghế ngồi VÀ trên màn chiếu lớn
    function showReactionBurst({ seatId, emoji }) {
      const cleanEmoji = emoji || '❤️';

      // Bay lên từ ghế của người thả cảm xúc
      if (seatId) {
        const seatBtn = document.getElementById(`seat-${seatId}`);
        if (seatBtn) {
          const seatEmoji = document.createElement('span');
          seatEmoji.className = 'seat-floating-emoji';
          seatEmoji.textContent = cleanEmoji;
          seatBtn.appendChild(seatEmoji);
          setTimeout(() => seatEmoji.remove(), 1850);
        }
      }

      // Bay lên trên màn chiếu lớn
      if (screenReactionLayer) {
        const screenEmoji = document.createElement('span');
        screenEmoji.className = 'screen-floating-emoji';
        screenEmoji.textContent = cleanEmoji;
        const randomLeft = 10 + Math.random() * 80;
        screenEmoji.style.left = `${randomLeft.toFixed(1)}%`;
        screenReactionLayer.appendChild(screenEmoji);
        setTimeout(() => screenEmoji.remove(), 2800);
      }
    }

    // 5. Thêm một tin nhắn vào khung Chat trực tuyến (chống XSS 100% bằng textContent)
    function renderChatMessageItem(msg) {
      if (!msg || !chatMessages) return;
      if (msg.id && renderedMessageIds.has(msg.id)) return;
      if (msg.id) renderedMessageIds.add(msg.id);

      if (msg.isSystem) {
        const sysDiv = document.createElement('div');
        sysDiv.className = 'chat-system-msg';
        sysDiv.textContent = `${msg.avatar || '✨'} ${msg.text}`;
        chatMessages.appendChild(sysDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return;
      }

      const me = Sync.getCurrentUser();
      const isMine = me && msg.userId === me.userId;

      const item = document.createElement('div');
      item.className = `chat-msg-item ${isMine ? 'mine' : ''}`.trim();

      const avatarEl = document.createElement('div');
      avatarEl.className = 'chat-msg-avatar';
      avatarEl.textContent = msg.avatar || '😎';

      const contentEl = document.createElement('div');
      contentEl.className = 'chat-msg-content';

      const metaEl = document.createElement('div');
      metaEl.className = 'chat-msg-meta';

      const authorEl = document.createElement('span');
      authorEl.className = 'chat-msg-author';
      authorEl.textContent = msg.nickname || 'Khán giả';

      const seatTag = document.createElement('span');
      seatTag.className = 'chat-msg-seat';
      seatTag.textContent = msg.seatId ? `Ghế ${msg.seatId}` : 'Đứng xem';

      metaEl.appendChild(authorEl);
      metaEl.appendChild(seatTag);

      const textEl = document.createElement('div');
      textEl.className = 'chat-msg-text';
      textEl.textContent = msg.text || '';

      contentEl.appendChild(metaEl);
      contentEl.appendChild(textEl);

      item.appendChild(avatarEl);
      item.appendChild(contentEl);

      chatMessages.appendChild(item);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function appendSystemNotice(text) {
      renderChatMessageItem({
        id: `local_${Date.now()}_${Math.random()}`,
        isSystem: true,
        avatar: '🔔',
        text
      });
    }

    // 6. Cập nhật toàn bộ giao diện Ghế ngồi, Khán giả, Đèn, Rèm & Media từ RoomState
    function renderRoomState(state) {
      if (!state) return;
      const me = Sync.getCurrentUser();
      const usersMap = state.users || {};
      const seatsMap = state.seats || {};
      const userList = Object.values(usersMap);

      // Số lượng khán giả đang online
      if (onlineCountEl) {
        onlineCountEl.textContent = `${Math.max(1, userList.length)} khán giả`;
      }

      // Ghế hiện tại của người dùng
      if (currentSeatBadge) {
        currentSeatBadge.textContent = me && me.seatId ? `💺 Ghế của bạn: ${me.seatId}` : 'Chưa chọn ghế';
      }

      // Cập nhật từng chiếc ghế trên sơ đồ khán phòng
      for (const rowDef of SEAT_ROWS) {
        for (const seatCode of rowDef.seats) {
          const btn = document.getElementById(`seat-${seatCode}`);
          if (!btn) continue;

          const occupant = seatsMap[seatCode];
          const isMine = occupant && me && occupant.userId === me.userId;

          btn.classList.toggle('occupied', Boolean(occupant && !isMine));
          btn.classList.toggle('mine', Boolean(isMine));

          const avatarSpan = btn.querySelector('.seat-avatar');
          const nameSpan = btn.querySelector('.seat-name');

          if (occupant) {
            if (avatarSpan) avatarSpan.textContent = occupant.avatar || '😎';
            if (nameSpan) nameSpan.textContent = isMine ? `${occupant.nickname} (Bạn)` : occupant.nickname;
          } else {
            if (avatarSpan) avatarSpan.textContent = rowDef.type === 'sweetbox' ? '🛋️' : '💺';
            if (nameSpan) nameSpan.textContent = 'Trống';
          }
        }
      }

      // Cập nhật danh sách khán giả ở cột phải
      if (audienceList) {
        audienceList.innerHTML = '';
        for (const u of userList) {
          const isMe = me && u.userId === me.userId;
          const badge = document.createElement('div');
          badge.className = `audience-item ${u.isHost ? 'is-host' : ''} ${isMe ? 'is-me' : ''}`.trim();
          badge.setAttribute('role', 'listitem');
          const roleIcon = u.isHost ? '👑 ' : '';
          const seatText = u.seatId ? ` • ${u.seatId}` : '';
          badge.textContent = `${u.avatar || '😎'} ${roleIcon}${u.nickname}${seatText}`;
          audienceList.appendChild(badge);
        }
      }

      // Đồng bộ lịch sử chat
      if (Array.isArray(state.chatHistory)) {
        for (const msg of state.chatHistory) {
          renderChatMessageItem(msg);
        }
      }

      // Đồng bộ trạng thái Đèn rạp & Rèm nhung
      if (state.media) {
        const dimmed = Boolean(state.media.lightsDimmed);
        document.body.classList.toggle('lights-dimmed', dimmed);
        if (toggleLightsBtn) {
          toggleLightsBtn.setAttribute('aria-pressed', String(dimmed));
          toggleLightsBtn.innerHTML = dimmed ? '💡 <span>Bật đèn rạp</span>' : '💡 <span>Tắt đèn rạp</span>';
        }

        const curtainOpen = state.media.curtainOpen !== false;
        if (cinemaViewport) {
          cinemaViewport.classList.toggle('curtains-open', curtainOpen);
          cinemaViewport.classList.toggle('curtains-closed', !curtainOpen);
        }
        if (curtainLeft && curtainRight) {
          curtainLeft.classList.toggle('open', curtainOpen);
          curtainLeft.classList.toggle('closed', !curtainOpen);
          curtainRight.classList.toggle('open', curtainOpen);
          curtainRight.classList.toggle('closed', !curtainOpen);
        }
        if (toggleCurtainBtn) {
          toggleCurtainBtn.setAttribute('aria-pressed', String(curtainOpen));
          toggleCurtainBtn.innerHTML = curtainOpen ? '🎭 <span>Đóng Rèm</span>' : '🎭 <span>Mở Rèm</span>';
        }

        Player.syncMedia(state.media, false);
      }
    }

    // 7. Khởi động SyncEngine
    await Sync.init({
      onStateUpdate: (state) => {
        renderRoomState(state);
      },
      onMediaSync: (media) => {
        Player.syncMedia(media, true);
      },
      onChatMessage: (payload) => {
        if (!payload || !payload.message) return;
        renderChatMessageItem(payload.message);
        if (!payload.message.isSystem && payload.seatId) {
          Player.playSfx('chat');
          showSeatSpeechBubble(payload.seatId, payload.message.text);
        }
      },
      onReaction: (reaction) => {
        if (!reaction) return;
        Player.playSfx('reaction');
        showReactionBurst(reaction);
      },
      onConnectionChange: ({ mode }) => {
        if (!syncStatusBadge) return;
        if (mode === 'server-sse') {
          syncStatusBadge.textContent = '🟢 Đang đồng bộ Live Server (Đa Thiết Bị / LAN)';
        } else {
          syncStatusBadge.textContent = '🟢 Đang đồng bộ Đa Tab (Mở nhiều Tab để test ngay)';
        }
      }
    });

    // 8. Sự kiện Gửi tin nhắn Chat
    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        await Sync.sendChat(text);
      });
    }

    // 9. Sự kiện Thả cảm xúc nhanh
    reactionBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const emoji = btn.dataset.emoji || '❤️';
        await Sync.sendReaction(emoji);
      });
    });

    // 10. Sự kiện Bảng Điều Khiển Chủ Rạp (Host Controls)
    async function activatePresetValue(presetVal) {
      const parsed = Player.parseMediaInput(presetVal);
      if (!parsed) return;

      presetPills.forEach((pill) => {
        pill.classList.toggle('active', pill.dataset.preset === presetVal);
      });
      if (presetMediaSelect && presetMediaSelect.value !== presetVal) {
        presetMediaSelect.value = presetVal;
      }

      await Sync.updateMedia({
        type: parsed.type,
        source: parsed.source,
        title: parsed.title,
        isPlaying: true,
        currentTime: 0,
        curtainOpen: true
      });
      appendSystemNotice(`🎬 Chủ rạp đã chuyển sang chiếu: ${parsed.title}`);
    }

    if (presetMediaSelect) {
      presetMediaSelect.addEventListener('change', () => {
        activatePresetValue(presetMediaSelect.value);
      });
    }

    presetPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        if (pill.dataset.preset) {
          activatePresetValue(pill.dataset.preset);
        }
      });
    });

    if (loadMediaBtn && mediaUrlInput) {
      loadMediaBtn.addEventListener('click', async () => {
        const rawUrl = mediaUrlInput.value.trim();
        const customTitle = mediaTitleInput ? mediaTitleInput.value.trim() : '';
        if (!rawUrl) {
          appendSystemNotice('⚠️ Vui lòng dán link YouTube hoặc link video/nhạc (.mp4, .mp3) trước khi phát!');
          mediaUrlInput.focus();
          return;
        }
        const parsed = Player.parseMediaInput(rawUrl, customTitle);
        if (!parsed) return;

        await Sync.updateMedia({
          type: parsed.type,
          source: parsed.source,
          title: parsed.title,
          isPlaying: true,
          currentTime: 0,
          curtainOpen: true
        });
        appendSystemNotice(`🎬 Đang phát nguồn mới lên màn chiếu: ${parsed.title}`);
      });
    }

    const localFileLabel = document.querySelector('label[for="localFileInput"]');
    if (localFileLabel && localFileInput) {
      localFileLabel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          localFileInput.click();
        }
      });
    }

    if (localFileInput) {
      localFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const loaded = Player.loadLocalFile(file);
        if (loaded) {
          appendSystemNotice(`📂 Đang phát file từ máy tính của bạn: ${file.name}`);
        }
      });
    }

    if (hostPlayPauseBtn) {
      hostPlayPauseBtn.addEventListener('click', async () => {
        const st = Sync.getState();
        const nextPlaying = !(st.media && st.media.isPlaying);
        await Sync.updateMedia({
          isPlaying: nextPlaying,
          currentTime: Player.getCurrentTime()
        });
      });
    }

    if (hostRewindBtn) {
      hostRewindBtn.addEventListener('click', async () => {
        const target = Math.max(0, Player.getCurrentTime() - 10);
        await Sync.updateMedia({ currentTime: target });
      });
    }

    if (hostForwardBtn) {
      hostForwardBtn.addEventListener('click', async () => {
        const target = Math.min(Player.getDuration(), Player.getCurrentTime() + 10);
        await Sync.updateMedia({ currentTime: target });
      });
    }

    if (soundToggleBtn) {
      soundToggleBtn.addEventListener('click', () => {
        const enabled = Player.toggleSound();
        soundToggleBtn.textContent = enabled ? '🔊 Âm thanh: Bật' : '🔇 Âm thanh: Tắt';
      });
    }

    if (hostSeekSlider) {
      hostSeekSlider.addEventListener('pointerdown', () => {
        isDraggingSeek = true;
      });
      hostSeekSlider.addEventListener('change', async () => {
        const pct = Number(hostSeekSlider.value) || 0;
        const targetSec = (pct / 100) * Player.getDuration();
        isDraggingSeek = false;
        await Sync.updateMedia({ currentTime: targetSec });
      });
      window.addEventListener('pointerup', () => {
        isDraggingSeek = false;
      });
      window.addEventListener('pointercancel', () => {
        isDraggingSeek = false;
      });
    }

    if (volumeSlider) {
      volumeSlider.addEventListener('input', () => {
        Player.setVolume(volumeSlider.value);
      });
    }

    if (forceSyncBtn) {
      forceSyncBtn.addEventListener('click', async () => {
        await Sync.updateMedia({
          currentTime: Player.getCurrentTime(),
          isPlaying: true
        });
        appendSystemNotice('🔄 Đã đồng bộ khung hình hiện tại cho toàn bộ khán giả trong rạp!');
      });
    }

    // 11. Sự kiện Header (Ẩn/Hiện Host Panel, Tắt đèn, Đóng/Mở Rèm, Đổi Hồ Sơ)
    if (toggleHostPanelBtn && hostControlPanel) {
      toggleHostPanelBtn.addEventListener('click', () => {
        const isCollapsed = hostControlPanel.classList.toggle('collapsed');
        toggleHostPanelBtn.setAttribute('aria-expanded', String(!isCollapsed));
      });
    }

    if (toggleLightsBtn) {
      toggleLightsBtn.addEventListener('click', async () => {
        const st = Sync.getState();
        const nextDimmed = !(st.media && st.media.lightsDimmed);
        await Sync.updateMedia({ lightsDimmed: nextDimmed });
      });
    }

    if (toggleCurtainBtn) {
      toggleCurtainBtn.addEventListener('click', async () => {
        Player.playSfx('curtain');
        const st = Sync.getState();
        const nextCurtain = !(st.media && st.media.curtainOpen !== false);
        await Sync.updateMedia({ curtainOpen: nextCurtain });
      });
    }

    // 12. Modal Chọn Tên & Avatar Khán Giả
    let selectedAvatar = Sync.getCurrentUser().avatar || '😎';

    function openProfileModal() {
      const me = Sync.getCurrentUser();
      if (nicknameInput) nicknameInput.value = me.nickname || '';
      if (isHostCheckbox) isHostCheckbox.checked = Boolean(me.isHost);
      selectedAvatar = me.avatar || '😎';

      avatarOptions.forEach((btn) => {
        const isSelected = btn.dataset.avatar === selectedAvatar;
        btn.classList.toggle('selected', isSelected);
        btn.setAttribute('aria-checked', String(isSelected));
      });

      if (profileModal) {
        profileModal.hidden = false;
        setTimeout(() => {
          if (nicknameInput) nicknameInput.focus();
        }, 60);
      }
    }

    avatarOptions.forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedAvatar = btn.dataset.avatar || '😎';
        avatarOptions.forEach((other) => {
          const match = other === btn;
          other.classList.toggle('selected', match);
          other.setAttribute('aria-checked', String(match));
        });
      });
    });

    if (openProfileBtn) {
      openProfileBtn.addEventListener('click', openProfileModal);
    }

    if (saveProfileBtn) {
      saveProfileBtn.addEventListener('click', async () => {
        const newName = nicknameInput && nicknameInput.value.trim()
          ? nicknameInput.value.trim()
          : Sync.getCurrentUser().nickname;
        const nextIsHost = isHostCheckbox ? isHostCheckbox.checked : true;

        await Sync.joinOrUpdateUser({
          nickname: newName,
          avatar: selectedAvatar,
          isHost: nextIsHost
        });

        if (profileModal) {
          profileModal.hidden = true;
        }
        appendSystemNotice(`🎟️ Đã cập nhật hồ sơ: ${selectedAvatar} ${newName}`);
      });
    }

    if (profileModal) {
      profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) {
          profileModal.hidden = true;
        }
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !profileModal.hidden) {
          profileModal.hidden = true;
        }
      });
    }
  });
})();
