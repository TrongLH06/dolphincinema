/**
 * STARLIGHT CINEMA ROOM — Hybrid Multi-Mode Sync Engine
 * File: d:\Agent\cinema-room\js\sync-engine.js
 * Chức năng:
 *  - Tự động phát hiện và chuyển đổi mượt mà giữa 2 chế độ:
 *    1. 'server-sse': Kết nối `/api/events` + `/api/action` khi mở qua Node.js Server
 *    2. 'broadcast-multi-tab': Dùng `BroadcastChannel('starlight_cinema_v1')` +
 *       `localStorage('starlight_cinema_state_v1')` + heartbeat 3 giây khi mở trực tiếp
 *       file `index.html` (`file://`) hoặc static server không có backend.
 */

(function (global) {
  'use strict';

  const CHANNEL_NAME = 'dolphincinema_v1';
  const STORAGE_KEY = 'dolphincinema_state_v1';
  const USER_STORAGE_KEY = 'dolphincinema_user_v1';
  const HEARTBEAT_INTERVAL_MS = 3000;
  const STALE_USER_TIMEOUT_MS = 10000;
  const MAX_CHAT_HISTORY = 50;
  const MAX_CHAT_LENGTH = 240;

  const DEFAULT_SEAT_IDS = [
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
    'D1', 'D2', 'D3'
  ];

  function createDefaultRoomState() {
    return {
      media: {
        type: 'builtin',
        source: 'kiem-tam-do-kiep',
        title: '⚔️ Kiếm Tâm Độ Kiếp — The Tribulation of Sword Heart',
        isPlaying: true,
        currentTime: 0,
        updatedAt: Date.now(),
        lightsDimmed: false,
        curtainOpen: true
      },
      users: {},
      seats: {},
      chatHistory: [],
      serverTime: Date.now()
    };
  }

  function generateId(prefix = 'usr') {
    const rand = Math.random().toString(36).substring(2, 8);
    const time = Date.now().toString(36).slice(-4);
    return `${prefix}_${time}${rand}`;
  }

  function computeLiveMedia(media) {
    if (!media) return createDefaultRoomState().media;
    const now = Date.now();
    let currentTime = Number(media.currentTime) || 0;
    if (media.isPlaying && media.updatedAt) {
      currentTime += Math.max(0, (now - Number(media.updatedAt)) / 1000);
    }
    return {
      ...media,
      currentTime: Number(currentTime.toFixed(3))
    };
  }

  class CinemaSyncEngineClass {
    constructor() {
      this.mode = 'broadcast-multi-tab'; // 'server-sse' | 'broadcast-multi-tab'
      this.callbacks = {
        onStateUpdate: null,
        onMediaSync: null,
        onChatMessage: null,
        onReaction: null,
        onConnectionChange: null
      };

      this.state = createDefaultRoomState();
      this.currentUser = this._loadOrCreateLocalUser();
      this.eventSource = null;
      this.broadcastChannel = null;
      this.heartbeatTimer = null;
      this.isInitialized = false;
    }

    _loadOrCreateLocalUser() {
      try {
        const saved = sessionStorage.getItem(USER_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.userId) return parsed;
        }
      } catch (_) {}

      const avatars = ['😎', '🦊', '🐱', '🐼', '🦁', '🐸', '🦄', '👻', '🤖', '👑'];
      const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];
      const userId = generateId('guest');
      const newUser = {
        userId,
        nickname: `Khán giả #${userId.slice(-4).toUpperCase()}`,
        avatar: randomAvatar,
        isHost: true,
        seatId: null,
        lastSeen: Date.now()
      };

      this._saveLocalUser(newUser);
      return newUser;
    }

    _saveLocalUser(user) {
      try {
        sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      } catch (_) {}
    }

    async init(callbacks = {}) {
      this.callbacks = {
        ...this.callbacks,
        ...callbacks
      };

      this._cleanupConnections();
      const canUseServer = await this._probeServer();

      if (canUseServer) {
        await this._startServerSSEMode();
      } else {
        this._startBroadcastMultiTabMode();
      }

      this.isInitialized = true;
      return {
        mode: this.mode,
        user: this.getCurrentUser(),
        state: this.getState()
      };
    }

    async _probeServer() {
      if (global.location && global.location.protocol === 'file:') {
        return false;
      }
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;
        const res = await fetch('/api/state', {
          method: 'GET',
          cache: 'no-store',
          signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);
        if (!res.ok) return false;
        const data = await res.json();
        if (data && data.media && data.users) {
          this.state = data;
          return true;
        }
        return false;
      } catch (_) {
        return false;
      }
    }

    async _startServerSSEMode() {
      this.mode = 'server-sse';
      this._notifyConnectionChange({ mode: this.mode, connected: true });

      await this.joinOrUpdateUser({
        nickname: this.currentUser.nickname,
        avatar: this.currentUser.avatar,
        isHost: this.currentUser.isHost
      });

      const sseUrl = `/api/events?userId=${encodeURIComponent(this.currentUser.userId)}`;
      const es = new EventSource(sseUrl);
      this.eventSource = es;

      es.addEventListener('STATE_UPDATE', (e) => {
        try {
          const nextState = JSON.parse(e.data);
          this._applyIncomingState(nextState);
        } catch (_) {}
      });

      es.addEventListener('USER_JOINED', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.state) {
            this._applyIncomingState(data.state);
          }
        } catch (_) {}
      });

      es.addEventListener('SEAT_UPDATED', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.seats) this.state.seats = data.seats;
          if (data.users) this.state.users = data.users;
          if (this.state.users[this.currentUser.userId]) {
            this.currentUser = {
              ...this.currentUser,
              ...this.state.users[this.currentUser.userId]
            };
            this._saveLocalUser(this.currentUser);
          }
          if (data.systemMessage && typeof this.callbacks.onChatMessage === 'function') {
            this.callbacks.onChatMessage({
              message: data.systemMessage,
              seatId: data.seatId || null,
              userId: 'system'
            });
          }
          this._emitStateUpdate();
        } catch (_) {}
      });

      es.addEventListener('CHAT_MESSAGE', (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.message) {
            const exists = this.state.chatHistory.some((m) => m.id === payload.message.id);
            if (!exists) {
              this.state.chatHistory.push(payload.message);
              if (this.state.chatHistory.length > MAX_CHAT_HISTORY) {
                this.state.chatHistory.shift();
              }
            }
            if (typeof this.callbacks.onChatMessage === 'function') {
              this.callbacks.onChatMessage(payload);
            }
          }
        } catch (_) {}
      });

      es.addEventListener('REACTION_BURST', (e) => {
        try {
          const reaction = JSON.parse(e.data);
          if (typeof this.callbacks.onReaction === 'function') {
            this.callbacks.onReaction(reaction);
          }
        } catch (_) {}
      });

      es.addEventListener('MEDIA_SYNC', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.media) {
            this.state.media = data.media;
            if (typeof this.callbacks.onMediaSync === 'function') {
              this.callbacks.onMediaSync(computeLiveMedia(this.state.media), data);
            }
            this._emitStateUpdate();
          }
        } catch (_) {}
      });

      es.onerror = () => {
        if (this.mode === 'server-sse') {
          try {
            es.close();
          } catch (_) {}
          this.eventSource = null;
          this._startBroadcastMultiTabMode();
        }
      };
    }

    _startBroadcastMultiTabMode() {
      this.mode = 'broadcast-multi-tab';
      this.state = this._readSharedLocalState();

      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
        this.broadcastChannel.onmessage = (event) => {
          this._handleMultiTabEvent(event.data);
        };
      }

      this._storageListener = (event) => {
        if (event.key === STORAGE_KEY && event.newValue) {
          try {
            const shared = JSON.parse(event.newValue);
            this._applyIncomingState(shared);
          } catch (_) {}
        }
      };
      global.addEventListener('storage', this._storageListener);

      this._unloadListener = () => {
        this._removeLocalUserOnUnload();
      };
      global.addEventListener('beforeunload', this._unloadListener);

      this._localJoinOrUpdateUser({
        nickname: this.currentUser.nickname,
        avatar: this.currentUser.avatar,
        isHost: this.currentUser.isHost
      });

      this.heartbeatTimer = setInterval(() => {
        this._runMultiTabHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);

      this._notifyConnectionChange({ mode: this.mode, connected: true });
      this._emitStateUpdate();
    }

    _readSharedLocalState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.media && parsed.users && parsed.seats) {
            return parsed;
          }
        }
      } catch (_) {}
      const initial = createDefaultRoomState();
      this._writeSharedLocalState(initial);
      return initial;
    }

    _writeSharedLocalState(nextState) {
      this.state = nextState;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      } catch (_) {}
    }

    _postMultiTabMessage(type, payload) {
      const packet = {
        type,
        payload,
        senderId: this.currentUser.userId,
        timestamp: Date.now()
      };
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(packet);
        } catch (_) {}
      }
    }

    _handleMultiTabEvent(packet) {
      if (!packet || !packet.type) return;
      const { type, payload } = packet;

      switch (type) {
        case 'STATE_UPDATE':
        case 'USER_JOINED':
        case 'SEAT_UPDATED': {
          const latest = payload && payload.state ? payload.state : this._readSharedLocalState();
          this._applyIncomingState(latest);
          if (type === 'SEAT_UPDATED' && payload && payload.systemMessage) {
            if (typeof this.callbacks.onChatMessage === 'function') {
              this.callbacks.onChatMessage({
                message: payload.systemMessage,
                seatId: payload.seatId || null,
                userId: 'system'
              });
            }
          }
          break;
        }
        case 'CHAT_MESSAGE': {
          const latest = this._readSharedLocalState();
          this.state = latest;
          if (payload && payload.message && typeof this.callbacks.onChatMessage === 'function') {
            this.callbacks.onChatMessage(payload);
          }
          this._emitStateUpdate();
          break;
        }
        case 'REACTION_BURST': {
          if (payload && typeof this.callbacks.onReaction === 'function') {
            this.callbacks.onReaction(payload);
          }
          break;
        }
        case 'MEDIA_SYNC': {
          if (payload && payload.media) {
            this.state.media = payload.media;
            if (typeof this.callbacks.onMediaSync === 'function') {
              this.callbacks.onMediaSync(computeLiveMedia(this.state.media), payload);
            }
            this._emitStateUpdate();
          }
          break;
        }
        case 'HEARTBEAT_PING': {
          if (payload && payload.userId) {
            const shared = this._readSharedLocalState();
            if (shared.users[payload.userId]) {
              shared.users[payload.userId].lastSeen = payload.timestamp || Date.now();
              this._writeSharedLocalState(shared);
            }
          }
          break;
        }
        default:
          break;
      }
    }

    _runMultiTabHeartbeat() {
      const now = Date.now();
      const shared = this._readSharedLocalState();
      let changed = false;

      if (shared.users[this.currentUser.userId]) {
        shared.users[this.currentUser.userId].lastSeen = now;
      } else {
        shared.users[this.currentUser.userId] = {
          ...this.currentUser,
          lastSeen: now
        };
        if (this.currentUser.seatId && !shared.seats[this.currentUser.seatId]) {
          shared.seats[this.currentUser.seatId] = {
            seatId: this.currentUser.seatId,
            userId: this.currentUser.userId,
            nickname: this.currentUser.nickname,
            avatar: this.currentUser.avatar
          };
        }
        changed = true;
      }

      for (const [uid, usr] of Object.entries(shared.users)) {
        if (uid !== this.currentUser.userId && now - (usr.lastSeen || 0) > STALE_USER_TIMEOUT_MS) {
          if (usr.seatId && shared.seats[usr.seatId] && shared.seats[usr.seatId].userId === uid) {
            delete shared.seats[usr.seatId];
          }
          delete shared.users[uid];
          changed = true;
        }
      }

      this._writeSharedLocalState(shared);
      this._postMultiTabMessage('HEARTBEAT_PING', {
        userId: this.currentUser.userId,
        timestamp: now
      });

      if (changed) {
        this._postMultiTabMessage('STATE_UPDATE', { state: shared });
        this._emitStateUpdate();
      }
    }

    _removeLocalUserOnUnload() {
      try {
        const shared = this._readSharedLocalState();
        const uid = this.currentUser.userId;
        const usr = shared.users[uid];
        if (usr) {
          if (usr.seatId && shared.seats[usr.seatId] && shared.seats[usr.seatId].userId === uid) {
            delete shared.seats[usr.seatId];
          }
          delete shared.users[uid];
          this._writeSharedLocalState(shared);
          this._postMultiTabMessage('STATE_UPDATE', { state: shared });
        }
      } catch (_) {}
    }

    async joinOrUpdateUser({ nickname, avatar, isHost, seatId } = {}) {
      if (typeof nickname === 'string' && nickname.trim()) {
        this.currentUser.nickname = nickname.trim().slice(0, 24);
      }
      if (typeof avatar === 'string' && avatar.trim()) {
        this.currentUser.avatar = avatar.trim().slice(0, 16);
      }
      if (typeof isHost === 'boolean') {
        this.currentUser.isHost = isHost;
      }
      if (typeof seatId === 'string' && seatId.trim()) {
        this.currentUser.seatId = seatId.trim().toUpperCase();
      }
      this._saveLocalUser(this.currentUser);

      if (this.mode === 'server-sse') {
        const res = await this._postServerAction({
          action: 'JOIN_OR_UPDATE_USER',
          userId: this.currentUser.userId,
          nickname: this.currentUser.nickname,
          avatar: this.currentUser.avatar,
          isHost: this.currentUser.isHost,
          seatId: this.currentUser.seatId
        });
        if (res && res.user) {
          this.currentUser = { ...this.currentUser, ...res.user };
          this._saveLocalUser(this.currentUser);
        }
        if (res && res.state) {
          this._applyIncomingState(res.state);
        }
        return res;
      }

      return this._localJoinOrUpdateUser({
        nickname: this.currentUser.nickname,
        avatar: this.currentUser.avatar,
        isHost: this.currentUser.isHost,
        seatId: this.currentUser.seatId
      });
    }

    _localJoinOrUpdateUser({ nickname, avatar, isHost, seatId } = {}) {
      const shared = this._readSharedLocalState();
      const uid = this.currentUser.userId;
      const isNewUser = !shared.users[uid];
      const hasHost = Object.values(shared.users).some((u) => u.isHost && u.userId !== uid);

      let targetSeat = seatId || this.currentUser.seatId;
      if (targetSeat && shared.seats[targetSeat] && shared.seats[targetSeat].userId !== uid) {
        targetSeat = null;
      }
      if (!targetSeat) {
        for (const candidate of DEFAULT_SEAT_IDS) {
          if (!shared.seats[candidate]) {
            targetSeat = candidate;
            break;
          }
        }
      }

      const userRecord = {
        userId: uid,
        nickname: nickname || this.currentUser.nickname,
        avatar: avatar || this.currentUser.avatar,
        isHost: typeof isHost === 'boolean' ? isHost : !hasHost,
        seatId: targetSeat || null,
        lastSeen: Date.now()
      };

      shared.users[uid] = userRecord;
      if (targetSeat) {
        shared.seats[targetSeat] = {
          seatId: targetSeat,
          userId: uid,
          nickname: userRecord.nickname,
          avatar: userRecord.avatar
        };
      }

      if (isNewUser) {
        const joinMsg = {
          id: generateId('msg'),
          userId: 'system',
          nickname: 'DOLPHINCINEMA.COM',
          avatar: '🐬',
          seatId: userRecord.seatId,
          text: `${userRecord.nickname} vừa vào phòng chiếu${userRecord.seatId ? ` (Ghế ${userRecord.seatId})` : ''}.`,
          timestamp: Date.now(),
          isSystem: true
        };
        shared.chatHistory.push(joinMsg);
        if (shared.chatHistory.length > MAX_CHAT_HISTORY) {
          shared.chatHistory.shift();
        }
      }

      this.currentUser = userRecord;
      this._saveLocalUser(this.currentUser);
      this._writeSharedLocalState(shared);
      this._postMultiTabMessage('USER_JOINED', { user: userRecord, state: shared });
      this._emitStateUpdate();

      return { ok: true, user: userRecord, state: this.getState() };
    }

    async selectSeat(seatId) {
      const normalizedSeat = typeof seatId === 'string' ? seatId.trim().toUpperCase() : '';
      if (!normalizedSeat || !DEFAULT_SEAT_IDS.includes(normalizedSeat)) {
        return { ok: false, error: `Mã ghế ${normalizedSeat} không hợp lệ trong rạp` };
      }

      if (this.mode === 'server-sse') {
        const res = await this._postServerAction({
          action: 'SELECT_SEAT',
          userId: this.currentUser.userId,
          nickname: this.currentUser.nickname,
          avatar: this.currentUser.avatar,
          seatId: normalizedSeat
        });
        if (res && res.ok) {
          this.currentUser.seatId = normalizedSeat;
          this._saveLocalUser(this.currentUser);
          if (res.state) this._applyIncomingState(res.state);
        }
        return res;
      }

      const shared = this._readSharedLocalState();
      const uid = this.currentUser.userId;
      const occupant = shared.seats[normalizedSeat];
      if (occupant && occupant.userId !== uid) {
        return { ok: false, error: `Ghế ${normalizedSeat} đã có người ngồi` };
      }

      const previousSeatId = this.currentUser.seatId;
      for (const [sid, occ] of Object.entries(shared.seats)) {
        if (occ && occ.userId === uid) {
          delete shared.seats[sid];
        }
      }

      this.currentUser.seatId = normalizedSeat;
      this.currentUser.lastSeen = Date.now();
      this._saveLocalUser(this.currentUser);

      shared.users[uid] = { ...this.currentUser };
      shared.seats[normalizedSeat] = {
        seatId: normalizedSeat,
        userId: uid,
        nickname: this.currentUser.nickname,
        avatar: this.currentUser.avatar
      };

      let systemMessage = null;
      if (previousSeatId !== normalizedSeat) {
        systemMessage = {
          id: generateId('msg'),
          userId: 'system',
          nickname: 'DOLPHINCINEMA.COM',
          avatar: '💺',
          seatId: normalizedSeat,
          text: `${this.currentUser.nickname} đã chuyển sang ghế ${normalizedSeat}.`,
          timestamp: Date.now(),
          isSystem: true
        };
        shared.chatHistory.push(systemMessage);
        if (shared.chatHistory.length > MAX_CHAT_HISTORY) {
          shared.chatHistory.shift();
        }
      }

      this._writeSharedLocalState(shared);
      this._postMultiTabMessage('SEAT_UPDATED', {
        userId: uid,
        previousSeatId,
        seatId: normalizedSeat,
        systemMessage,
        state: shared
      });

      if (systemMessage && typeof this.callbacks.onChatMessage === 'function') {
        this.callbacks.onChatMessage({
          message: systemMessage,
          seatId: normalizedSeat,
          userId: 'system'
        });
      }
      this._emitStateUpdate();
      return { ok: true, seatId: normalizedSeat, previousSeatId, state: this.getState() };
    }

    async sendChat(text) {
      const cleaned = typeof text === 'string' ? text.trim().slice(0, MAX_CHAT_LENGTH) : '';
      if (!cleaned) return { ok: false, error: 'Tin nhắn trống' };

      if (this.mode === 'server-sse') {
        return this._postServerAction({
          action: 'CHAT_MESSAGE',
          userId: this.currentUser.userId,
          nickname: this.currentUser.nickname,
          avatar: this.currentUser.avatar,
          seatId: this.currentUser.seatId,
          text: cleaned
        });
      }

      const shared = this._readSharedLocalState();
      const message = {
        id: generateId('chat'),
        userId: this.currentUser.userId,
        nickname: this.currentUser.nickname,
        avatar: this.currentUser.avatar,
        seatId: this.currentUser.seatId,
        text: cleaned,
        timestamp: Date.now(),
        isSystem: false
      };

      shared.chatHistory.push(message);
      if (shared.chatHistory.length > MAX_CHAT_HISTORY) {
        shared.chatHistory.shift();
      }
      this._writeSharedLocalState(shared);

      const chatEvent = {
        message,
        seatId: this.currentUser.seatId,
        userId: this.currentUser.userId,
        nickname: this.currentUser.nickname,
        avatar: this.currentUser.avatar
      };

      this._postMultiTabMessage('CHAT_MESSAGE', chatEvent);
      if (typeof this.callbacks.onChatMessage === 'function') {
        this.callbacks.onChatMessage(chatEvent);
      }
      this._emitStateUpdate();
      return { ok: true, message };
    }

    async sendReaction(emoji = '❤️') {
      const cleanEmoji = typeof emoji === 'string' && emoji.trim() ? emoji.trim().slice(0, 16) : '❤️';

      if (this.mode === 'server-sse') {
        return this._postServerAction({
          action: 'REACTION',
          userId: this.currentUser.userId,
          nickname: this.currentUser.nickname,
          avatar: this.currentUser.avatar,
          seatId: this.currentUser.seatId,
          emoji: cleanEmoji
        });
      }

      const reactionEvent = {
        id: generateId('react'),
        userId: this.currentUser.userId,
        seatId: this.currentUser.seatId,
        nickname: this.currentUser.nickname,
        avatar: this.currentUser.avatar,
        emoji: cleanEmoji,
        timestamp: Date.now()
      };

      this._postMultiTabMessage('REACTION_BURST', reactionEvent);
      if (typeof this.callbacks.onReaction === 'function') {
        this.callbacks.onReaction(reactionEvent);
      }
      return { ok: true, reaction: reactionEvent };
    }

    async updateMedia(mediaPatch = {}) {
      if (!mediaPatch || typeof mediaPatch !== 'object') {
        return { ok: false, error: 'mediaPatch không hợp lệ' };
      }

      if (this.mode === 'server-sse') {
        return this._postServerAction({
          action: 'MEDIA_CONTROL',
          userId: this.currentUser.userId,
          mediaPatch
        });
      }

      const shared = this._readSharedLocalState();
      const liveNow = computeLiveMedia(shared.media);
      let nextTime = liveNow.currentTime;

      if (typeof mediaPatch.currentTime === 'number' && Number.isFinite(mediaPatch.currentTime) && mediaPatch.currentTime >= 0) {
        nextTime = mediaPatch.currentTime;
      } else if (typeof mediaPatch.source === 'string' && mediaPatch.source !== shared.media.source) {
        nextTime = 0;
      }

      shared.media = {
        ...shared.media,
        ...(typeof mediaPatch.type === 'string' ? { type: mediaPatch.type } : {}),
        ...(typeof mediaPatch.source === 'string' ? { source: mediaPatch.source } : {}),
        ...(typeof mediaPatch.title === 'string' ? { title: mediaPatch.title } : {}),
        ...(typeof mediaPatch.isPlaying === 'boolean' ? { isPlaying: mediaPatch.isPlaying } : {}),
        ...(typeof mediaPatch.lightsDimmed === 'boolean' ? { lightsDimmed: mediaPatch.lightsDimmed } : {}),
        ...(typeof mediaPatch.curtainOpen === 'boolean' ? { curtainOpen: mediaPatch.curtainOpen } : {}),
        currentTime: Number(Math.max(0, nextTime).toFixed(3)),
        updatedAt: Date.now()
      };

      this._writeSharedLocalState(shared);
      const syncPayload = {
        media: computeLiveMedia(shared.media),
        triggeredBy: this.currentUser.userId,
        serverTime: Date.now()
      };

      this._postMultiTabMessage('MEDIA_SYNC', syncPayload);
      if (typeof this.callbacks.onMediaSync === 'function') {
        this.callbacks.onMediaSync(syncPayload.media, syncPayload);
      }
      this._emitStateUpdate();
      return { ok: true, media: syncPayload.media };
    }

    async _postServerAction(payload) {
      try {
        const res = await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return await res.json();
      } catch (err) {
        return { ok: false, error: err.message || 'Lỗi kết nối máy chủ' };
      }
    }

    _applyIncomingState(nextState) {
      if (!nextState || typeof nextState !== 'object') return;
      this.state = {
        ...this.state,
        ...nextState
      };
      if (this.state.users && this.state.users[this.currentUser.userId]) {
        this.currentUser = {
          ...this.currentUser,
          ...this.state.users[this.currentUser.userId]
        };
        this._saveLocalUser(this.currentUser);
      }
      this._emitStateUpdate();
    }

    _emitStateUpdate() {
      if (typeof this.callbacks.onStateUpdate === 'function') {
        this.callbacks.onStateUpdate(this.getState());
      }
    }

    _notifyConnectionChange(info) {
      if (typeof this.callbacks.onConnectionChange === 'function') {
        this.callbacks.onConnectionChange(info);
      }
    }

    _cleanupConnections() {
      if (this.eventSource) {
        try {
          this.eventSource.close();
        } catch (_) {}
        this.eventSource = null;
      }
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.close();
        } catch (_) {}
        this.broadcastChannel = null;
      }
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this._storageListener) {
        global.removeEventListener('storage', this._storageListener);
        this._storageListener = null;
      }
      if (this._unloadListener) {
        global.removeEventListener('beforeunload', this._unloadListener);
        this._unloadListener = null;
      }
    }

    getCurrentUser() {
      return { ...this.currentUser };
    }

    getState() {
      return {
        ...this.state,
        media: computeLiveMedia(this.state.media)
      };
    }

    getMode() {
      return this.mode;
    }
  }

  const engineInstance = new CinemaSyncEngineClass();
  engineInstance.CinemaSyncEngineClass = CinemaSyncEngineClass;
  global.CinemaSyncEngine = engineInstance;
})(typeof window !== 'undefined' ? window : globalThis);
