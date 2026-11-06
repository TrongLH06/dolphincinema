/**
 * STARLIGHT CINEMA ROOM — Multi-Source Player & Built-in Procedural Cinema Engine
 * File: d:\Agent\cinema-room\js\player-controller.js
 * Chức năng:
 *  - Điều khiển 3 lớp trình phát trên màn chiếu lớn:
 *    1. Built-in Procedural Cinema Canvas (#builtinCinemaCanvas):
 *       + "kiem-tam-do-kiep" : Phim Tiên Hiệp 4 cảnh (Đỉnh Côn Lôn, Kiếm Tu Tĩnh Khí, Cửu Trọng Lôi Kiếp, Phá Kiếp Đăng Tiên)
 *       + "galloping-gertie" : Phim Tài Liệu 4 cảnh (Bản Vẽ Mạo Hiểm 1930, Cây Cầu Nhảy Múa, Dao Động Xoắn 45°, Sự Sụp Đổ Lịch Sử)
 *       + "lofi-music"       : Đêm Nhạc Rạp Phim — Synthwave & Chillhop Visualizer + Giai điệu Lofi Procedural
 *    2. HTML5 Video / Audio (#html5VideoPlayer) cho link .mp4, .webm, .mp3, .wav hoặc file mở từ máy tính
 *    3. YouTube IFrame Embed (#youtubePlayerContainer) cho link youtube.com / youtu.be
 *  - Tự động trích xuất màu chủ đạo để cập nhật đèn nền Ambilight (#ambilightGlow)
 *  - Cung cấp hiệu ứng âm thanh rạp chiếu phim bằng Web Audio API (không cần file rời)
 */

(function (global) {
  'use strict';

  const BUILTIN_DURATION = 32; // 32 giây cho 4 phân cảnh (mỗi cảnh 8 giây), lặp vô tận mượt mà

  const BUILTIN_MOVIES = {
    'kiem-tam-do-kiep': {
      title: '⚔️ Kiếm Tâm Độ Kiếp — The Tribulation of Sword Heart',
      duration: BUILTIN_DURATION,
      ambilight: ['rgba(139, 92, 246, 0.65)', 'rgba(56, 189, 248, 0.52)', 'rgba(245, 197, 66, 0.45)'],
      scenes: [
        {
          id: 1,
          name: 'Cảnh 1/4: Đỉnh Côn Lôn phong vân biến sắc',
          vo: '“Ngàn năm tu đạo, đổi lấy một khắc vấn đỉnh thiên môn. Hôm nay cửu trọng lôi kiếp quy tụ...”',
          sub: 'Đạo trời vô tình, liệu có dung tha cho một tấc kiếm tâm?'
        },
        {
          id: 2,
          name: 'Cảnh 2/4: Kiếm tu ngưng thần tĩnh khí',
          vo: '“Kiếm này của ta... không cầu trường sinh bất tử, chỉ cầu chặt đứt gông cùm thiên mệnh!”',
          sub: 'Một niệm sinh kiếm ý, vạn kiếp chẳng sờn lòng.'
        },
        {
          id: 3,
          name: 'Cảnh 3/4: Cửu Trọng Lôi Kiếp giáng thế',
          vo: '“Thiên kiếp thì đã sao? Kiếm của ta... TRẢM!”',
          sub: 'Hóa Thần một bước, vung kiếm rẽ lôi đình, chém tan vạn trượng kiếp lôi!'
        },
        {
          id: 4,
          name: 'Cảnh 4/4: Phá kiếp đăng tiên',
          vo: '“Kiếp nạn đã qua, mây mù tan biến. Thiên Môn rộng mở, kiếm định càn khôn...”',
          sub: 'Từ nay tiêu dao cõi tam giới, đạp mây nhập tiên môn.'
        }
      ]
    },
    'galloping-gertie': {
      title: '🌉 Cây Cầu Biết Nhảy Múa — Galloping Gertie (1940)',
      duration: BUILTIN_DURATION,
      ambilight: ['rgba(245, 158, 11, 0.58)', 'rgba(56, 189, 248, 0.48)', 'rgba(239, 68, 68, 0.48)'],
      scenes: [
        {
          id: 1,
          name: 'Cảnh 1/4: Bản vẽ mạo hiểm thập niên 1930',
          vo: '“Người ta muốn biến cây cầu treo dài thứ 3 thế giới thành công trình mảnh mai nhất...”',
          sub: 'Thay dàn thép mắt cáo truyền thống bằng dầm thép đặc dạng hộp phẳng.'
        },
        {
          id: 2,
          name: 'Cảnh 2/4: Khai trương & Cây cầu nhảy múa',
          vo: '“Mặt cầu bê tông dài hàng cây số uốn lượn nhấp nhô như dải lụa mỗi khi có gió...”',
          sub: 'Ô tô chạy qua bị hất lên xuống như tàu lượn siêu tốc.'
        },
        {
          id: 3,
          name: 'Cảnh 3/4: Hiện tượng cộng hưởng xoắn 45 độ',
          vo: '“Chuyển động nhấp nhô biến thành dao động xoắn vặn đối xứng 45 độ tử thần!”',
          sub: 'Dầm thép và dây cáp chịu lực rên rỉ dưới sức gió xoáy.'
        },
        {
          id: 4,
          name: 'Cảnh 4/4: Sự sụp đổ lịch sử ngày 7/11/1940',
          vo: '“Dây cáp đứt phựt, nhịp cầu bê tông gãy vụn rơi xuống eo biển Tacoma Narrows...”',
          sub: 'Bài học kinh điển về khí động học cho mọi thế hệ kỹ sư.'
        }
      ]
    },
    'lofi-music': {
      title: '🎵 Đêm Nhạc Rạp Phim — Synthwave & Chillhop Live',
      duration: BUILTIN_DURATION,
      ambilight: ['rgba(236, 72, 153, 0.58)', 'rgba(139, 92, 246, 0.55)', 'rgba(6, 182, 212, 0.52)'],
      scenes: [
        {
          id: 1,
          name: 'Track 01: Dolphin Midnight Lofi Beats',
          vo: '“Thả lỏng tâm trí, chọn một chiếc ghế êm ái và trò chuyện cùng những người bạn trong rạp...”',
          sub: '🎧 Tần số thư giãn 85 BPM • Chillhop & Vinyl Crackle'
        },
        {
          id: 2,
          name: 'Track 02: Neon Horizon Synthwave',
          vo: '“Ánh đèn neon phản chiếu qua màn mưa đêm, giai điệu analog ấm áp lan tỏa khắp khán phòng...”',
          sub: '🎹 Retro Synth Arpeggio • Ambilight Dynamic Sync'
        },
        {
          id: 3,
          name: 'Track 03: Cloud Pavilion Ambient',
          vo: '“Mỗi tin nhắn bạn gửi sẽ bay lên như một vì sao nhỏ trên ghế ngồi của chính bạn...”',
          sub: '✨ Bấm các nút 🍿 ❤️ 🔥 bên dưới để khuấy động bầu không khí!'
        },
        {
          id: 4,
          name: 'Track 04: Dawn Over Cinema Hall',
          vo: '“Cảm ơn bạn đã cùng đồng hành tại dolphincinema.com đêm nay.”',
          sub: '🌙 Chúc mọi người có những phút giây nghe nhạc & xem phim thật vui!'
        }
      ]
    }
  };

  function extractYouTubeId(url) {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,15})/i,
      /^([A-Za-z0-9_-]{11})$/
    ];
    for (const reg of patterns) {
      const m = trimmed.match(reg);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  class CinemaPlayerControllerClass {
    constructor() {
      this.videoEl = null;
      this.ytContainer = null;
      this.canvasEl = null;
      this.ctx = null;
      this.ambilightEl = null;
      this.nowPlayingTitleEl = null;
      this.nowPlayingStatusEl = null;

      this.currentMedia = {
        type: 'builtin', // 'builtin' | 'video' | 'youtube'
        source: 'kiem-tam-do-kiep',
        title: BUILTIN_MOVIES['kiem-tam-do-kiep'].title,
        isPlaying: true,
        currentTime: 0,
        updatedAt: Date.now()
      };

      this.localTime = 0;
      this.lastFrameTs = performance.now();
      this.rafId = null;

      // Web Audio Procedural Synthesizer
      this.audioCtx = null;
      this.soundEnabled = true;
      this.volume = 0.8;
      this.nextNoteTime = 0;
      this.noteStep = 0;
      this.activeYoutubeId = null;
      this.activeBlobUrl = null;
      this.onTimeUpdateCallback = null;
    }

    init(elements = {}) {
      this.videoEl = elements.videoEl || document.getElementById('html5VideoPlayer');
      this.ytContainer = elements.ytContainer || document.getElementById('youtubePlayerContainer');
      this.canvasEl = elements.canvasEl || document.getElementById('builtinCinemaCanvas');
      this.ambilightEl = elements.ambilightEl || document.getElementById('ambilightGlow');
      this.nowPlayingTitleEl = elements.nowPlayingTitleEl || document.getElementById('nowPlayingTitle');
      this.nowPlayingStatusEl = elements.nowPlayingStatusEl || document.getElementById('nowPlayingStatus');
      this.onTimeUpdateCallback = elements.onTimeUpdate || null;

      if (this.canvasEl) {
        this.ctx = this.canvasEl.getContext('2d');
      }

      if (this.videoEl) {
        this.videoEl.volume = this.volume;
        this.videoEl.addEventListener('timeupdate', () => {
          if (this.currentMedia.type === 'video' && typeof this.onTimeUpdateCallback === 'function') {
            this.onTimeUpdateCallback(this.videoEl.currentTime, this.videoEl.duration || 100);
          }
        });
      }

      // Khởi tạo AudioContext ngay khi người dùng tương tác lần đầu với trang
      const unlockAudio = () => {
        this._ensureAudioContext();
        document.removeEventListener('pointerdown', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
      };
      document.addEventListener('pointerdown', unlockAudio, { once: true });
      document.addEventListener('keydown', unlockAudio, { once: true });

      this._startRenderLoop();
    }

    _ensureAudioContext() {
      if (!this.audioCtx) {
        const AudioContextClass = global.AudioContext || global.webkitAudioContext;
        if (AudioContextClass) {
          try {
            this.audioCtx = new AudioContextClass();
          } catch (_) {}
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
    }

    setVolume(val) {
      this.volume = Math.max(0, Math.min(1, Number(val) || 0));
      if (this.videoEl) {
        this.videoEl.volume = this.volume;
      }
    }

    toggleSound() {
      this.soundEnabled = !this.soundEnabled;
      this._ensureAudioContext();
      if (this.videoEl) {
        this.videoEl.muted = !this.soundEnabled;
      }
      return this.soundEnabled;
    }

    /**
     * Phát hiệu ứng âm thanh tương tác (chọn ghế, gửi tin nhắn, thả cảm xúc, kéo rèm)
     */
    playSfx(kind = 'pop') {
      if (!this.soundEnabled) return;
      this._ensureAudioContext();
      if (!this.audioCtx || this.audioCtx.state !== 'running') return;

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      const sfxGain = Math.max(0.02, this.volume * 0.18);

      if (kind === 'seat') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(580, now + 0.11);
        gain.gain.setValueAtTime(sfxGain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (kind === 'chat') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.09);
        gain.gain.setValueAtTime(sfxGain * 0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (kind === 'reaction') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.16);
        gain.gain.setValueAtTime(sfxGain * 0.9, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (kind === 'curtain') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.35);
        gain.gain.setValueAtTime(sfxGain * 0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    }

    /**
     * Phát file video/nhạc mở trực tiếp từ máy tính của Chủ rạp
     */
    loadLocalFile(file) {
      if (!file || !this.videoEl) return null;
      if (this.activeBlobUrl) {
        try {
          URL.revokeObjectURL(this.activeBlobUrl);
        } catch (_) {}
        this.activeBlobUrl = null;
      }
      const blobUrl = URL.createObjectURL(file);
      this.activeBlobUrl = blobUrl;
      const title = `📂 [File Máy Tính] ${file.name}`;
      this.syncMedia({
        type: 'video',
        source: blobUrl,
        title,
        isPlaying: true,
        currentTime: 0
      }, true);
      return { title, blobUrl };
    }

    /**
     * Phân tích link người dùng nhập (YouTube, MP4/MP3 hoặc Built-in)
     */
    parseMediaInput(rawInput, customTitle = '') {
      const trimmed = (rawInput || '').trim();
      if (!trimmed) return null;

      if (trimmed.startsWith('builtin:')) {
        const key = trimmed.replace('builtin:', '');
        const movie = BUILTIN_MOVIES[key] || BUILTIN_MOVIES['kiem-tam-do-kiep'];
        return {
          type: 'builtin',
          source: key,
          title: customTitle.trim() || movie.title
        };
      }

      if (trimmed.startsWith('mp4:')) {
        const url = trimmed.replace('mp4:', '');
        return {
          type: 'video',
          source: url,
          title: customTitle.trim() || '🎬 Big Buck Bunny — Open Cinema Movie'
        };
      }

      const ytId = extractYouTubeId(trimmed);
      if (ytId) {
        return {
          type: 'youtube',
          source: ytId,
          title: customTitle.trim() || `▶️ YouTube Cinema (${ytId})`
        };
      }

      return {
        type: 'video',
        source: trimmed,
        title: customTitle.trim() || `🎬 Media Stream (${trimmed.split('/').pop() || 'Live'})`
      };
    }

    /**
     * Đồng bộ trạng thái trình phát từ SyncEngine hoặc Host
     */
    syncMedia(mediaState, forceSeek = false) {
      if (!mediaState) return;

      const prevType = this.currentMedia.type;
      const prevSource = this.currentMedia.source;
      const nextType = mediaState.type || 'builtin';
      const nextSource = mediaState.source || 'kiem-tam-do-kiep';
      const sourceChanged = prevType !== nextType || prevSource !== nextSource;

      this.currentMedia = {
        ...this.currentMedia,
        ...mediaState,
        type: nextType,
        source: nextSource
      };

      if (this.nowPlayingTitleEl) {
        this.nowPlayingTitleEl.textContent = this.currentMedia.title || 'Đang trình chiếu...';
      }
      if (this.nowPlayingStatusEl) {
        this.nowPlayingStatusEl.textContent = this.currentMedia.isPlaying
          ? '🟢 Đang phát đồng bộ cho toàn rạp'
          : '⏸️ Chủ rạp đang tạm dừng';
      }

      // Chuyển đổi lớp hiển thị
      this._switchActiveLayer(nextType);

      if (nextType === 'builtin') {
        if (this.videoEl) {
          try {
            this.videoEl.pause();
          } catch (_) {}
        }
        if (sourceChanged || forceSeek || Math.abs(this.localTime - (mediaState.currentTime || 0)) > 1.8) {
          this.localTime = Number(mediaState.currentTime) || 0;
        }
        const movie = BUILTIN_MOVIES[nextSource] || BUILTIN_MOVIES['kiem-tam-do-kiep'];
        this._updateAmbilight(movie.ambilight);
      } else if (nextType === 'video') {
        if (this.videoEl) {
          if (sourceChanged && !this.currentMedia.source.startsWith('blob:')) {
            this.videoEl.src = this.currentMedia.source;
          } else if (sourceChanged && this.currentMedia.source.startsWith('blob:')) {
            this.videoEl.src = this.currentMedia.source;
          }
          const targetTime = Number(mediaState.currentTime) || 0;
          if (forceSeek || Math.abs((this.videoEl.currentTime || 0) - targetTime) > 2.2) {
            try {
              this.videoEl.currentTime = targetTime;
            } catch (_) {}
          }
          if (this.currentMedia.isPlaying) {
            this.videoEl.play().catch(() => {});
          } else {
            this.videoEl.pause();
          }
        }
        this._updateAmbilight([
          'rgba(56, 189, 248, 0.55)',
          'rgba(16, 185, 129, 0.45)',
          'rgba(245, 197, 66, 0.45)'
        ]);
      } else if (nextType === 'youtube') {
        if (this.videoEl) {
          try {
            this.videoEl.pause();
          } catch (_) {}
        }
        this._loadYouTubeEmbed(nextSource, Math.floor(Number(mediaState.currentTime) || 0), this.currentMedia.isPlaying, sourceChanged || forceSeek);
        this._updateAmbilight([
          'rgba(239, 68, 68, 0.58)',
          'rgba(245, 197, 66, 0.48)',
          'rgba(139, 92, 246, 0.5)'
        ]);
      }
    }

    _switchActiveLayer(type) {
      if (this.canvasEl) {
        this.canvasEl.classList.toggle('active', type === 'builtin');
      }
      if (this.videoEl) {
        this.videoEl.classList.toggle('active', type === 'video');
      }
      if (this.ytContainer) {
        this.ytContainer.classList.toggle('active', type === 'youtube');
        if (type !== 'youtube') {
          this.ytContainer.innerHTML = '';
          this.activeYoutubeId = null;
        }
      }
    }

    _loadYouTubeEmbed(videoId, startSeconds = 0, autoplay = true, forceReload = false) {
      if (!this.ytContainer) return;
      const cleanId = extractYouTubeId(videoId) || 'jfKfPfyJRdk';
      if (!forceReload && this.activeYoutubeId === cleanId) return;

      this.activeYoutubeId = cleanId;
      const params = new URLSearchParams({
        autoplay: autoplay ? '1' : '0',
        start: String(Math.max(0, startSeconds)),
        rel: '0',
        modestbranding: '1',
        playsinline: '1'
      });

      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(cleanId)}?${params.toString()}`;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.title = 'YouTube Cinema Player';

      this.ytContainer.innerHTML = '';
      this.ytContainer.appendChild(iframe);
    }

    _updateAmbilight(colors) {
      if (!this.ambilightEl || !Array.isArray(colors) || colors.length < 3) return;
      this.ambilightEl.style.setProperty('--ambilight-color-1', colors[0]);
      this.ambilightEl.style.setProperty('--ambilight-color-2', colors[1]);
      this.ambilightEl.style.setProperty('--ambilight-color-3', colors[2]);
    }

    getCurrentTime() {
      if (this.currentMedia.type === 'video' && this.videoEl) {
        return this.videoEl.currentTime || 0;
      }
      return this.localTime % BUILTIN_DURATION;
    }

    getDuration() {
      if (this.currentMedia.type === 'video' && this.videoEl && Number.isFinite(this.videoEl.duration)) {
        return this.videoEl.duration;
      }
      return BUILTIN_DURATION;
    }

    /**
     * Vòng lặp dựng hình 60fps cho Built-in Procedural Cinema Canvas & Giai điệu nền
     */
    _startRenderLoop() {
      const loop = (now) => {
        const dt = Math.min(0.1, (now - this.lastFrameTs) / 1000);
        this.lastFrameTs = now;

        if (this.currentMedia.type === 'builtin') {
          if (this.currentMedia.isPlaying) {
            this.localTime = (this.localTime + dt) % BUILTIN_DURATION;
            this._scheduleProceduralMusic(this.currentMedia.source);
            this._renderBuiltinCanvas(this.currentMedia.source, this.localTime);
          } else {
            // Khi tạm dừng, chỉ vẽ lại nếu có yêu cầu
            if (this.needsRedraw) {
              this._renderBuiltinCanvas(this.currentMedia.source, this.localTime);
              this.needsRedraw = false;
            }
          }
          if (typeof this.onTimeUpdateCallback === 'function') {
            this.onTimeUpdateCallback(this.localTime, BUILTIN_DURATION);
          }
        }

        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }

    /**
     * Phát nhạc nền nhẹ nhàng bằng Web Audio API cho 3 bộ phim/nhạc Built-in
     */
    _scheduleProceduralMusic(sourceKey) {
      if (!this.soundEnabled || !this.audioCtx || this.audioCtx.state !== 'running') return;
      const now = this.audioCtx.currentTime;
      if (now < this.nextNoteTime) return;

      // Mỗi nốt cách nhau 0.45s
      this.nextNoteTime = now + 0.48;
      this.noteStep = (this.noteStep + 1) % 16;

      // Thang âm Ngũ cung cổ phong / Lofi
      const scales = {
        'kiem-tam-do-kiep': [220, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 392.0],
        'galloping-gertie': [196.0, 233.08, 261.63, 277.18, 329.63, 261.63, 233.08, 196.0],
        'lofi-music': [261.63, 329.63, 392.0, 493.88, 440.0, 392.0, 329.63, 293.66]
      };
      const notes = scales[sourceKey] || scales['kiem-tam-do-kiep'];
      const freq = notes[this.noteStep % notes.length];

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = sourceKey === 'lofi-music' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const noteVol = Math.max(0.005, this.volume * 0.045);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(noteVol, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.44);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    }

    /**
     * Vẽ đồ họa điện ảnh 1280x720 cho 3 kênh Built-in Cinema
     */
    _renderBuiltinCanvas(sourceKey, t) {
      if (!this.ctx || !this.canvasEl) return;
      const ctx = this.ctx;
      const W = this.canvasEl.width;
      const H = this.canvasEl.height;

      const movie = BUILTIN_MOVIES[sourceKey] || BUILTIN_MOVIES['kiem-tam-do-kiep'];
      const sceneIndex = Math.min(3, Math.floor((t % BUILTIN_DURATION) / 8));
      const sceneProgress = ((t % BUILTIN_DURATION) % 8) / 8;
      const scene = movie.scenes[sceneIndex];

      ctx.save();
      ctx.clearRect(0, 0, W, H);

      if (sourceKey === 'kiem-tam-do-kiep') {
        this._drawKiemTamDoKiep(ctx, W, H, sceneIndex, sceneProgress, t);
      } else if (sourceKey === 'galloping-gertie') {
        this._drawGallopingGertie(ctx, W, H, sceneIndex, sceneProgress, t);
      } else {
        this._drawLofiMusicVisualizer(ctx, W, H, sceneIndex, sceneProgress, t);
      }

      // Vẽ dải Cinema Letterbox + Phụ đề Karaoke & Tên phân cảnh
      this._drawCinemaSubtitles(ctx, W, H, movie, scene, sceneIndex, t);
      ctx.restore();
    }

    _drawKiemTamDoKiep(ctx, W, H, sceneIdx, p, t) {
      // Bầu trời huyền huyễn theo từng cảnh
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      if (sceneIdx === 0) {
        skyGrad.addColorStop(0, '#090418');
        skyGrad.addColorStop(0.55, '#1e103a');
        skyGrad.addColorStop(1, '#0c1829');
      } else if (sceneIdx === 1) {
        skyGrad.addColorStop(0, '#071226');
        skyGrad.addColorStop(0.6, '#142d4c');
        skyGrad.addColorStop(1, '#08101d');
      } else if (sceneIdx === 2) {
        skyGrad.addColorStop(0, '#1a062b');
        skyGrad.addColorStop(0.5, '#3b0a45');
        skyGrad.addColorStop(1, '#0c0617');
      } else {
        skyGrad.addColorStop(0, '#1e293b');
        skyGrad.addColorStop(0.45, '#78350f');
        skyGrad.addColorStop(1, '#0f172a');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Vòng xoáy lôi kiếp hoặc hào quang Thiên Môn
      const cx = W * 0.5;
      const cy = sceneIdx === 3 ? H * 0.34 : H * 0.25;
      for (let i = 4; i >= 1; i--) {
        ctx.beginPath();
        ctx.arc(cx, cy, i * 65 + Math.sin(t * 2 + i) * 10, 0, Math.PI * 2);
        ctx.fillStyle =
          sceneIdx === 3
            ? `rgba(245, 197, 66, ${0.08 * (5 - i)})`
            : `rgba(168, 85, 247, ${0.07 * (5 - i)})`;
        ctx.fill();
      }

      // Đỉnh núi Côn Lôn và biển mây
      ctx.fillStyle = '#0b0f1d';
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.lineTo(0, H * 0.68);
      ctx.lineTo(W * 0.22, H * 0.52);
      ctx.lineTo(W * 0.38, H * 0.64);
      ctx.lineTo(W * 0.5, H * 0.45);
      ctx.lineTo(W * 0.64, H * 0.63);
      ctx.lineTo(W * 0.82, H * 0.5);
      ctx.lineTo(W, H * 0.66);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();

      // Sấm sét tím Cửu Trọng Lôi Kiếp (Cảnh 1 & 3)
      if (sceneIdx === 0 || sceneIdx === 2) {
        const flash = Math.sin(t * 9) > 0.35;
        ctx.strokeStyle = flash ? '#f0abfc' : '#a855f7';
        ctx.lineWidth = sceneIdx === 2 ? 5 : 3;
        ctx.shadowColor = '#d946ef';
        ctx.shadowBlur = 22;
        ctx.beginPath();
        let lx = cx + Math.sin(t * 3) * 80;
        let ly = 0;
        ctx.moveTo(lx, ly);
        for (let step = 1; step <= 8; step++) {
          lx += Math.sin(t * 14 + step * 2.3) * 34;
          ly = (H * 0.52 * step) / 8;
          ctx.lineTo(lx, ly);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Cổng Thiên Môn bằng vàng ngọc (Cảnh 4)
      if (sceneIdx === 3) {
        ctx.save();
        ctx.strokeStyle = '#f5c542';
        ctx.lineWidth = 6;
        ctx.shadowColor = '#f5c542';
        ctx.shadowBlur = 25;
        const gateSpread = 90 + p * 35;
        ctx.strokeRect(cx - gateSpread, H * 0.14, gateSpread * 2, H * 0.28);
        ctx.restore();
      }

      // Nhân vật Kiếm Tu & Trường Kiếm phát sáng
      const heroX = cx;
      const heroY = sceneIdx === 2 ? H * 0.36 - Math.sin(p * Math.PI) * 55 : H * 0.45;

      // Vòng linh lực hộ thể
      ctx.save();
      ctx.strokeStyle = sceneIdx === 3 ? '#f5c542' : '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(heroX, heroY - 18, 42 + Math.sin(t * 4) * 5, 0, Math.PI * 2);
      ctx.stroke();

      // Thân ảnh kiếm tu áo trắng
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(heroX, heroY - 36, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(heroX - 16, heroY + 6);
      ctx.lineTo(heroX + 16, heroY + 6);
      ctx.lineTo(heroX + 6, heroY - 25);
      ctx.lineTo(heroX - 6, heroY - 25);
      ctx.closePath();
      ctx.fill();

      // Thanh Phi Kiếm ánh lam/vàng
      const swordAngle = sceneIdx === 2 ? -Math.PI / 4 + Math.sin(t * 10) * 0.3 : -Math.PI / 2;
      ctx.translate(heroX + 28, heroY - 22);
      ctx.rotate(swordAngle);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(-3, -48, 6, 68);
      ctx.fillStyle = '#f5c542';
      ctx.fillRect(-12, 8, 24, 5);
      ctx.restore();
    }

    _drawGallopingGertie(ctx, W, H, sceneIdx, p, t) {
      // Nền trời eo biển Tacoma Narrows
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      if (sceneIdx === 0) {
        grad.addColorStop(0, '#0f2537');
        grad.addColorStop(1, '#1e3a5f');
      } else {
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(0.6, '#1e293b');
        grad.addColorStop(1, '#0a192f');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      if (sceneIdx === 0) {
        // Cảnh 1: Bản vẽ Blueprint kỹ thuật
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 40) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        for (let y = 0; y < H; y += 40) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
      }

      // Hai trụ tháp cầu treo Tacoma Narrows
      const leftTowerX = W * 0.26;
      const rightTowerX = W * 0.74;
      const bridgeY = H * 0.48;

      ctx.strokeStyle = sceneIdx === 0 ? '#7dd3fc' : '#cbd5e1';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(leftTowerX, H * 0.16);
      ctx.lineTo(leftTowerX, H * 0.75);
      ctx.moveTo(rightTowerX, H * 0.16);
      ctx.lineTo(rightTowerX, H * 0.75);
      ctx.stroke();

      // Biên độ dao động uốn lượn & xoắn theo từng cảnh
      const waveAmp = sceneIdx === 0 ? 4 : sceneIdx === 1 ? 26 : sceneIdx === 2 ? 48 : 62;
      const waveFreq = sceneIdx === 2 ? 4.5 : 3.2;

      // Dây cáp chính & mặt cầu uốn lượn
      ctx.strokeStyle = sceneIdx === 2 ? '#f59e0b' : '#f8fafc';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let x = W * 0.08; x <= W * 0.92; x += 12) {
        const norm = (x - W * 0.08) / (W * 0.84);
        const yOffset = Math.sin(norm * Math.PI * 2.5 + t * waveFreq) * waveAmp;
        const y = bridgeY + yOffset;
        if (sceneIdx === 3 && x > W * 0.44 && x < W * 0.56) {
          // Cảnh 4: Nhịp giữa sụp đổ xuống biển
          ctx.moveTo(x, y + p * 120);
        } else if (x === W * 0.08) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Sóng nước bên dưới eo biển
      ctx.fillStyle = 'rgba(14, 116, 144, 0.55)';
      ctx.fillRect(0, H * 0.68, W, H * 0.32);
    }

    _drawLofiMusicVisualizer(ctx, W, H, sceneIdx, p, t) {
      // Nền Synthwave hoàng hôn tím/hồng
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#090414');
      bg.addColorStop(0.55, '#2e1065');
      bg.addColorStop(1, '#0f172a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Mặt trời Synthwave
      const sunX = W * 0.5;
      const sunY = H * 0.38;
      const sunGrad = ctx.createLinearGradient(sunX, sunY - 110, sunX, sunY + 110);
      sunGrad.addColorStop(0, '#f43f5e');
      sunGrad.addColorStop(0.5, '#f59e0b');
      sunGrad.addColorStop(1, '#a855f7');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 105, 0, Math.PI * 2);
      ctx.fill();

      // Thanh sóng nhạc Audio Spectrum nhảy theo nhịp
      const barCount = 42;
      const totalWidth = W * 0.72;
      const startX = (W - totalWidth) / 2;
      const barW = totalWidth / barCount - 6;

      for (let i = 0; i < barCount; i++) {
        const wave =
          Math.abs(Math.sin(t * 3.8 + i * 0.35)) * 0.65 +
          Math.abs(Math.cos(t * 6.2 - i * 0.2)) * 0.35;
        const barH = 18 + wave * 145;
        const x = startX + i * (barW + 6);
        const y = H * 0.66 - barH;

        ctx.fillStyle = i % 2 === 0 ? '#38bdf8' : '#f472b6';
        ctx.fillRect(x, y, barW, barH);
      }
    }

    _drawCinemaSubtitles(ctx, W, H, movie, scene, sceneIndex, t) {
      // Dải đen điện ảnh trên & dưới
      ctx.fillStyle = 'rgba(4, 6, 12, 0.76)';
      ctx.fillRect(0, 0, W, 54);
      ctx.fillRect(0, H - 118, W, 118);

      // Tiêu đề cảnh ở góc trên
      ctx.fillStyle = '#f5c542';
      ctx.font = '700 17px "Be Vietnam Pro", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(scene.name, 28, 34);

      // Thời gian phát ở góc phải trên
      const curSec = Math.floor(t % BUILTIN_DURATION);
      const timeStr = `00:${String(curSec).padStart(2, '0')} / 00:${BUILTIN_DURATION}`;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 15px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(timeStr, W - 28, 34);

      // Lời bình chính (Voiceover) ở dưới màn chiếu
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 22px "Be Vietnam Pro", sans-serif';
      ctx.fillText(scene.vo, W * 0.5, H - 64, W - 64);

      // Dòng phụ đề giải thích bên dưới
      ctx.fillStyle = '#ffe07d';
      ctx.font = '500 17px "Be Vietnam Pro", sans-serif';
      ctx.fillText(scene.sub, W * 0.5, H - 30, W - 64);
    }
  }

  const controllerInstance = new CinemaPlayerControllerClass();
  controllerInstance.CinemaPlayerControllerClass = CinemaPlayerControllerClass;
  controllerInstance.BUILTIN_MOVIES = BUILTIN_MOVIES;
  global.CinemaPlayerController = controllerInstance;
})(typeof window !== 'undefined' ? window : globalThis);
