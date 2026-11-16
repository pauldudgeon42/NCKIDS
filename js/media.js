/*
 * media.js — importing videos, motion backgrounds and lesson slide images
 * into the library folder, and making the little preview pictures.
 */
(function () {
  const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm'];
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

  function id() {
    return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 12);
  }
  function ext(name) { return (name.split('.').pop() || '').toLowerCase(); }
  function baseName(name) { return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim(); }
  function isVideo(f) { return VIDEO_EXT.includes(ext(f.name)) || (f.type || '').startsWith('video/'); }
  function isImage(f) { return IMAGE_EXT.includes(ext(f.name)) || (f.type || '').startsWith('image/'); }
  /** "Slide2" before "Slide10" */
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function naturalSort(a, b) { return collator.compare(a.name || a, b.name || b); }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  }

  /** Load a video file, check Chrome can show it, and grab a frame. */
  function probeVideo(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      let done = false;
      const finish = (result) => {
        if (done) return; done = true;
        clearTimeout(timer);
        v.removeAttribute('src'); v.load();
        URL.revokeObjectURL(url);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: 'took too long to open' }), 20000);
      v.onerror = () => finish({ ok: false, reason: 'this video format can’t play in Chrome' });
      v.onloadedmetadata = () => {
        if (!v.videoWidth) { finish({ ok: false, reason: 'Chrome can’t show the picture in this video format' }); return; }
        v.currentTime = Math.min(1, (v.duration || 2) * 0.1);
      };
      v.onseeked = async () => {
        const c = document.createElement('canvas');
        c.width = 480; c.height = Math.round(480 * (v.videoHeight / v.videoWidth)) || 270;
        try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (e) { /* ignore */ }
        finish({ ok: true, duration: v.duration || 0, thumb: await canvasToBlob(c) });
      };
      v.src = url;
    });
  }

  async function imageThumb(file) {
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = 480; c.height = Math.round(480 * (bmp.height / bmp.width)) || 270;
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await canvasToBlob(c);
    } catch (e) { return null; }
  }

  async function saveThumb(itemId, blob) {
    if (!blob) return null;
    return Store.writeFile(`media/thumbs/${itemId}.jpg`, blob);
  }

  const Media = {
    id, ext, baseName, isVideo, isImage, naturalSort, VIDEO_EXT, IMAGE_EXT,

    /** Motion (or still) backgrounds. Returns {added:[], problems:[]} */
    async importBackgrounds(files, onProgress) {
      const added = [], problems = [];
      let n = 0;
      for (const f of files) {
        n++; if (onProgress) onProgress(`Importing ${n} of ${files.length}: ${f.name}`);
        const bid = id();
        if (isVideo(f)) {
          const p = await probeVideo(f);
          if (!p.ok) { problems.push(`${f.name}: ${p.reason}`); continue; }
          const path = await Store.writeFile(`media/backgrounds/${bid}.${ext(f.name)}`, f);
          const thumb = await saveThumb(bid, p.thumb);
          added.push({ id: bid, title: baseName(f.name), type: 'video', path, thumb, added: Date.now() });
        } else if (isImage(f)) {
          const path = await Store.writeFile(`media/backgrounds/${bid}.${ext(f.name)}`, f);
          const thumb = await saveThumb(bid, await imageThumb(f));
          added.push({ id: bid, title: baseName(f.name), type: 'image', path, thumb, added: Date.now() });
        } else problems.push(`${f.name}: not a video or picture`);
      }
      Store.data.backgrounds.push(...added);
      Store.save();
      return { added, problems };
    },

    /** Lesson videos (played with sound). */
    async importVideos(files, onProgress) {
      const added = [], problems = [];
      let n = 0;
      for (const f of files) {
        n++; if (onProgress) onProgress(`Importing ${n} of ${files.length}: ${f.name}`);
        if (!isVideo(f)) { problems.push(`${f.name}: not a video file`); continue; }
        const p = await probeVideo(f);
        if (!p.ok) { problems.push(`${f.name}: ${p.reason}. Convert it to MP4 (H.264) and try again.`); continue; }
        const vid = id();
        const path = await Store.writeFile(`media/videos/${vid}.${ext(f.name)}`, f);
        const thumb = await saveThumb(vid, p.thumb);
        added.push({ id: vid, title: baseName(f.name), path, thumb, duration: p.duration, added: Date.now() });
      }
      Store.data.videos.push(...added);
      Store.save();
      return { added, problems };
    },

    /** New lesson from slide images (JPEGs exported from PowerPoint, etc). */
    async importLesson(files, title, onProgress) {
      const lesson = { id: id(), title: title || 'New lesson', slides: [], added: Date.now() };
      await this.addLessonSlides(lesson, files, onProgress);
      Store.data.lessons.push(lesson);
      Store.save();
      return lesson;
    },

    async addLessonSlides(lesson, files, onProgress) {
      const images = Array.from(files).filter(isImage).sort(naturalSort);
      let n = 0;
      for (const f of images) {
        n++; if (onProgress) onProgress(`Copying slide ${n} of ${images.length}`);
        const sid = id();
        const path = await Store.writeFile(`media/lessons/${lesson.id}/${sid}.${ext(f.name)}`, f);
        lesson.slides.push({ id: sid, path, name: f.name });
      }
      if (!lesson.thumb && lesson.slides.length) lesson.thumb = lesson.slides[0].path;
      Store.save();
      return images.length;
    },

    async importLogo(file) {
      if (!isImage(file)) throw new Error('Please choose a picture file (PNG or JPEG).');
      if (Store.data.settings.logo) await Store.remove(Store.data.settings.logo);
      const path = await Store.writeFile(`media/logo-${id()}.${ext(file.name)}`, file);
      Store.data.settings.logo = path;
      Store.save();
      return path;
    },

    /** All files inside a folder the user picks (e.g. a curriculum bundle), recursively. */
    async filesFromFolder(dirHandle, filter) {
      const out = [];
      async function walk(d, prefix) {
        for await (const [name, h] of d.entries()) {
          if (name.startsWith('.')) continue;
          if (h.kind === 'directory') await walk(h, prefix + name + '/');
          else {
            const f = await h.getFile();
            if (!filter || filter(f)) out.push(f);
          }
        }
      }
      await walk(dirHandle, '');
      return out;
    },
  };

  window.Media = Media;
})();
