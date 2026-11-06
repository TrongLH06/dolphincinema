/**
 * DOLPHINCINEMA.COM — Zero-Dependency Node.js Realtime Server
 * File: d:\Agent\cinema-room\server.js
 * Chức năng:
 *  - Phục vụ file tĩnh an toàn (chống Path Traversal)
 *  - Quản lý trạng thái phòng chiếu (roomState) trên RAM
 *  - Đồng bộ thời gian thực qua Server-Sent Events (SSE) & REST API
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8090;
const ROOT_DIR = path.resolve(__dirname);
const MAX_BODY_SIZE = 16 * 1024; // 16KB chống DoS
const MAX_CHAT_HISTORY = 50;
const MAX_CHAT_LENGTH = 240;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.wav': 'audio/wav'
};

// Danh sách 21 ghế chuẩn của rạp (A1..A6 Thường, B1..B6 & C1..C6 VIP, D1..D3 Sweetbox)
const DEFAULT_SEAT_IDS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
  'D1', 'D2', 'D3'
];

// Trạng thái phòng chiếu lưu trên RAM
const roomState = {
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
  users: {},      // { [userId]: { userId, nickname, avatar, isHost, seatId, lastSeen } }
  seats: {},      // { [seatId]: { seatId, userId, nickname, avatar } }
  chatHistory: [] // Tối đa 50 tin nhắn: { id, userId, nickname, avatar, seatId, text, timestamp, isSystem }
};

// Quản lý danh sách kết nối SSE: Map<res, { userId }>
const sseClients = new Map();

/**
 * Tính toán thời gian phát thực tế của media tại thời điểm gọi
 */
function getComputedMedia() {
  const now = Date.now();
  let computedTime = Number(roomState.media.currentTime) || 0;
  if (roomState.media.isPlaying) {
    const elapsedSec = Math.max(0, (now - roomState.media.updatedAt) / 1000);
    computedTime += elapsedSec;
  }
  return {
    ...roomState.media,
    currentTime: Number(computedTime.toFixed(3)),
    serverTime: now
  };
}

/**
 * Xuất bản chụp toàn bộ trạng thái phòng chiếu hiện tại
 */
function getPublicState() {
  return {
    media: getComputedMedia(),
    users: roomState.users,
    seats: roomState.seats,
    chatHistory: roomState.chatHistory,
    serverTime: Date.now()
  };
}

/**
 * Chuẩn hóa chuỗi đầu vào an toàn
 */
function sanitizeString(val, maxLen = 64, fallback = '') {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

/**
 * Thêm tin nhắn vào lịch sử (giới hạn 50 tin)
 */
function appendChatMessage({ userId, nickname, avatar, seatId, text, isSystem = false }) {
  const msg = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'),
    userId: userId || 'system',
    nickname: nickname || 'Hệ thống',
    avatar: avatar || '🎬',
    seatId: seatId || null,
    text: sanitizeString(text, MAX_CHAT_LENGTH, ''),
    timestamp: Date.now(),
    isSystem: Boolean(isSystem)
  };
  if (!msg.text) return null;
  roomState.chatHistory.push(msg);
  if (roomState.chatHistory.length > MAX_CHAT_HISTORY) {
    roomState.chatHistory.splice(0, roomState.chatHistory.length - MAX_CHAT_HISTORY);
  }
  return msg;
}

/**
 * Gửi sự kiện SSE tới toàn bộ client đang kết nối
 */
function broadcastSSE(eventType, payload) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const [clientRes] of sseClients.entries()) {
    try {
      clientRes.write(message);
    } catch (_) {
      sseClients.delete(clientRes);
    }
  }
}

/**
 * Tìm ghế trống tiếp theo để gợi ý
 */
function findAvailableSeat() {
  for (const seatId of DEFAULT_SEAT_IDS) {
    if (!roomState.seats[seatId]) return seatId;
  }
  return null;
}

/**
 * Giải phóng ghế hiện tại của userId (nếu có)
 */
function releaseUserSeat(userId) {
  let releasedSeatId = null;
  const user = roomState.users[userId];
  if (user && user.seatId) {
    releasedSeatId = user.seatId;
    if (roomState.seats[releasedSeatId] && roomState.seats[releasedSeatId].userId === userId) {
      delete roomState.seats[releasedSeatId];
    }
    user.seatId = null;
  }
  for (const [seatId, occupant] of Object.entries(roomState.seats)) {
    if (occupant && occupant.userId === userId) {
      delete roomState.seats[seatId];
      releasedSeatId = seatId;
    }
  }
  return releasedSeatId;
}

/**
 * Trả về JSON response chuẩn kèm CORS headers
 */
function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

/**
 * Đọc JSON body với giới hạn <= 16KB chống DoS
 */
function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_SIZE) {
        req.destroy();
        reject(Object.assign(new Error('Payload vượt quá giới hạn 16KB'), { statusCode: 413 }));
        return;
      }
      raw += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
          return reject(Object.assign(new Error('JSON payload phải là một Object'), { statusCode: 400 }));
        }
        resolve(parsed);
      } catch (_) {
        reject(Object.assign(new Error('JSON không hợp lệ'), { statusCode: 400 }));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

/**
 * Xử lý các hành động POST /api/action
 */
function handleAction(actionData) {
  const action = sanitizeString(actionData.action || actionData.type, 40, '');
  const userId = sanitizeString(actionData.userId, 64, '');

  if (!action) {
    const err = new Error('Thiếu trường action');
    err.statusCode = 400;
    throw err;
  }

  switch (action) {
    case 'JOIN_OR_UPDATE_USER': {
      if (!userId) {
        throw Object.assign(new Error('Thiếu userId'), { statusCode: 400 });
      }
      const existing = roomState.users[userId];
      const nickname = sanitizeString(
        actionData.nickname,
        24,
        existing ? existing.nickname : `Khán giả ${userId.slice(-4)}`
      );
      const avatar = sanitizeString(actionData.avatar, 16, existing ? existing.avatar : '😎');
      const hasHostAlready = Object.values(roomState.users).some((u) => u.isHost && u.userId !== userId);
      const isHost =
        typeof actionData.isHost === 'boolean'
          ? actionData.isHost
          : existing
          ? existing.isHost
          : !hasHostAlready;

      let seatId = existing ? existing.seatId : null;
      if (seatId && (!roomState.seats[seatId] || roomState.seats[seatId].userId !== userId)) {
        seatId = null;
      }
      const requestedSeat = sanitizeString(actionData.seatId, 12, '').toUpperCase();
      if (requestedSeat && DEFAULT_SEAT_IDS.includes(requestedSeat) && (!roomState.seats[requestedSeat] || roomState.seats[requestedSeat].userId === userId)) {
        releaseUserSeat(userId);
        seatId = requestedSeat;
      } else if (!seatId && actionData.autoAssignSeat !== false) {
        const suggestedSeat = findAvailableSeat();
        if (suggestedSeat) {
          seatId = suggestedSeat;
        }
      }

      const userRecord = {
        userId,
        nickname,
        avatar,
        isHost,
        seatId: seatId || null,
        lastSeen: Date.now()
      };
      roomState.users[userId] = userRecord;

      if (seatId) {
        roomState.seats[seatId] = {
          seatId,
          userId,
          nickname,
          avatar
        };
      }

      if (!existing) {
        appendChatMessage({
          userId: 'system',
          nickname: 'DOLPHINCINEMA.COM',
          avatar: '🐬',
          seatId: userRecord.seatId,
          text: `${nickname} vừa vào phòng chiếu${userRecord.seatId ? ` (Ghế ${userRecord.seatId})` : ''}.`,
          isSystem: true
        });
      }

      const publicState = getPublicState();
      broadcastSSE('USER_JOINED', { user: userRecord, state: publicState });
      broadcastSSE('STATE_UPDATE', publicState);
      return { ok: true, user: userRecord, state: publicState };
    }

    case 'SELECT_SEAT': {
      const seatId = sanitizeString(actionData.seatId, 12, '').toUpperCase();
      if (!userId || !seatId) {
        throw Object.assign(new Error('Thiếu userId hoặc seatId'), { statusCode: 400 });
      }
      if (!DEFAULT_SEAT_IDS.includes(seatId)) {
        throw Object.assign(new Error(`Mã ghế ${seatId} không tồn tại trong rạp (chỉ A1..A6, B1..B6, C1..C6, D1..D3)`), { statusCode: 400 });
      }

      const occupant = roomState.seats[seatId];
      if (occupant && occupant.userId !== userId) {
        throw Object.assign(new Error(`Ghế ${seatId} đã có người ngồi`), { statusCode: 409 });
      }

      if (!roomState.users[userId]) {
        roomState.users[userId] = {
          userId,
          nickname: sanitizeString(actionData.nickname, 24, `Khán giả ${userId.slice(-4)}`),
          avatar: sanitizeString(actionData.avatar, 16, '😎'),
          isHost: false,
          seatId: null,
          lastSeen: Date.now()
        };
      }

      const user = roomState.users[userId];
      const previousSeatId = releaseUserSeat(userId);

      user.seatId = seatId;
      user.lastSeen = Date.now();
      roomState.seats[seatId] = {
        seatId,
        userId: user.userId,
        nickname: user.nickname,
        avatar: user.avatar
      };

      let systemMsg = null;
      if (previousSeatId !== seatId) {
        systemMsg = appendChatMessage({
          userId: 'system',
          nickname: 'DOLPHINCINEMA.COM',
          avatar: '💺',
          seatId,
          text: `${user.nickname} đã chọn ghế ${seatId}.`,
          isSystem: true
        });
      }

      const publicState = getPublicState();
      broadcastSSE('SEAT_UPDATED', {
        userId,
        previousSeatId,
        seatId,
        seat: roomState.seats[seatId],
        seats: roomState.seats,
        users: roomState.users,
        systemMessage: systemMsg
      });
      broadcastSSE('STATE_UPDATE', publicState);
      return { ok: true, seatId, previousSeatId, state: publicState };
    }

    case 'LEAVE_SEAT': {
      if (!userId) {
        throw Object.assign(new Error('Thiếu userId'), { statusCode: 400 });
      }
      const previousSeatId = releaseUserSeat(userId);
      if (roomState.users[userId]) {
        roomState.users[userId].lastSeen = Date.now();
      }
      const publicState = getPublicState();
      broadcastSSE('SEAT_UPDATED', {
        userId,
        previousSeatId,
        seatId: null,
        seats: roomState.seats,
        users: roomState.users
      });
      broadcastSSE('STATE_UPDATE', publicState);
      return { ok: true, previousSeatId, state: publicState };
    }

    case 'CHAT_MESSAGE': {
      const rawText = typeof actionData.text === 'string' ? actionData.text.trim() : '';
      if (!userId || !rawText) {
        throw Object.assign(new Error('Thiếu userId hoặc nội dung tin nhắn'), { statusCode: 400 });
      }
      const user = roomState.users[userId] || {
        userId,
        nickname: sanitizeString(actionData.nickname, 24, `Khán giả ${userId.slice(-4)}`),
        avatar: sanitizeString(actionData.avatar, 16, '😎'),
        isHost: false,
        seatId: sanitizeString(actionData.seatId, 12, '') || null,
        lastSeen: Date.now()
      };
      user.lastSeen = Date.now();
      roomState.users[userId] = user;

      const chatMsg = appendChatMessage({
        userId: user.userId,
        nickname: user.nickname,
        avatar: user.avatar,
        seatId: user.seatId,
        text: rawText.slice(0, MAX_CHAT_LENGTH),
        isSystem: false
      });

      broadcastSSE('CHAT_MESSAGE', {
        message: chatMsg,
        seatId: user.seatId,
        userId: user.userId,
        nickname: user.nickname,
        avatar: user.avatar
      });
      return { ok: true, message: chatMsg };
    }

    case 'REACTION': {
      if (!userId) {
        throw Object.assign(new Error('Thiếu userId'), { statusCode: 400 });
      }
      const emoji = sanitizeString(actionData.emoji, 16, '❤️');
      const user = roomState.users[userId] || {
        userId,
        nickname: sanitizeString(actionData.nickname, 24, `Khán giả ${userId.slice(-4)}`),
        avatar: sanitizeString(actionData.avatar, 16, '😎'),
        seatId: sanitizeString(actionData.seatId, 12, '') || null
      };
      if (roomState.users[userId]) {
        roomState.users[userId].lastSeen = Date.now();
      }

      const reactionEvent = {
        id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(6).toString('hex'),
        userId,
        seatId: user.seatId || null,
        nickname: user.nickname,
        avatar: user.avatar,
        emoji,
        timestamp: Date.now()
      };

      broadcastSSE('REACTION_BURST', reactionEvent);
      return { ok: true, reaction: reactionEvent };
    }

    case 'MEDIA_CONTROL': {
      if (userId && roomState.users[userId] && roomState.users[userId].isHost === false) {
        throw Object.assign(new Error('Chỉ Chủ rạp (Host) mới có quyền điều khiển phát sóng'), { statusCode: 403 });
      }

      const patch = actionData.mediaPatch && typeof actionData.mediaPatch === 'object'
        ? actionData.mediaPatch
        : actionData;

      const currentComputed = getComputedMedia();
      let nextCurrentTime = currentComputed.currentTime;

      if (typeof patch.currentTime === 'number' && Number.isFinite(patch.currentTime) && patch.currentTime >= 0) {
        nextCurrentTime = patch.currentTime;
      }

      if (typeof patch.type === 'string' && patch.type.trim()) {
        roomState.media.type = sanitizeString(patch.type, 32, roomState.media.type);
      }
      if (typeof patch.source === 'string' && patch.source.trim()) {
        const rawSource = patch.source.trim();
        // Kiểm tra an toàn giao thức nguồn phát
        const isSafeProtocol = /^(https?:\/\/|blob:|\/|[a-zA-Z0-9_-]+)/i.test(rawSource);
        if (isSafeProtocol) {
          const nextSource = sanitizeString(rawSource, 512, roomState.media.source);
          if (nextSource !== roomState.media.source && typeof patch.currentTime !== 'number') {
            nextCurrentTime = 0;
          }
          roomState.media.source = nextSource;
        }
      }
      if (typeof patch.title === 'string' && patch.title.trim()) {
        roomState.media.title = sanitizeString(patch.title, 160, roomState.media.title);
      }
      if (typeof patch.isPlaying === 'boolean') {
        roomState.media.isPlaying = patch.isPlaying;
      }
      if (typeof patch.lightsDimmed === 'boolean') {
        roomState.media.lightsDimmed = patch.lightsDimmed;
      }
      if (typeof patch.curtainOpen === 'boolean') {
        roomState.media.curtainOpen = patch.curtainOpen;
      }

      roomState.media.currentTime = Number(Math.max(0, nextCurrentTime).toFixed(3));
      roomState.media.updatedAt = Date.now();

      if (userId && roomState.users[userId]) {
        roomState.users[userId].lastSeen = Date.now();
      }

      const syncedMedia = getComputedMedia();
      broadcastSSE('MEDIA_SYNC', {
        media: syncedMedia,
        triggeredBy: userId || null,
        serverTime: Date.now()
      });
      return { ok: true, media: syncedMedia };
    }

    default: {
      throw Object.assign(new Error(`Action không được hỗ trợ: ${action}`), { statusCode: 400 });
    }
  }
}

/**
 * Phục vụ file tĩnh an toàn trong ROOT_DIR (Hỗ trợ Range Request cho MP4/MP3)
 */
function serveStaticFile(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request: URL không hợp lệ');
    return;
  }

  if (decodedPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  const relativeTarget = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[/\\]+/, '');
  const resolvedPath = path.resolve(ROOT_DIR, relativeTarget);

  const rootWithSep = ROOT_DIR.endsWith(path.sep) ? ROOT_DIR : ROOT_DIR + path.sep;
  if (resolvedPath !== ROOT_DIR && !resolvedPath.startsWith(rootWithSep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Truy cập ngoài phạm vi cho phép');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const range = req.headers.range;
    if (range && (ext === '.mp4' || ext === '.mp3' || ext === '.webm' || ext === '.wav')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || end >= stats.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}`, 'X-Content-Type-Options': 'nosniff' });
        res.end();
        return;
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff'
      });
      fs.createReadStream(resolvedPath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(resolvedPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    sendJSON(res, 200, getPublicState());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    const userId = sanitizeString(parsedUrl.searchParams.get('userId'), 64, '');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });

    sseClients.set(res, { userId });

    const initialState = getPublicState();
    res.write(`event: STATE_UPDATE\ndata: ${JSON.stringify(initialState)}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
      if (userId) {
        let stillConnected = false;
        for (const info of sseClients.values()) {
          if (info.userId === userId) {
            stillConnected = true;
            break;
          }
        }
        if (!stillConnected) {
          const oldUser = roomState.users[userId];
          const freedSeat = releaseUserSeat(userId);
          delete roomState.users[userId];

          if (oldUser) {
            appendChatMessage({
              userId: 'system',
              nickname: 'DOLPHINCINEMA.COM',
              avatar: '👋',
              seatId: freedSeat,
              text: `${oldUser.nickname} đã rời phòng chiếu${freedSeat ? ` (Trả ghế ${freedSeat})` : ''}.`,
              isSystem: true
            });
          }
          broadcastSSE('STATE_UPDATE', getPublicState());
        }
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/action') {
    try {
      const body = await parseJSONBody(req);
      const result = handleAction(body);
      sendJSON(res, 200, result);
    } catch (err) {
      const status = err.statusCode || 500;
      sendJSON(res, status, { ok: false, error: err.message || 'Lỗi máy chủ nội bộ' });
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStaticFile(req, res, pathname);
    return;
  }

  sendJSON(res, 405, { ok: false, error: 'Method Not Allowed' });
});

setInterval(() => {
  const now = Date.now();
  const pingData = JSON.stringify({ serverTime: now });
  for (const [clientRes] of sseClients.entries()) {
    try {
      clientRes.write(`: heartbeat ${pingData}\n\n`);
    } catch (_) {
      sseClients.delete(clientRes);
    }
  }

  // Dọn dẹp các user vãng lai quá 2 phút không có kết nối SSE hoạt động
  for (const [uid, u] of Object.entries(roomState.users)) {
    let hasSSE = false;
    for (const info of sseClients.values()) {
      if (info.userId === uid) {
        hasSSE = true;
        break;
      }
    }
    if (!hasSSE && now - (u.lastSeen || 0) > 120000) {
      releaseUserSeat(uid);
      delete roomState.users[uid];
    }
  }
}, 15000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('============================================================');
    console.log('🐬 DOLPHINCINEMA.COM — REALTIME SERVER ĐÃ KHỞI ĐỘNG');
    console.log(`🌐 Mở trình duyệt tại: http://localhost:${PORT}`);
    console.log(`📡 SSE Endpoint      : http://localhost:${PORT}/api/events`);
    console.log(`⚡ Action Endpoint   : http://localhost:${PORT}/api/action`);
    console.log('💡 Mẹo: Mở nhiều tab hoặc nhiều thiết bị cùng mạng LAN để');
    console.log('   trải nghiệm chọn ghế, chat bong bóng và xem phim đồng bộ!');
    console.log('============================================================');
  });
}

module.exports = { server, roomState, handleAction, getPublicState };
