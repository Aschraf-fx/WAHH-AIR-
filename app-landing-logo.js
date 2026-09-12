document.addEventListener('DOMContentLoaded', async () => {
  const targets = [
    document.querySelector('.topbar .brand img'),
    document.querySelector('#publicApp .hero-logo-card img')
  ].filter(Boolean);
  if (!targets.length) return;

  try {
    const parts = await Promise.all(
      Array.from({ length: 11 }, (_, i) =>
        fetch(`/assets/landing-logo/part-${String(i).padStart(2, '0')}.txt`, { cache: 'force-cache' })
          .then(response => {
            if (!response.ok) throw new Error('Logo asset unavailable');
            return response.text();
          })
      )
    );

    const decodedParts = parts.map(part => {
      const binary = atob(part.trim());
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    });

    const totalLength = decodedParts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    decodedParts.forEach(part => {
      merged.set(part, offset);
      offset += part.length;
    });

    const fullResolutionLogo = URL.createObjectURL(new Blob([merged], { type: 'image/webp' }));
    targets.forEach(img => { img.src = fullResolutionLogo; });
  } catch (error) {
    console.warn('Landing logo asset unavailable:', error);
  }
});
